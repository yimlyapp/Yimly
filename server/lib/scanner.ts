import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/index.js';
import { libraries, artists, albums, songs, lyrics } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

interface ScannedSong {
  artist: string;
  title: string;
  mainAudio?: string;
  instrumentalAudio?: string;
  lrc?: string;
}

export async function scanLibrary(libraryId: number, dirPath: string) {
  const songsMap = new Map<string, ScannedSong>();

  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        processFile(fullPath, entry.name);
      }
    }
  }

  function processFile(fullPath: string, filename: string) {
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);

    if (ext === '.mp3' || ext === '.lrc') {
      // Very basic parsing: Artist - Title (Instrumental)
      const match = baseName.match(/^(.*?)\s*-\s*(.*?)(?:\s*\((Instrumental|Karaoke|Vocals)\))?$/i);
      
      let artist = 'Unknown Artist';
      let title = baseName;
      let isInstrumental = false;

      if (match) {
        artist = match[1].trim();
        title = match[2].trim();
        if (match[3] && match[3].toLowerCase() === 'instrumental') {
          isInstrumental = true;
        }
      }

      const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
      
      if (!songsMap.has(key)) {
        songsMap.set(key, { artist, title });
      }
      const songInfo = songsMap.get(key)!;

      if (ext === '.lrc') {
        songInfo.lrc = fullPath;
      } else if (ext === '.mp3') {
        if (isInstrumental) {
          songInfo.instrumentalAudio = fullPath;
        } else {
          songInfo.mainAudio = fullPath;
        }
      }
    }
  }

  await walk(dirPath);

  // Now insert into database
  for (const song of songsMap.values()) {
    if (!song.mainAudio && !song.instrumentalAudio) continue; // Need at least some audio

    // Upsert artist
    let artistRec = await db.select().from(artists).where(eq(artists.name, song.artist)).limit(1);
    let artistId;
    if (artistRec.length === 0) {
      const inserted = await db.insert(artists).values({ name: song.artist }).returning();
      artistId = inserted[0].id;
    } else {
      artistId = artistRec[0].id;
    }

    // Check if song exists
    const existingSong = await db.select().from(songs).where(
      and(eq(songs.artistId, artistId), eq(songs.title, song.title), eq(songs.libraryId, libraryId))
    ).limit(1);

    let songId;
    if (existingSong.length === 0) {
      const inserted = await db.insert(songs).values({
        libraryId,
        artistId,
        title: song.title,
        mainAudioPath: song.mainAudio || song.instrumentalAudio!,
        instrumentalAudioPath: song.instrumentalAudio,
      }).returning();
      songId = inserted[0].id;
    } else {
      songId = existingSong[0].id;
      await db.update(songs).set({
        mainAudioPath: song.mainAudio || existingSong[0].mainAudioPath,
        instrumentalAudioPath: song.instrumentalAudio || existingSong[0].instrumentalAudioPath,
      }).where(eq(songs.id, songId));
    }

    if (song.lrc) {
      const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, songId)).limit(1);
      if (existingLrc.length === 0) {
        await db.insert(lyrics).values({
          songId,
          lrcPath: song.lrc
        });
      } else {
        await db.update(lyrics).set({ lrcPath: song.lrc }).where(eq(lyrics.id, existingLrc[0].id));
      }
    }
  }

  await db.update(libraries).set({ lastScan: new Date() }).where(eq(libraries.id, libraryId));
}
