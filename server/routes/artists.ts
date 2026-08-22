import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, lyrics } from '../db/schema.js';
import { eq, sql, isNotNull, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';

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

    const formatted = allArtists.map(a => ({
      ...a,
      hasArtwork: !!a.artworkPath,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const artistRec = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artistRec.length === 0) return res.status(404).json({ error: 'Artist not found' });

    const artistAlbums = await db.select().from(albums).where(eq(albums.artistId, artistId));
    const artistSongs = await db.select({
      id: songs.id,
      title: songs.title,
      albumId: songs.albumId,
      duration: songs.duration,
      variant: songs.variant,
      artworkPath: songs.artworkPath,
      hasLrc: lyrics.id,
    })
    .from(songs)
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .where(eq(songs.artistId, artistId));

    res.json({
      ...artistRec[0],
      hasArtwork: !!artistRec[0].artworkPath,
      albums: artistAlbums.map(alb => ({
        ...alb,
        hasArtwork: !!alb.artworkPath,
      })),
      songs: artistSongs.map(s => ({
        ...s,
        hasArtwork: !!s.artworkPath || !!artistRec[0].artworkPath,
        hasLrc: !!s.hasLrc
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch artist details' });
  }
});

router.get('/:id/artwork', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const artist = await db.select({
      artworkPath: artists.artworkPath,
    }).from(artists).where(eq(artists.id, artistId)).limit(1);

    if (artist.length === 0) return res.status(404).json({ error: 'Artist not found' });

    let artworkFilename = artist[0].artworkPath;

    // Fallback: Check any album or song by this artist that has artwork
    if (!artworkFilename) {
      const albumWithArt = await db.select({ artworkPath: albums.artworkPath })
        .from(albums)
        .where(and(eq(albums.artistId, artistId), isNotNull(albums.artworkPath)))
        .limit(1);
      if (albumWithArt.length > 0 && albumWithArt[0].artworkPath) {
        artworkFilename = albumWithArt[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      const songWithArt = await db.select({ artworkPath: songs.artworkPath })
        .from(songs)
        .where(and(eq(songs.artistId, artistId), isNotNull(songs.artworkPath)))
        .limit(1);
      if (songWithArt.length > 0 && songWithArt[0].artworkPath) {
        artworkFilename = songWithArt[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      return res.status(404).json({ error: 'No embedded artwork found for this artist' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    const safeFilename = path.basename(artworkFilename);
    const filePath = path.join(dataDir, 'artwork', safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Cached artwork file not found on disk' });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve artist artwork' });
  }
});

export default router;
