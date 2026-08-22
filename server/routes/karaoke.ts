import { Router } from 'express';
import { db } from '../db/index.js';
import { sessions, controllers, queueItems, songs, artists } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { notifyQueueUpdate } from '../ws/index.js';

const router = Router();
router.use(requireAuth);

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post('/sessions', async (req, res) => {
  try {
    const user = (req as any).user;
    const device = req.headers['user-agent'] || 'Unknown Device';
    
    // Deactivate previous sessions hosted by this user? For now just create a new one.
    const sessionId = crypto.randomUUID();
    let roomCode = generateRoomCode();
    
    // Ensure room code uniqueness
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db.select().from(sessions).where(eq(sessions.roomCode, roomCode)).limit(1);
      if (existing.length === 0) break;
      roomCode = generateRoomCode();
      attempts++;
    }

    const inserted = await db.insert(sessions).values({
      id: sessionId,
      roomCode: `${roomCode.slice(0,3)} ${roomCode.slice(3)}`, // Store formatted or unformatted? Let's format it.
      hostId: user.id,
      hostDevice: device,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    res.json(inserted[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/sessions/join', async (req, res) => {
  try {
    const { roomCode } = req.body;
    const user = (req as any).user;
    const device = req.headers['user-agent'] || 'Unknown Device';

    const session = await db.select().from(sessions).where(eq(sessions.roomCode, roomCode)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const controllerId = crypto.randomUUID();
    await db.insert(controllers).values({
      id: controllerId,
      sessionId: session[0].id,
      userId: user.id,
      device: device,
      lastSeenTime: new Date(),
    });

    res.json({ sessionId: session[0].id, controllerId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join room' });
  }
});

router.get('/active-sessions', async (req, res) => {
  try {
    // List all sessions for now
    const active = await db.select().from(sessions);
    res.json(active);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

router.get('/sessions/:sessionId/state', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const queue = await db.select({
      id: queueItems.id,
      position: queueItems.position,
      status: queueItems.status,
      songTitle: songs.title,
      artistName: artists.name,
      userId: queueItems.userId, // you would join with users to get name
      songId: songs.id
    })
    .from(queueItems)
    .innerJoin(songs, eq(queueItems.songId, songs.id))
    .innerJoin(artists, eq(songs.artistId, artists.id))
    .where(eq(queueItems.sessionId, sessionId))
    .orderBy(asc(queueItems.position));

    // You could also store playback state in DB, but in-memory in WS handler is also fine,
    // though the instructions mention "playback_state" table or similar. We can just keep it simple
    // and rely on WS for real-time playback state, or store it in a singleton.

    res.json({ session: session[0], queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// Add to Queue
router.post('/sessions/:sessionId/queue', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { songId } = req.body;
    const user = (req as any).user;

    const existingQueue = await db.select().from(queueItems).where(eq(queueItems.sessionId, sessionId));
    const nextPosition = existingQueue.length > 0 ? Math.max(...existingQueue.map(q => q.position)) + 1 : 1;

    const inserted = await db.insert(queueItems).values({
      sessionId,
      songId,
      userId: user.id,
      addedAt: new Date(),
      position: nextPosition,
    }).returning();

    notifyQueueUpdate(sessionId);
    
    res.json(inserted[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

export default router;
