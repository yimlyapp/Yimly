import { Router } from 'express';
import { db } from '../db/index.js';
import { songs, artists, albums, lyrics, songArtists } from '../db/schema.js';
import { eq, like, or, inArray, asc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
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
        const lrcFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.lrc')).map(e => e.name);

        // 1. Direct base match (e.g. Song.mp3 -> Song.lrc or song.lrc)
        const exactLrc = lrcFiles.find(name => {
          const lrcBase = name.slice(0, -4);
          return lrcBase.trim().toLowerCase() === audioBase.trim().toLowerCase();
        });

        // 2. Clean variant match
        const cleanLrc = lrcFiles.find(name => {
          const lrcBase = name.slice(0, -4).replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
          return lrcBase.toLowerCase() === cleanBase.toLowerCase();
        });

        // 3. Title match
        const titleNorm = song[0].title.trim().toLowerCase();
        const titleLrc = lrcFiles.find(name => {
          const lrcBase = name.slice(0, -4).trim().toLowerCase();
          return lrcBase === titleNorm;
        });

        const targetLrcName = exactLrc || cleanLrc || titleLrc;
        if (targetLrcName) {
          const matchedPath = path.join(dir, targetLrcName);
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

export default router;
