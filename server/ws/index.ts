import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/index.js';
import { sessions, queueItems } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface RoomState {
  playing: boolean;
  position: number; // current time in seconds
  currentSongId: number | null;
  clients: Set<WebSocket>;
}

const activeRooms = new Map<string, RoomState>();

export function setupWebSockets(wss: WebSocketServer) {
  wss.on('connection', (ws, req) => {
    // Basic URL parsing to get session id
    const url = req.url;
    // Expected format: /ws/karaoke?sessionId=xxxx
    const params = new URLSearchParams(url?.split('?')[1]);
    const sessionId = params.get('sessionId');

    if (!sessionId) {
      ws.close(1008, 'Session ID required');
      return;
    }

    if (!activeRooms.has(sessionId)) {
      activeRooms.set(sessionId, {
        playing: false,
        position: 0,
        currentSongId: null,
        clients: new Set(),
      });
    }

    const room = activeRooms.get(sessionId)!;
    room.clients.add(ws);

    // Send initial state
    ws.send(JSON.stringify({
      type: 'STATE_UPDATE',
      payload: {
        playing: room.playing,
        position: room.position,
        currentSongId: room.currentSongId
      }
    }));

    ws.on('message', (message) => {
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
            // Host sends sync periodically, broadcast to controllers if needed
            broadcastToRoom(sessionId, { type: 'SYNC', payload: { position: room.position, playing: room.playing } });
            break;
          case 'QUEUE_UPDATE':
            // Client added something to queue, notify everyone
            broadcastToRoom(sessionId, { type: 'QUEUE_UPDATED' });
            break;
          case 'SONG_CHANGED':
            room.currentSongId = data.payload.songId;
            room.position = 0;
            room.playing = true;
            broadcastToRoom(sessionId, { type: 'SONG_CHANGED', payload: { songId: room.currentSongId } });
            break;
        }
      } catch (err) {
        console.error('WS message error', err);
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      if (room.clients.size === 0) {
        activeRooms.delete(sessionId);
      }
    });
  });
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
