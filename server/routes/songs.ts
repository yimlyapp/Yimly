import express, { Router } from 'express';
import { db } from '../db/index.js';
import { songs, artists, albums, lyrics, songArtists, playlistSongs, favorites, queueItems } from '../db/schema.js';
import { eq, like, or, inArray, asc } from 'drizzle-orm';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { broadcastSongOffsetToRooms } from '../ws/index.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

/**
 * Helper to fetch and map multiple artists for a list of song IDs
 */
export async function getSongArtistsMap(songIds: number[]) {
  const map = new Map<number, Array<{ id: number; name: string }>>();
  if (songIds.length === 0) return map;

  const records = await db.select({
    songId: songArtists.songId,
    artistId: artists.id,
    artistName: artists.name,
    position: songArtists.position,
  })
  .from(songArtists)
  .innerJoin(artists, eq(songArtists.artistId, artists.id))
  .where(inArray(songArtists.songId, songIds))
  .orderBy(asc(songArtists.position));

  for (const r of records) {
    if (!map.has(r.songId)) {
      map.set(r.songId, []);
    }
    map.get(r.songId)!.push({ id: r.artistId, name: r.artistName });
  }

  return map;
}

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
      lyricOffset: songs.lyricOffset,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id));

    const songIds = allSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    // Fetch lyrics presence without joining on table to avoid duplicate rows
    const lyricsList = songIds.length > 0
      ? await db.select({ songId: lyrics.songId }).from(lyrics).where(inArray(lyrics.songId, songIds))
      : [];
    const lyricsSet = new Set(lyricsList.map(l => l.songId));

    const formatted = allSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      return {
        ...s,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: lyricsSet.has(s.id)
      };
    });

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

    // Find song IDs where any linked artist matches search
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
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(
      or(
        like(songs.title, searchStr),
        like(artists.name, searchStr),
        like(albums.title, searchStr),
        like(songs.mainAudioPath, searchStr),
        songIdsFromArtists.length > 0 ? inArray(songs.id, songIdsFromArtists) : undefined
      )
    )
    .limit(30);

    const songIds = searchSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    const formatted = searchSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      return {
        type: 'song',
        ...s,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
      };
    });

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
      lyricOffset: songs.lyricOffset,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .leftJoin(lyrics, eq(songs.id, lyrics.songId))
    .where(eq(songs.id, id))
    .limit(1);

    if (songRec.length === 0) return res.status(404).json({ error: 'Song not found' });

    const artistsMap = await getSongArtistsMap([id]);
    const trackArtists = artistsMap.get(id) || (songRec[0].artist ? [{ id: songRec[0].artistId, name: songRec[0].artist }] : []);

    res.json({
      ...songRec[0],
      artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : songRec[0].artist),
      artists: trackArtists,
      hasArtwork: !!songRec[0].artworkPath || !!songRec[0].albumArtworkPath,
      hasLrc: !!songRec[0].hasLrc,
      hasInstrumental: !!songRec[0].hasInstrumental,
      lyricOffset: songRec[0].lyricOffset ?? 0,
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
    
    if (lrc.length > 0 && fs.existsSync(lrc[0].lrcPath)) {
      const content = await fs.promises.readFile(lrc[0].lrcPath, 'utf-8');
      return res.type('text/plain').send(content);
    }

    // On-demand filesystem discovery if not yet indexed in database
    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length > 0) {
      const audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
      if (audioPath && fs.existsSync(audioPath)) {
        const dir = path.dirname(audioPath);
        const audioExt = path.extname(audioPath);
        const audioBase = path.basename(audioPath, audioExt);
        const cleanBase = audioBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();

        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const lrcEntries = entries.filter(e => e.isFile() && (e.name.toLowerCase().endsWith('.elrc.lrc') || e.name.toLowerCase().endsWith('.lrc')));

        const parsedLrcs = lrcEntries.map(e => {
          const lower = e.name.toLowerCase();
          const isElrc = lower.endsWith('.elrc.lrc');
          const extLen = isElrc ? 9 : 4;
          const lrcBase = e.name.slice(0, -extLen);
          const cleanLrcBase = lrcBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
          return {
            name: e.name,
            fullPath: path.join(dir, e.name),
            lrcBase,
            cleanLrcBase,
            isElrc,
          };
        });

        const elrcFiles = parsedLrcs.filter(l => l.isElrc);
        const stdLrcFiles = parsedLrcs.filter(l => !l.isElrc);

        let matchedPath: string | null = null;

        for (const pool of [elrcFiles, stdLrcFiles]) {
          if (pool.length === 0) continue;

          // 1. Direct base match (e.g. Song.mp3 -> Song.elrc.lrc / Song.lrc)
          const exact = pool.find(l => l.lrcBase.trim().toLowerCase() === audioBase.trim().toLowerCase());
          if (exact) {
            matchedPath = exact.fullPath;
            break;
          }

          // 2. Clean variant match
          const clean = pool.find(l => l.cleanLrcBase.toLowerCase() === cleanBase.toLowerCase());
          if (clean) {
            matchedPath = clean.fullPath;
            break;
          }

          // 3. Title match
          const titleNorm = song[0].title.trim().toLowerCase();
          const titleMatch = pool.find(l => l.lrcBase.trim().toLowerCase() === titleNorm);
          if (titleMatch) {
            matchedPath = titleMatch.fullPath;
            break;
          }
        }

        if (matchedPath) {
          // Persist match to database for future queries
          if (lrc.length === 0) {
            await db.insert(lyrics).values({ songId: id, lrcPath: matchedPath });
          } else {
            await db.update(lyrics).set({ lrcPath: matchedPath }).where(eq(lyrics.id, lrc[0].id));
          }
          const content = await fs.promises.readFile(matchedPath, 'utf-8');
          return res.type('text/plain').send(content);
        }
      }
    }

    return res.status(404).json({ error: 'Lyrics not found' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
});

