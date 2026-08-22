import { Router } from 'express';
import { db } from '../db/index.js';
import { songs, artists, lyrics } from '../db/schema.js';
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
      hasLrc: lyrics.id
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .limit(100);

    // Grouping boolean hasLrc
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
    const searchResults = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .where(
      or(
        like(songs.title, searchStr),
        like(artists.name, searchStr)
      )
    )
    .limit(20);

    res.json(searchResults);
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
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
