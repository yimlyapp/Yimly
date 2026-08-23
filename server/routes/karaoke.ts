import { Router } from 'express';
import { db } from '../db/index.js';
import { sessions, controllers, queueItems, songs, artists, users } from '../db/schema.js';
import { eq, and, asc, or } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { notifyQueueUpdate, closeSessionWS } from '../ws/index.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';

const router = Router();
router.use(requireAuth);

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post('/sessions', async (req, res) => {
  try {
    const user = (req as any).user;
    const device = req.headers['user-agent'] || 'Unknown Device';
    
    // Close previous sessions hosted by this user to prevent stale sessions
    if (user?.id) {
      const oldActive = await db.select().from(sessions)
        .where(and(eq(sessions.hostId, user.id), eq(sessions.status, 'active')));
      
      for (const oldSess of oldActive) {
        await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, oldSess.id));
        await db.delete(queueItems).where(eq(queueItems.sessionId, oldSess.id));
        closeSessionWS(oldSess.id);
      }
    }
      
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

    // Determine hostId: user.id if logged in, or fallback to first admin / user in database
    let hostId = user?.id;
    if (!hostId) {
      const defaultUser = await db.select({ id: users.id }).from(users).limit(1);
      hostId = defaultUser[0]?.id || 1;
    }

    const inserted = await db.insert(sessions).values({
      id: sessionId,
      roomCode: `${roomCode.slice(0,3)} ${roomCode.slice(3)}`,
      hostId: hostId,
      hostDevice: device,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    res.json(inserted[0]);
  } catch (error) {
    console.error('Failed to create room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/sessions/join', async (req, res) => {
  try {
    const { roomCode, displayName, username } = req.body;
    if (!roomCode) {
      return res.status(400).json({ error: 'Room code is required' });
    }
    const user = (req as any).user;
    const device = req.headers['user-agent'] || 'Unknown Device';

    const normalizedCode = String(roomCode).replace(/\s+/g, '');
    const formattedCode = `${normalizedCode.slice(0, 3)} ${normalizedCode.slice(3)}`;

    const session = await db.select().from(sessions).where(
      and(
        or(
          eq(sessions.roomCode, roomCode),
          eq(sessions.roomCode, formattedCode),
          eq(sessions.roomCode, normalizedCode)
        ),
        eq(sessions.status, 'active')
      )
    ).limit(1);

    if (session.length === 0) {
      return res.status(404).json({ error: 'Room not found or inactive' });
    }

    let userId = user?.id || null;
    const requestedName = (displayName || username || '').trim();
    if (!userId && requestedName) {
      const existingUser = await db.select().from(users).where(eq(users.username, requestedName)).limit(1);
      if (existingUser.length > 0) {
        userId = existingUser[0].id;
      } else {
        const newGuest = await db.insert(users).values({
          username: requestedName,
          password: crypto.randomBytes(16).toString('hex'),
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();
        userId = newGuest[0]?.id || null;
      }
    }

    const controllerId = crypto.randomUUID();
    await db.insert(controllers).values({
      id: controllerId,
      sessionId: session[0].id,
      userId: userId,
      device: device,
      lastSeenTime: new Date(),
    });

    res.json({ sessionId: session[0].id, controllerId });
  } catch (error) {
    console.error('Failed to join room:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

router.get('/active-sessions', async (req, res) => {
  try {
    // Only return active sessions
    const active = await db.select().from(sessions).where(eq(sessions.status, 'active'));
    res.json(active);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Explicitly End Session Endpoint
router.post('/sessions/:sessionId/end', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, sessionId));
    await db.delete(queueItems).where(eq(queueItems.sessionId, sessionId));
    closeSessionWS(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to end session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Validate Room & Controller Endpoint
router.get('/sessions/:sessionId/validate', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const role = (req.query.role as string) || 'guest';
    const controllerId = req.query.controllerId as string;

    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ valid: false, error: 'Room not found', code: 'ROOM_NOT_FOUND' });
    }

    if (session[0].status !== 'active') {
      return res.status(410).json({ valid: false, error: 'This karaoke session has expired or ended', code: 'ROOM_EXPIRED' });
    }

    if (role === 'guest') {
      if (!controllerId) {
        return res.status(403).json({ 
          valid: false, 
          error: 'Controller ID required for guest access', 
          code: 'CONTROLLER_REQUIRED' 
        });
      }

      const controller = await db.select().from(controllers).where(
        and(eq(controllers.id, controllerId), eq(controllers.sessionId, sessionId))
      ).limit(1);

      if (controller.length === 0) {
        return res.status(403).json({ 
          valid: false, 
          error: 'Invalid or expired guest controller ID', 
          code: 'INVALID_CONTROLLER' 
        });
      }

      let guestUsername = 'Guest';
      if (controller[0].userId) {
        const u = await db.select().from(users).where(eq(users.id, controller[0].userId)).limit(1);
        if (u.length > 0) {
          guestUsername = u[0].username;
        }
      }

      return res.json({
        valid: true,
        role: 'guest',
        session: session[0],
        controller: controller[0],
        guestUsername
      });
    }

    // Role is host
    return res.json({
      valid: true,
      role: 'host',
      session: session[0]
    });
  } catch (error) {
    console.error('Failed to validate session:', error);
    res.status(500).json({ valid: false, error: 'Failed to validate session' });
  }
});

router.get('/sessions/:sessionId/state', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.status, 'active'))).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Session not found or inactive' });
    }

    const queue = await db.select({
      id: queueItems.id,
      position: queueItems.position,
      status: queueItems.status,
      songTitle: songs.title,
      artistName: artists.name,
      userId: queueItems.userId,
      userName: users.username,
      songId: songs.id,
      artworkPath: songs.artworkPath,
    })
    .from(queueItems)
    .innerJoin(songs, eq(queueItems.songId, songs.id))
    .innerJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(users, eq(queueItems.userId, users.id))
    .where(eq(queueItems.sessionId, sessionId))
    .orderBy(asc(queueItems.position));

    const songIds = queue.map(q => q.songId);
    const artistsMap = await getSongArtistsMap(songIds);

    const formattedQueue = queue.map(q => {
      const trackArtists = artistsMap.get(q.songId) || (q.artistName ? [{ id: 0, name: q.artistName }] : []);
      return {
        ...q,
        artistName: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : q.artistName),
        artists: trackArtists,
        hasArtwork: !!q.artworkPath,
      };
    });

    res.json({ session: session[0], queue: formattedQueue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// Add to Queue
router.post('/sessions/:sessionId/queue', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { songId, controllerId } = req.body;
    const user = (req as any).user;

    const session = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.status, 'active'))).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const song = await db.select().from(songs).where(eq(songs.id, Number(songId))).limit(1);
    if (song.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const existingQueue = await db.select().from(queueItems).where(eq(queueItems.sessionId, sessionId));
    const nextPosition = existingQueue.length > 0 ? Math.max(...existingQueue.map(q => q.position)) + 1 : 1;

    let userId = user?.id || null;
    if (!userId && controllerId) {
      const ctrl = await db.select().from(controllers).where(eq(controllers.id, controllerId)).limit(1);
      userId = ctrl[0]?.userId || null;
    }
    if (!userId) {
      userId = session[0].hostId || 1;
    }

    const inserted = await db.insert(queueItems).values({
      sessionId,
      songId,
      userId,
      addedAt: new Date(),
      position: nextPosition,
    }).returning();

    notifyQueueUpdate(sessionId);
    
    res.json(inserted[0]);
  } catch (error) {
    console.error('Failed to add to queue:', error);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

export default router;