router.get('/:id/lyrics/offset', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select({ lyricOffset: songs.lyricOffset }).from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    const offset = song[0].lyricOffset ?? 0;
    res.json({ songId: id, offset, lyricOffset: offset });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch lyric offset' });
  }
});

const updateSongLyricOffset = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const rawOffset = req.body?.offset !== undefined ? req.body.offset : req.body?.lyricOffset;
    if (rawOffset === undefined || isNaN(Number(rawOffset))) {
      return res.status(400).json({ error: 'Offset must be a valid number in milliseconds' });
    }

    const offset = Math.round(Number(rawOffset));
    const existing = await db.select({ id: songs.id }).from(songs).where(eq(songs.id, id)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'Song not found' });

    await db.update(songs).set({ lyricOffset: offset }).where(eq(songs.id, id));

    // Broadcast updated offset to active websocket rooms playing this song
    broadcastSongOffsetToRooms(id, offset);

    res.json({ success: true, songId: id, offset, lyricOffset: offset });
  } catch (error) {
    console.error('Failed to update song lyric offset:', error);
    res.status(500).json({ error: 'Failed to update song lyric offset' });
  }
};

router.put('/:id/lyrics/offset', updateSongLyricOffset);
router.post('/:id/lyrics/offset', updateSongLyricOffset);
router.patch('/:id/lyrics/offset', updateSongLyricOffset);

// --- LRC Management Routes ---

const handleUploadOrUpdateLrc = async (req: AuthenticatedRequest, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    let lrcContent = '';
    if (typeof req.body === 'string') {
      lrcContent = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      lrcContent = req.body.toString('utf-8');
    } else if (req.body && typeof req.body === 'object') {
      lrcContent = req.body.content || req.body.lyrics || req.body.lrc || '';
    }

    if (typeof lrcContent !== 'string') {
      lrcContent = String(lrcContent || '');
    }

    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    let lrcPath = existingLrc.length > 0 ? existingLrc[0].lrcPath : null;

    if (!lrcPath) {
      const audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
      if (!audioPath) {
        return res.status(400).json({ error: 'Song has no audio path associated' });
      }
      const dir = path.dirname(audioPath);
      const audioExt = path.extname(audioPath);
      const baseName = path.basename(audioPath, audioExt);
      const cleanBase = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
      lrcPath = path.join(dir, `${cleanBase}.lrc`);
    }

    const dir = path.dirname(lrcPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(lrcPath, lrcContent, 'utf-8');

    if (existingLrc.length === 0) {
      await db.insert(lyrics).values({ songId: id, lrcPath });
    } else {
      await db.update(lyrics).set({ lrcPath }).where(eq(lyrics.songId, id));
    }

    res.json({
      success: true,
      songId: id,
      lrcPath,
      hasLrc: true,
      content: lrcContent,
    });
  } catch (error) {
    console.error('Failed to save LRC:', error);
    res.status(500).json({ error: 'Failed to save LRC lyrics' });
  }
};

