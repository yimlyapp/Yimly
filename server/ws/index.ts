import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/index.js';
import { sessions, queueItems, songs, artists } from '../db/schema.js';
import { eq, asc, and } from 'drizzle-orm';

export interface RoomState {
  playing: boolean;
  position: number; // current time in seconds
  currentSongId: number | null;
  currentQueueItemId: number | null;
  variant: 'original' | 'instrumental';
  lyricOffset: number; // in ms
  clients: Set<WebSocket>;
  hostClient: WebSocket | null;
  lastHostHeartbeat: number;
  isAdvancing?: boolean;
}

const activeRooms = new Map<string, RoomState>();

export async function getOrCreateRoom(sessionId: string): Promise<RoomState> {
  let room = activeRooms.get(sessionId);
  if (!room) {
    let initialSongId: number | null = null;
    let initialQueueItemId: number | null = null;
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
      console.error('[WS] Error initializing room state from DB:', e);
    }

    room = {
      playing: false,
      position: 0,
      currentSongId: initialSongId,
      currentQueueItemId: initialQueueItemId,
      variant: 'original',
      lyricOffset: 0,
      clients: new Set(),
      hostClient: null,
      lastHostHeartbeat: Date.now(),
    };
    activeRooms.set(sessionId, room);
  }
  return room;
}

export function getRoomState(sessionId: string): RoomState | undefined {
  return activeRooms.get(sessionId);
}

export function setupWebSockets(wss: WebSocketServer) {
  wss.on('connection', async (ws, req) => {
    const url = req.url;
    const params = new URLSearchParams(url?.split('?')[1]);
    const sessionId = params.get('sessionId');
    const isHost = params.get('isHost') === 'true';

    if (!sessionId) {
      ws.close(1008, 'Session ID required');
      return;
    }

    const room = await getOrCreateRoom(sessionId);
    room.clients.add(ws);

    if (isHost) {
      room.hostClient = ws;
      room.lastHostHeartbeat = Date.now();
      // Update DB session updatedAt to indicate active host presence
      try {
        await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
      } catch (e) {
        // ignore
      }
    }

    // Send initial full state update
    if (ws.readyState === WebSocket.OPEN) {
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
    }

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'HEARTBEAT':
            if (isHost) {
              room.lastHostHeartbeat = Date.now();
              try {
                await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
              } catch (e) {
                console.error('[WS] Failed to update session updatedAt on heartbeat:', e);
              }
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK', timestamp: Date.now() }));
            }
            break;

          case 'PONG':
            // Keep-alive acknowledgment
            break;

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

          case 'GET_STATE':
            if (ws.readyState === WebSocket.OPEN) {
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
            }
            break;

          case 'SONG_CHANGED':
            room.currentSongId = data.payload.songId;
            room.currentQueueItemId = data.payload.queueItemId || null;
            room.position = 0;
            room.playing = true;
            broadcastToRoom(sessionId, { 
              type: 'SONG_CHANGED', 
              payload: { 
                songId: room.currentSongId, 
                queueItemId: room.currentQueueItemId,
                playing: true,
                position: 0
              } 
            });
            break;
        }
      } catch (err) {
        console.error('[WS] Message error:', err);
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      if (isHost && room.hostClient === ws) {
        room.hostClient = null;
      }
    });

    ws.on('error', (err) => {
      console.warn('[WS] Client socket warning/error:', err.message);
      room.clients.delete(ws);
      if (isHost && room.hostClient === ws) {
        room.hostClient = null;
      }
    });
  });

  // Keep-alive ping interval to prevent proxy idle timeouts
  const PING_INTERVAL_MS = 25 * 1000;
  setInterval(() => {
    for (const [sessionId, room] of activeRooms.entries()) {
      for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.ping();
            client.send(JSON.stringify({ type: 'PING' }));
          } catch (e) {
            // Socket already closed or errored
          }
        }
      }
    }
  }, PING_INTERVAL_MS);

  // Background Session Expiry Cleaner (runs every 30 seconds)
  // An active room expires ONLY when the host has not sent a heartbeat and has been disconnected for > 90 seconds.
  const EXPIRY_THRESHOLD_MS = 90 * 1000;
  setInterval(async () => {
    try {
      const activeSessions = await db.select().from(sessions).where(eq(sessions.status, 'active'));
      const now = Date.now();

      for (const sess of activeSessions) {
        const room = activeRooms.get(sess.id);
        const hasActiveHost = room?.hostClient && room.hostClient.readyState === WebSocket.OPEN;
        const lastHeartbeat = room?.lastHostHeartbeat || (sess.updatedAt ? new Date(sess.updatedAt).getTime() : 0);
        const createdAt = sess.createdAt ? new Date(sess.createdAt).getTime() : 0;
        
        const timeSinceHeartbeat = now - Math.max(lastHeartbeat, createdAt);

        // If host is not currently connected AND no valid host heartbeat received for > 90 seconds
        if (!hasActiveHost && timeSinceHeartbeat > EXPIRY_THRESHOLD_MS) {
          console.log(`[SESSION EXPIRED] Session ${sess.id} (code ${sess.roomCode}) timed out after ${Math.round(timeSinceHeartbeat / 1000)}s without host heartbeat.`);
          await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, sess.id));
          closeSessionWS(sess.id);
        }
      }
    } catch (err) {
      console.error('[SESSION CLEANUP] Error during session expiry cleanup:', err);
    }
  }, 30 * 1000);
}

