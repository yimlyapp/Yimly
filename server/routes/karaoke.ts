import { Router } from 'express';
import { db } from '../db/index.js';
import { sessions, controllers, queueItems, songs, artists, albums, songArtists, users, settings } from '../db/schema.js';
import { eq, and, asc, or, inArray, like } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { 
  notifyQueueUpdate, 
  closeSessionWS, 
  handleHostHeartbeat, 
  advanceQueueBySessionId, 
  getRoomState,
  broadcastLyricSettingsToSession,
  broadcastLyricSettingsToAllActiveRooms
} from '../ws/index.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import { DEFAULT_LYRICS_SETTINGS, resolveLyricsSettings, LyricsAppearanceSettings } from '../lib/lyrics-settings.js';

const router = Router();
router.use(requireAuth);

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Global Lyric Appearance Settings (Host defaults)
router.get('/settings/lyrics', async (req, res) => {
  try {
    const saved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
    if (saved.length > 0 && saved[0].value) {
      try {
        const resolved = resolveLyricsSettings(JSON.parse(saved[0].value));
        return res.json({ settings: resolved });
      } catch (e) {
        // ignore parse error
      }
    }
    res.json({ settings: DEFAULT_LYRICS_SETTINGS });
  } catch (error) {
    console.error('Failed to fetch lyric settings:', error);
    res.status(500).json({ error: 'Failed to fetch lyric settings' });
  }
});

const saveGlobalLyricsSettings = async (req: any, res: any) => {
  try {
    const raw = req.body?.settings || req.body;
    const resolved = resolveLyricsSettings(raw);
    const jsonStr = JSON.stringify(resolved);

    // Save to settings table
    const existing = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
    if (existing.length === 0) {
      await db.insert(settings).values({ key: 'lyrics_appearance_settings', value: jsonStr });
    } else {
      await db.update(settings).set({ value: jsonStr }).where(eq(settings.key, 'lyrics_appearance_settings'));
    }

    // Also update any active sessions and broadcast to active rooms
    try {
      await db.update(sessions)
        .set({ lyricSettings: jsonStr, updatedAt: new Date() })
        .where(eq(sessions.status, 'active'));
    } catch (e) {
      // ignore
    }

    broadcastLyricSettingsToAllActiveRooms(resolved);

    res.json({ success: true, settings: resolved });
  } catch (error) {
    console.error('Failed to save lyric settings:', error);
    res.status(500).json({ error: 'Failed to save lyric settings' });
  }
};

router.put('/settings/lyrics', saveGlobalLyricsSettings);
router.post('/settings/lyrics', saveGlobalLyricsSettings);

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

    const hostId = user?.id;
    if (!hostId) {
      return res.status(401).json({ error: 'Authentication required to create a karaoke room' });
    }

    // Determine initial lyric settings
    let initialLyricsSettings = DEFAULT_LYRICS_SETTINGS;
    if (req.body?.lyricSettings) {
      initialLyricsSettings = resolveLyricsSettings(req.body.lyricSettings);
    } else {
      const globalSaved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
      if (globalSaved.length > 0 && globalSaved[0].value) {
        try {
          initialLyricsSettings = resolveLyricsSettings(JSON.parse(globalSaved[0].value));
        } catch (e) {
          // ignore
        }
      }
    }

    const inserted = await db.insert(sessions).values({
      id: sessionId,
      roomCode: `${roomCode.slice(0,3)} ${roomCode.slice(3)}`,
      hostId: hostId,
      hostDevice: device,
      lyricSettings: JSON.stringify(initialLyricsSettings),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    res.json({
      ...inserted[0],
      lyricSettings: initialLyricsSettings
    });
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

    // A Karaoke Guest is NOT a Yimly User and must NEVER create a record in the users table.
    // If the caller is already authenticated as a real Yimly user, associate user.id.
    // Otherwise, associate guestName with this temporary controller only.
    const userId = user?.id || null;
    const guestName = !userId ? ((displayName || username || 'Guest').trim() || 'Guest') : null;

    const controllerId = crypto.randomUUID();
    await db.insert(controllers).values({
      id: controllerId,
      sessionId: session[0].id,
      userId: userId,
      guestName: guestName,
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

// Host Heartbeat Endpoint
router.post('/sessions/:sessionId/heartbeat', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0 || session[0].status !== 'active') {
      return res.status(410).json({ error: 'Session expired or not found', code: 'ROOM_EXPIRED' });
    }
    await handleHostHeartbeat(sessionId);
    res.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('[HEARTBEAT] Failed:', error);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});

// Skip Track Endpoint
router.post('/sessions/:sessionId/skip', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0 || session[0].status !== 'active') {
      return res.status(410).json({ error: 'Session expired or not found', code: 'ROOM_EXPIRED' });
    }
    await advanceQueueBySessionId(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('[SKIP] Failed:', error);
    res.status(500).json({ error: 'Failed to advance queue' });
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

    let lyricSettings = DEFAULT_LYRICS_SETTINGS;
    if (session[0].lyricSettings) {
      try {
        lyricSettings = resolveLyricsSettings(JSON.parse(session[0].lyricSettings));
      } catch (e) {
        // ignore
      }
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
          error: 'Invalid or expired guest controller ID for this room', 
          code: 'INVALID_CONTROLLER' 
        });
      }

      let guestUsername = 'Guest';
      if (controller[0].guestName) {
        guestUsername = controller[0].guestName;
      } else if (controller[0].userId) {
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
        guestUsername,
        lyricSettings
      });
    }

    // Role is host - verify authenticated user owns room or is admin
    const user = (req as any).user;
    if (!user || !user.id) {
      return res.status(401).json({ 
        valid: false, 
        error: 'Authentication required for host access', 
        code: 'AUTH_REQUIRED' 
      });
    }
    if (session[0].hostId !== user.id && user.role !== 'administrator') {
      return res.status(403).json({ 
        valid: false, 
        error: 'Forbidden: You are not the host of this karaoke room', 
        code: 'FORBIDDEN_NOT_HOST' 
      });
    }

    // Register host heartbeat
    await handleHostHeartbeat(sessionId);

    return res.json({
      valid: true,
      role: 'host',
      session: session[0],
      lyricSettings
    });
  } catch (error) {
    console.error('Failed to validate session:', error);
    res.status(500).json({ valid: false, error: 'Failed to validate session' });
  }
});