router.post('/:id/lrc', requireAdmin, express.text({ type: ['text/*', 'application/octet-stream', 'application/json'] }), handleUploadOrUpdateLrc);
router.put('/:id/lrc', requireAdmin, express.text({ type: ['text/*', 'application/octet-stream', 'application/json'] }), handleUploadOrUpdateLrc);
router.patch('/:id/lrc', requireAdmin, express.text({ type: ['text/*', 'application/octet-stream', 'application/json'] }), handleUploadOrUpdateLrc);

router.delete('/:id/lrc', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    if (existingLrc.length > 0) {
      if (existingLrc[0].lrcPath && fs.existsSync(existingLrc[0].lrcPath)) {
        try { fs.unlinkSync(existingLrc[0].lrcPath); } catch (e) {}
      }
      await db.delete(lyrics).where(eq(lyrics.songId, id));
    }

    res.json({ success: true, songId: id, hasLrc: false });
  } catch (error) {
    console.error('Failed to delete LRC:', error);
    res.status(500).json({ error: 'Failed to delete LRC lyrics' });
  }
});

// --- Complete Song Delete Route ---

router.delete('/:id', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    const targetSong = song[0];
    const filesToDelete: string[] = [];

    if (targetSong.mainAudioPath && fs.existsSync(targetSong.mainAudioPath)) {
      filesToDelete.push(targetSong.mainAudioPath);
    }
    if (targetSong.instrumentalAudioPath && fs.existsSync(targetSong.instrumentalAudioPath)) {
      filesToDelete.push(targetSong.instrumentalAudioPath);
    }

    const lrcRec = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    if (lrcRec.length > 0 && lrcRec[0].lrcPath && fs.existsSync(lrcRec[0].lrcPath)) {
      filesToDelete.push(lrcRec[0].lrcPath);
    }

    if (targetSong.mainAudioPath) {
      const dir = path.dirname(targetSong.mainAudioPath);
      const audioExt = path.extname(targetSong.mainAudioPath);
      const baseName = path.basename(targetSong.mainAudioPath, audioExt);
      const cleanBase = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();

      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const lowerName = entry.name.toLowerCase();
            if (entry.isFile() && (lowerName.endsWith('.elrc.lrc') || lowerName.endsWith('.lrc'))) {
              const isElrc = lowerName.endsWith('.elrc.lrc');
              const extLen = isElrc ? 9 : 4;
              const lrcBase = entry.name.slice(0, -extLen);
              const cleanLrcBase = lrcBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();
              if (cleanLrcBase === cleanBase || lrcBase.toLowerCase() === baseName.toLowerCase()) {
                const fullLrcPath = path.join(dir, entry.name);
                if (!filesToDelete.includes(fullLrcPath)) {
                  filesToDelete.push(fullLrcPath);
                }
              }
            }
          }
        } catch (e) {}
      }
    }

    for (const filePath of filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete file ${filePath}:`, err);
      }
    }

    await db.delete(lyrics).where(eq(lyrics.songId, id));
    await db.delete(playlistSongs).where(eq(playlistSongs.songId, id));
    await db.delete(favorites).where(eq(favorites.songId, id));
    await db.delete(queueItems).where(eq(queueItems.songId, id));
    await db.delete(songArtists).where(eq(songArtists.songId, id));
    await db.delete(songs).where(eq(songs.id, id));

    res.json({
      success: true,
      deletedSongId: id,
      deletedFiles: filesToDelete,
    });
  } catch (error) {
    console.error('Failed to delete song completely:', error);
    res.status(500).json({ error: 'Failed to delete song' });
  }
});

export default router;
