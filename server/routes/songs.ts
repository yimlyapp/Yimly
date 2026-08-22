import { Router } from 'express';
import { db } from '../db/index.js';
import { songs, artists, albums, lyrics } from '../db/schema.js';
import { eq, like, or } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
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
      trackNumber: songs.trackNumber,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
      hasLrc: lyrics.id
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .limit(500);

    const formatted = allSongs.map(s => ({
      ...s,
      hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
      hasLrc: !!s.hasLrc
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);

    const searchStr = `%${q}%`;
    const searchSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      album: albums.title,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(
      or(
        like(songs.title, searchStr),
        like(artists.name, searchStr),
        like(albums.title, searchStr),
        like(songs.mainAudioPath, searchStr)
      )
    )
    .limit(20);

    const formatted = searchSongs.map(s => ({
      type: 'song',
      hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
      ...s
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const songRec = await db.select({
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
      discNumber: songs.discNumber,
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
      hasInstrumental: songs.instrumentalAudioPath,
      hasLrc: lyrics.id,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .where(eq(songs.id, id))
    .limit(1);

    if (songRec.length === 0) return res.status(404).json({ error: 'Song not found' });

    res.json({
      ...songRec[0],
      hasArtwork: !!songRec[0].artworkPath || !!songRec[0].albumArtworkPath,
      hasLrc: !!songRec[0].hasLrc,
      hasInstrumental: !!songRec[0].hasInstrumental
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch song details' });
  }
});

router.get('/:id/artwork', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select({
      artworkPath: songs.artworkPath,
      albumId: songs.albumId,
    }).from(songs).where(eq(songs.id, id)).limit(1);

    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    let artworkFilename = song[0].artworkPath;

    // Fallback to album's embedded artwork if song does not directly reference it
    if (!artworkFilename && song[0].albumId) {
      const album = await db.select({ artworkPath: albums.artworkPath })
        .from(albums)
        .where(eq(albums.id, song[0].albumId))
        .limit(1);
      if (album.length > 0 && album[0].artworkPath) {
        artworkFilename = album[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      return res.status(404).json({ error: 'No embedded artwork found for this track' });
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
    res.status(500).json({ error: 'Failed to serve artwork' });
  }
});

router.get('/:id/audio', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const type = req.query.type as string; // 'main' or 'instrumental'

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    let audioPath = song[0].mainAudioPath;
    if (type === 'instrumental' && song[0].instrumentalAudioPath) {
      audioPath = song[0].instrumentalAudioPath;
    }

    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ error: 'Audio file not found on disk' });
    }

    res.sendFile(audioPath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve audio' });
  }
});

router.get('/:id/lyrics', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    
    if (lrc.length === 0 || !fs.existsSync(lrc[0].lrcPath)) {
      return res.status(404).json({ error: 'Lyrics not found' });
    }

    const content = await fs.promises.readFile(lrc[0].lrcPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
});

export default router;