export async function handleHostHeartbeat(sessionId: string) {
  const room = activeRooms.get(sessionId);
  if (room) {
    room.lastHostHeartbeat = Date.now();
  }
  try {
    await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
  } catch (e) {
    console.error('[HEARTBEAT] Error updating session timestamp:', e);
  }
}

export function closeSessionWS(sessionId: string) {
  const room = activeRooms.get(sessionId);
  if (room) {
    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({ type: 'SESSION_CLOSED' }));
          client.close(1000, 'Session closed');
        } catch (e) {
          // ignore
        }
      }
    }
    activeRooms.delete(sessionId);
  }
}

export async function advanceQueueBySessionId(sessionId: string) {
  const room = await getOrCreateRoom(sessionId);
  return await advanceQueue(sessionId, room);
}

export async function advanceQueue(sessionId: string, room: RoomState) {
  if (room.isAdvancing) return;
  room.isAdvancing = true;

  try {
    // 1. Remove current playing or first pending from the queue in DB
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
          queueItemId: room.currentQueueItemId,
          playing: true,
          position: 0
        }
      });

      broadcastToRoom(sessionId, {
        type: 'PLAYING',
        payload: { position: 0 }
      });
    } else {
      // Queue is completely empty
      room.currentSongId = null;
      room.currentQueueItemId = null;
      room.playing = false;
      room.position = 0;

      broadcastToRoom(sessionId, {
        type: 'QUEUE_EMPTY',
        payload: {}
      });

      broadcastToRoom(sessionId, {
        type: 'PAUSED',
        payload: { position: 0 }
      });
    }

    // Broadcast updated queue to all connected hosts and guests
    broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
  } catch (err) {
    console.error('[WS] Error advancing queue:', err);
  } finally {
    room.isAdvancing = false;
  }
}

/**
 * Checks if the queue has pending items and nothing is currently playing.
 * If so, automatically starts playing the first item.
 * Otherwise, broadcasts QUEUE_UPDATED.
 */
export async function checkAndAutoPlay(sessionId: string) {
  try {
    const room = await getOrCreateRoom(sessionId);

    // Check if there is already a song actively playing in memory or DB
    const currentlyPlayingInDB = await db.select().from(queueItems)
      .where(and(eq(queueItems.sessionId, sessionId), eq(queueItems.status, 'playing')))
      .limit(1);

    const isCurrentlyPlaying = (room.playing && room.currentSongId !== null) || currentlyPlayingInDB.length > 0;

    if (!isCurrentlyPlaying) {
      // Look for first pending queue item in DB
      const pendingItems = await db.select().from(queueItems)
        .where(and(eq(queueItems.sessionId, sessionId), eq(queueItems.status, 'pending')))
        .orderBy(asc(queueItems.position))
        .limit(1);

      if (pendingItems.length > 0) {
        const itemToPlay = pendingItems[0];

        await db.update(queueItems)
          .set({ status: 'playing' })
          .where(eq(queueItems.id, itemToPlay.id));

        room.currentSongId = itemToPlay.songId;
        room.currentQueueItemId = itemToPlay.id;
        room.position = 0;
        room.playing = true;

        broadcastToRoom(sessionId, {
          type: 'SONG_CHANGED',
          payload: {
            songId: room.currentSongId,
            queueItemId: room.currentQueueItemId,
            playing: true,
            position: 0
          }
        });

        broadcastToRoom(sessionId, {
          type: 'PLAYING',
          payload: { position: 0 }
        });
      }
    }

    broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
  } catch (err) {
    console.error('[WS] Error checking and auto-playing queue:', err);
    broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
  }
}

export function notifyQueueUpdate(sessionId: string) {
  checkAndAutoPlay(sessionId);
}

function broadcastToRoom(sessionId: string, message: any) {
  const room = activeRooms.get(sessionId);
  if (room) {
    const msgStr = JSON.stringify(message);
    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(msgStr);
        } catch (e) {
          // ignore
        }
      }
    }
  }
}


