import { Router } from 'express';
import { db } from '../db/index.js';
import { songs, artists, albums, lyrics } from '../db/schema.js';
import { eq, like, or } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import fs from 'fs';

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
      hasLrc: lyrics.id
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .limit(500);

    const formatted = allSongs.map(s => ({
      ...s,
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
      hasLrc: !!songRec[0].hasLrc,
      hasInstrumental: !!songRec[0].hasInstrumental
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch song details' });
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