// Session-specific Lyric Settings GET & PUT
router.get('/sessions/:sessionId/lyrics-settings', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const live = getRoomState(sessionId);
    if (live) {
      return res.json({ sessionId, settings: live.lyricSettings });
    }

    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    let resolved = DEFAULT_LYRICS_SETTINGS;
    if (session[0].lyricSettings) {
      try {
        resolved = resolveLyricsSettings(JSON.parse(session[0].lyricSettings));
      } catch (e) {
        // ignore
      }
    }

    res.json({ sessionId, settings: resolved });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session lyric settings' });
  }
});

const updateSessionLyricsSettings = async (req: any, res: any) => {
  try {
    const { sessionId } = req.params;
    const raw = req.body?.settings || req.body;
    const resolved = resolveLyricsSettings(raw);
    const jsonStr = JSON.stringify(resolved);

    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await db.update(sessions)
      .set({ lyricSettings: jsonStr, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    broadcastLyricSettingsToSession(sessionId, resolved);

    res.json({ success: true, sessionId, settings: resolved });
  } catch (error) {
    console.error('Failed to update session lyric settings:', error);
    res.status(500).json({ error: 'Failed to update session lyric settings' });
  }
};

router.put('/sessions/:sessionId/lyrics-settings', updateSessionLyricsSettings);
router.post('/sessions/:sessionId/lyrics-settings', updateSessionLyricsSettings);

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
      guestName: queueItems.guestName,
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
      const singerDisplay = q.guestName || q.userName || 'Guest';
      return {
        ...q,
        userName: singerDisplay,
        artistName: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : q.artistName),
        artists: trackArtists,
        hasArtwork: !!q.artworkPath,
      };
    });

    const liveState = getRoomState(sessionId);
    let resolvedLyricSettings = DEFAULT_LYRICS_SETTINGS;
    if (liveState?.lyricSettings) {
      resolvedLyricSettings = liveState.lyricSettings;
    } else if (session[0].lyricSettings) {
      try {
        resolvedLyricSettings = resolveLyricsSettings(JSON.parse(session[0].lyricSettings));
      } catch (e) {
        // ignore
      }
    }

    res.json({
      session: {
        ...session[0],
        lyricSettings: resolvedLyricSettings
      },
      queue: formattedQueue,
      lyricSettings: resolvedLyricSettings,
      playback: liveState ? {
        playing: liveState.playing,
        position: liveState.position,
        currentSongId: liveState.currentSongId,
        currentQueueItemId: liveState.currentQueueItemId,
        variant: liveState.variant,
        lyricOffset: liveState.lyricOffset,
        lyricSettings: liveState.lyricSettings
      } : null
    });
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

    let userId: number | null = null;
    let guestName: string | null = null;

    if (user?.id) {
      userId = user.id;
    } else if (controllerId) {
      const ctrl = await db.select().from(controllers).where(
        and(eq(controllers.id, controllerId), eq(controllers.sessionId, sessionId))
      ).limit(1);
      if (ctrl.length === 0) {
        return res.status(403).json({ error: 'Invalid controller for this room session' });
      }
      userId = ctrl[0].userId || null;
      guestName = ctrl[0].guestName || 'Guest';
    } else {
      return res.status(403).json({ error: 'Authentication or valid controller ID required' });
    }

    const inserted = await db.insert(queueItems).values({
      sessionId,
      songId: Number(songId),
      userId,
      guestName,
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

// Guest-scoped songs catalog for karaoke room queueing (minimal metadata, no filesystem paths)
router.get('/songs', async (req, res) => {
  try {
    const allSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      artistId: songs.artistId,
      album: albums.title,
      albumId: songs.albumId,
      duration: songs.duration,
      variant: songs.variant,
      genre: songs.genre,
      year: songs.year,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id));

    const songIds = allSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    const formatted = allSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      return {
        id: s.id,
        title: s.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        album: s.album,
        duration: s.duration,
        variant: s.variant,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch karaoke songs' });
  }
});

// Guest-scoped songs search for karaoke room queueing
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);

    const searchStr = `%${q}%`;

    const matchingArtistSongIds = await db.select({ songId: songArtists.songId })
      .from(songArtists)
      .innerJoin(artists, eq(songArtists.artistId, artists.id))
      .where(like(artists.name, searchStr));

    const songIdsFromArtists = matchingArtistSongIds.map(r => r.songId);

    const searchSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      artistId: songs.artistId,
      album: albums.title,
      albumId: songs.albumId,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
      duration: songs.duration,
      variant: songs.variant,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(
      or(
        like(songs.title, searchStr),
        like(artists.name, searchStr),
        like(albums.title, searchStr),
        songIdsFromArtists.length > 0 ? inArray(songs.id, songIdsFromArtists) : undefined
      )
    )
    .limit(30);

    const songIds = searchSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    const formatted = searchSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      return {
        id: s.id,
        title: s.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        album: s.album,
        duration: s.duration,
        variant: s.variant,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Karaoke search failed' });
  }
});

export default router;
