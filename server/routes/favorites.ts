import { Router } from 'express';
import { db } from '../db/index.js';
import { favorites, songs, artists, albums, lyrics } from '../db/schema.js';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';

const router = Router();
router.use(requireAuth);

// GET /api/favorites - Get authenticated user's favorite songs
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const favs = await db.select({
      favoriteId: favorites.id,
      favoritedAt: favorites.createdAt,
      id: songs.id,
      title: songs.title,
      artistId: songs.artistId,
      artist: artists.name,
      albumId: songs.albumId,
      album: albums.title,
      duration: songs.duration,
      variant: songs.variant,
      genre: songs.genre,
      year: songs.year,
      trackNumber: songs.trackNumber,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
      lyricOffset: songs.lyricOffset,
    })
    .from(favorites)
    .innerJoin(songs, eq(favorites.songId, songs.id))
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(eq(favorites.userId, userId))
    .orderBy(asc(favorites.createdAt));

    const songIds = favs.map(f => f.id);
    const artistsMap = await getSongArtistsMap(songIds);

    const lyricsList = songIds.length > 0
      ? await db.select({ songId: lyrics.songId }).from(lyrics).where(inArray(lyrics.songId, songIds))
      : [];
    const lyricsSet = new Set(lyricsList.map(l => l.songId));

    const formatted = favs.map(f => {
      const trackArtists = artistsMap.get(f.id) || (f.artist ? [{ id: f.artistId, name: f.artist }] : []);
      return {
        id: f.id,
        title: f.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : f.artist),
        artists: trackArtists,
        album: f.album,
        albumId: f.albumId,
        duration: f.duration,
        variant: f.variant,
        genre: f.genre,
        year: f.year,
        trackNumber: f.trackNumber,
        artworkPath: f.artworkPath,
        albumArtworkPath: f.albumArtworkPath,
        hasArtwork: !!f.artworkPath || !!f.albumArtworkPath,
        hasLrc: lyricsSet.has(f.id),
        favoriteId: f.favoriteId,
        favoritedAt: f.favoritedAt,
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Failed to fetch favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// GET /api/favorites/:songId - Check if song is favorited
router.get('/:songId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const songId = parseInt(req.params.songId);
    if (isNaN(songId)) return res.status(400).json({ error: 'Invalid song ID' });

    const existing = await db.select()
      .from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.songId, songId)))
      .limit(1);

    res.json({
      songId,
      favorited: existing.length > 0,
      favoriteId: existing.length > 0 ? existing[0].id : null,
    });
  } catch (error) {
    console.error('Failed to check favorite status:', error);
    res.status(500).json({ error: 'Failed to check favorite status' });
  }
});

// POST /api/favorites/:songId - Add song to favorites
router.post('/:songId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const songId = parseInt(req.params.songId);
    if (isNaN(songId)) return res.status(400).json({ error: 'Invalid song ID' });

    // Verify song exists
    const song = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
    if (song.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Check if already favorited
    const existing = await db.select()
      .from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.songId, songId)))
      .limit(1);

    let favRecord;
    if (existing.length > 0) {
      favRecord = existing[0];
    } else {
      const inserted = await db.insert(favorites).values({
        userId,
        songId,
        createdAt: new Date(),
      }).returning();
      favRecord = inserted[0];
    }

    res.status(201).json({
      songId,
      favorited: true,
      favoriteId: favRecord.id,
      createdAt: favRecord.createdAt,
    });
  } catch (error) {
    console.error('Failed to add favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// DELETE /api/favorites/:songId - Remove song from favorites
router.delete('/:songId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const songId = parseInt(req.params.songId);
    if (isNaN(songId)) return res.status(400).json({ error: 'Invalid song ID' });

    await db.delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.songId, songId)));

    res.json({
      songId,
      favorited: false,
      message: 'Removed from favorites successfully',
    });
  } catch (error) {
    console.error('Failed to remove favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

export default router;
