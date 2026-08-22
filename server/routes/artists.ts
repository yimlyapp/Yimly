import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, lyrics } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allArtists = await db.select({
      id: artists.id,
      name: artists.name,
      artworkPath: artists.artworkPath,
      songCount: sql<number>`(select count(*) from songs where songs.artist_id = artists.id)`,
      albumCount: sql<number>`(select count(*) from albums where albums.artist_id = artists.id)`,
    }).from(artists);
    res.json(allArtists);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    const artistRec = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artistRec.length === 0) return res.status(404).json({ error: 'Artist not found' });

    const artistAlbums = await db.select().from(albums).where(eq(albums.artistId, artistId));
    const artistSongs = await db.select({
      id: songs.id,
      title: songs.title,
      albumId: songs.albumId,
      duration: songs.duration,
      variant: songs.variant,
      hasLrc: lyrics.id,
    })
    .from(songs)
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .where(eq(songs.artistId, artistId));

    res.json({
      ...artistRec[0],
      albums: artistAlbums,
      songs: artistSongs.map(s => ({ ...s, hasLrc: !!s.hasLrc })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch artist details' });
  }
});

export default router;
