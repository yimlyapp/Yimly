import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/index.js';
import { sessions, queueItems, songs, artists } from '../db/schema.js';
import { eq, asc, and } from 'drizzle-orm';

interface RoomState {
  playing: boolean;
  position: number; // current time in seconds
  currentSongId: number | null;
  currentQueueItemId: number | null;
  variant: 'original' | 'instrumental';
  lyricOffset: number; // in ms
  clients: Set<WebSocket>;
  hostClient: WebSocket | null;
}

const activeRooms = new Map<string, RoomState>();

export function setupWebSockets(wss: WebSocketServer) {
  wss.on('connection', async (ws, req) => {
    // Basic URL parsing to get session id
    const url = req.url;
    // Expected format: /ws/karaoke?sessionId=xxxx
    const params = new URLSearchParams(url?.split('?')[1]);
    const sessionId = params.get('sessionId');

    const isHost = params.get('isHost') === 'true';

    if (!sessionId) {
      ws.close(1008, 'Session ID required');
      return;
    }

    if (!activeRooms.has(sessionId)) {
      // Initialize room state from DB if possible (e.g. find currently playing queue item)
      let initialSongId = null;
      let initialQueueItemId = null;
      try {
        const playingItem = await db.select({
          id: queueItems.id,
          songId: queueItems.songId
        })
        .from(queueItems)
        .where(and(eq(queueItems.sessionId, sessionId), eq(queueItems.status, 'playing')))
        .limit(1);

        if (playingItem.length > 0) {
          initialQueueItemId = playingItem[0].id;
          initialSongId = playingItem[0].songId;
        } else {
          // Get first pending
          const pendingItem = await db.select({
            id: queueItems.id,
            songId: queueItems.songId
          })
          .from(queueItems)
          .where(and(eq(queueItems.sessionId, sessionId), eq(queueItems.status, 'pending')))
          .orderBy(asc(queueItems.position))
          .limit(1);

          if (pendingItem.length > 0) {
            initialQueueItemId = pendingItem[0].id;
            initialSongId = pendingItem[0].songId;
          }
        }
      } catch (e) {
        console.error('Error initializing room state from DB', e);
      }

      activeRooms.set(sessionId, {
        playing: false,
        position: 0,
        currentSongId: initialSongId,
        currentQueueItemId: initialQueueItemId,
        variant: 'original',
        lyricOffset: 0,
        clients: new Set(),
        hostClient: null,
      });
    }

    const room = activeRooms.get(sessionId)!;
    room.clients.add(ws);

    if (isHost) {
      room.hostClient = ws;
    }

    // Send initial state
    ws.send(JSON.stringify({
      type: 'STATE_UPDATE',
      payload: {
        playing: room.playing,
        position: room.position,
        currentSongId: room.currentSongId,
        currentQueueItemId: room.currentQueueItemId,
        variant: room.variant,
        lyricOffset: room.lyricOffset
      }
    }));

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'PLAY':
            room.playing = true;
            broadcastToRoom(sessionId, { type: 'PLAYING', payload: { position: room.position } });
            break;
          case 'PAUSE':
            room.playing = false;
            broadcastToRoom(sessionId, { type: 'PAUSED', payload: { position: room.position } });
            break;
          case 'SEEK':
            room.position = data.payload.position;
            broadcastToRoom(sessionId, { type: 'SEEKED', payload: { position: room.position } });
            break;
          case 'SYNC':
            room.position = data.payload.position;
            room.playing = data.payload.playing;
            broadcastToRoom(sessionId, { type: 'SYNC', payload: { position: room.position, playing: room.playing } });
            break;
          case 'RESTART':
            room.position = 0;
            broadcastToRoom(sessionId, { type: 'RESTARTED', payload: { position: 0 } });
            break;
          case 'SKIP':
          case 'SONG_FINISHED':
            // Advance queue in DB and room state
            await advanceQueue(sessionId, room);
            break;
          case 'VARIANT_CHANGED':
            room.variant = data.payload.variant;
            if (data.payload.position !== undefined) room.position = data.payload.position;
            if (data.payload.playing !== undefined) room.playing = data.payload.playing;
            broadcastToRoom(sessionId, { 
              type: 'VARIANT_CHANGED', 
              payload: { 
                variant: room.variant,
                position: room.position,
                playing: room.playing
              } 
            });
            break;
          case 'OFFSET_CHANGED':
            room.lyricOffset = data.payload.offset;
            broadcastToRoom(sessionId, { type: 'OFFSET_CHANGED', payload: { offset: room.lyricOffset } });
            break;
          case 'QUEUE_UPDATE':
            broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
            break;
          case 'SONG_CHANGED':
            room.currentSongId = data.payload.songId;
            room.currentQueueItemId = data.payload.queueItemId || null;
            room.position = 0;
            room.playing = true;
            broadcastToRoom(sessionId, { type: 'SONG_CHANGED', payload: { songId: room.currentSongId, queueItemId: room.currentQueueItemId } });
            break;
        }
      } catch (err) {
        console.error('WS message error', err);
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      if (isHost && room.hostClient === ws) {
        room.hostClient = null;
      }
    });
  });
}

export function closeSessionWS(sessionId: string) {
  const room = activeRooms.get(sessionId);
  if (room) {
    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'SESSION_CLOSED' }));
        client.close(1000, 'Session closed by host');
      }
    }
    activeRooms.delete(sessionId);
  }
}

async function advanceQueue(sessionId: string, room: RoomState & { isAdvancing?: boolean }) {
  if (room.isAdvancing) return;
  room.isAdvancing = true;

  try {
    // 1. Remove current playing or first pending from the queue
    if (room.currentQueueItemId) {
      await db.delete(queueItems)
        .where(eq(queueItems.id, room.currentQueueItemId));
    } else {
      // Find current playing in DB and delete it
      const currentPlaying = await db.select().from(queueItems)
        .where(and(eq(queueItems.sessionId, sessionId), eq(queueItems.status, 'playing')))
        .limit(1);
      if (currentPlaying.length > 0) {
        await db.delete(queueItems)
          .where(eq(queueItems.id, currentPlaying[0].id));
      }
    }

    // 2. Find next pending queue item
    const nextPending = await db.select().from(queueItems)
      .where(and(eq(queueItems.sessionId, sessionId), eq(queueItems.status, 'pending')))
      .orderBy(asc(queueItems.position))
      .limit(1);

    if (nextPending.length > 0) {
      const nextItem = nextPending[0];
      await db.update(queueItems)
        .set({ status: 'playing' })
        .where(eq(queueItems.id, nextItem.id));

      room.currentSongId = nextItem.songId;
      room.currentQueueItemId = nextItem.id;
      room.position = 0;
      room.playing = true;

      broadcastToRoom(sessionId, {
        type: 'SONG_CHANGED',
        payload: {
          songId: room.currentSongId,
          queueItemId: room.currentQueueItemId
        }
      });
    } else {
      // Queue is empty
      room.currentSongId = null;
      room.currentQueueItemId = null;
      room.playing = false;
      room.position = 0;

      broadcastToRoom(sessionId, {
        type: 'QUEUE_EMPTY',
        payload: {}
      });
    }

    broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
  } catch (err) {
    console.error('Error advancing queue:', err);
  } finally {
    room.isAdvancing = false;
  }
}

function broadcastToRoom(sessionId: string, message: any) {
  const room = activeRooms.get(sessionId);
  if (room) {
    const msgStr = JSON.stringify(message);
    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msgStr);
      }
    }
  }
}

export function notifyQueueUpdate(sessionId: string) {
  broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
}

