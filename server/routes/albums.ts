import { Router } from 'express';
import { db } from '../db/index.js';
import { albums, artists, songs, lyrics } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allAlbums = await db.select({
      id: albums.id,
      title: albums.title,
      year: albums.year,
      artworkPath: albums.artworkPath,
      artistId: albums.artistId,
      artist: artists.name,
      songCount: sql<number>`(select count(*) from songs where songs.album_id = albums.id)`,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.artistId, artists.id));

    res.json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch albums' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const albumId = parseInt(req.params.id);
    const albumRec = await db.select({
      id: albums.id,
      title: albums.title,
      year: albums.year,
      artworkPath: albums.artworkPath,
      artistId: albums.artistId,
      artist: artists.name,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.artistId, artists.id))
    .where(eq(albums.id, albumId))
    .limit(1);

    if (albumRec.length === 0) return res.status(404).json({ error: 'Album not found' });

    const albumSongs = await db.select({
      id: songs.id,
      title: songs.title,
      trackNumber: songs.trackNumber,
      discNumber: songs.discNumber,
      duration: songs.duration,
      variant: songs.variant,
      hasLrc: lyrics.id,
    })
    .from(songs)
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .where(eq(songs.albumId, albumId));

    res.json({
      ...albumRec[0],
      songs: albumSongs.map(s => ({ ...s, hasLrc: !!s.hasLrc })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch album details' });
  }
});

export default router;
