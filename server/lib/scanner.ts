import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { libraries, artists, albums, songs, lyrics } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import * as mm from 'music-metadata';

interface ScannedMediaItem {
  artist: string;
  album: string;
  title: string;
  mainAudio?: string;
  instrumentalAudio?: string;
  lrc?: string;
  duration?: number;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  year?: number;
  variant: string;
  fileSize?: number;
  format?: string;
}

export async function scanLibrary(libraryId: number, dirPath: string) {
  const songsMap = new Map<string, ScannedMediaItem>();
  const foundFilePaths = new Set<string>();

  async function walk(currentPath: string) {
    if (!fsSync.existsSync(currentPath)) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        await processFile(fullPath, entry.name);
      }
    }
  }

  async function processFile(fullPath: string, filename: string) {
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);

    if (ext === '.mp3') {
      foundFilePaths.add(fullPath);
      let title = baseName;
      let artist = 'Unknown Artist';
      let album = 'Unknown Album';
      let duration = 0;
      let trackNumber: number | undefined = undefined;
      let discNumber: number | undefined = undefined;
      let genre: string | undefined = undefined;
      let year: number | undefined = undefined;
      let fileSize = 0;
      let format = 'mp3';
      let variant = 'original';

      try {
        const stats = await fs.stat(fullPath);
        fileSize = stats.size;

        const metadata = await mm.parseFile(fullPath, { duration: true });
        if (metadata.format.duration) {
          duration = Math.round(metadata.format.duration);
        }
        if (metadata.format.container) {
          format = metadata.format.container;
        }

        const common = metadata.common;
        if (common.title) {
          title = common.title.trim();
        }
        if (common.artist) {
          artist = common.artist.trim();
        } else if (common.albumartist) {
          artist = common.albumartist.trim();
        }
        if (common.album) {
          album = common.album.trim();
        }
        if (common.track && common.track.no) {
          trackNumber = common.track.no;
        }
        if (common.disk && common.disk.no) {
          discNumber = common.disk.no;
        }
        if (common.genre && common.genre.length > 0) {
          genre = common.genre.join(', ');
        }
        if (common.year) {
          year = common.year;
        }
      } catch (err) {
        // Fallback to filename parsing if ID3 reading fails
        console.warn(`Failed to read metadata for ${filename}, using filename fallbacks:`, err);
      }

      // Detect variant & filename fallbacks if metadata is missing/generic
      const lowerBase = baseName.toLowerCase();
      if (lowerBase.includes('instrumental') || lowerBase.includes('inst') || lowerBase.includes('karaoke') || lowerBase.includes('backing')) {
        variant = 'instrumental';
      } else if (lowerBase.includes('vocal') || lowerBase.includes('vocals')) {
        variant = 'vocal';
      }

      // Filename pattern fallback: "Artist - Title"
      const match = baseName.match(/^(.*?)\s*-\s*(.*?)(?:\s*\((Instrumental|Karaoke|Vocals|Backing)\))?$/i);
      if (match) {
        if (artist === 'Unknown Artist' && match[1]) {
          artist = match[1].trim();
        }
        if (title === baseName && match[2]) {
          title = match[2].trim();
        }
      }

      // Clean base title for grouping main and instrumental versions of the same song
      const cleanTitle = title
        .replace(/\s*\((instrumental|karaoke|vocals|backing version)\)\s*/gi, '')
        .trim();

      const key = `${artist.toLowerCase()}|${cleanTitle.toLowerCase()}`;

      if (!songsMap.has(key)) {
        songsMap.set(key, {
          artist,
          album,
          title: cleanTitle,
          variant,
          duration,
          trackNumber,
          discNumber,
          genre,
          year,
          fileSize,
          format,
        });
      }

      const songInfo = songsMap.get(key)!;
      if (variant === 'instrumental') {
        songInfo.instrumentalAudio = fullPath;
      } else {
        songInfo.mainAudio = fullPath;
        if (duration) songInfo.duration = duration;
        if (trackNumber) songInfo.trackNumber = trackNumber;
        if (discNumber) songInfo.discNumber = discNumber;
        if (genre) songInfo.genre = genre;
        if (year) songInfo.year = year;
        if (fileSize) songInfo.fileSize = fileSize;
        if (format) songInfo.format = format;
      }
    } else if (ext === '.lrc') {
      foundFilePaths.add(fullPath);
      // Associate .lrc with matching base song name
      const lrcKey = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version)\)\s*/gi, '').toLowerCase();
      let matched = false;
      
      for (const [key, songInfo] of songsMap.entries()) {
        const cleanTitle = songInfo.title.toLowerCase();
        // If the LRC filename contains the title, it's a good match
        if (lrcKey.includes(cleanTitle)) {
          songInfo.lrc = fullPath;
          matched = true;
          break;
        }
      }
      
      // If not matched, try looser match
      if (!matched) {
        for (const [key, songInfo] of songsMap.entries()) {
          if (key.includes(lrcKey) || lrcKey.includes(songInfo.title.toLowerCase())) {
            songInfo.lrc = fullPath;
            break;
          }
        }
      }
    }
  }

  await walk(dirPath);

  // Sync with Database
  for (const song of songsMap.values()) {
    if (!song.mainAudio && !song.instrumentalAudio) continue;

    // 1. Upsert Artist
    let artistRec = await db.select().from(artists).where(eq(artists.name, song.artist)).limit(1);
    let artistId: number;
    if (artistRec.length === 0) {
      const inserted = await db.insert(artists).values({ name: song.artist }).returning();
      artistId = inserted[0].id;
    } else {
      artistId = artistRec[0].id;
    }

    // 2. Upsert Album
    let albumId: number | null = null;
    if (song.album) {
      let albumRec = await db.select().from(albums).where(
        and(eq(albums.artistId, artistId), eq(albums.title, song.album))
      ).limit(1);
      if (albumRec.length === 0) {
        const inserted = await db.insert(albums).values({
          artistId,
          title: song.album,
          year: song.year,
        }).returning();
        albumId = inserted[0].id;
      } else {
        albumId = albumRec[0].id;
        if (song.year && !albumRec[0].year) {
          await db.update(albums).set({ year: song.year }).where(eq(albums.id, albumId));
        }
      }
    }

    // 3. Upsert Song
    const existingSong = await db.select().from(songs).where(
      and(eq(songs.artistId, artistId), eq(songs.title, song.title), eq(songs.libraryId, libraryId))
    ).limit(1);

    let songId: number;
    if (existingSong.length === 0) {
      const inserted = await db.insert(songs).values({
        libraryId,
        artistId,
        albumId,
        title: song.title,
        mainAudioPath: song.mainAudio || song.instrumentalAudio!,
        instrumentalAudioPath: song.instrumentalAudio,
        duration: song.duration || 0,
        trackNumber: song.trackNumber,
        discNumber: song.discNumber,
        genre: song.genre,
        year: song.year,
        variant: song.mainAudio ? 'original' : 'instrumental',
        fileSize: song.fileSize,
        format: song.format,
      }).returning();
      songId = inserted[0].id;
    } else {
      songId = existingSong[0].id;
      await db.update(songs).set({
        albumId: albumId || existingSong[0].albumId,
        mainAudioPath: song.mainAudio || existingSong[0].mainAudioPath,
        instrumentalAudioPath: song.instrumentalAudio || existingSong[0].instrumentalAudioPath,
        duration: song.duration || existingSong[0].duration,
        trackNumber: song.trackNumber || existingSong[0].trackNumber,
        discNumber: song.discNumber || existingSong[0].discNumber,
        genre: song.genre || existingSong[0].genre,
        year: song.year || existingSong[0].year,
        fileSize: song.fileSize || existingSong[0].fileSize,
        format: song.format || existingSong[0].format,
      }).where(eq(songs.id, songId));
    }

    // 4. Upsert Lyrics (.lrc)
    if (song.lrc) {
      const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, songId)).limit(1);
      if (existingLrc.length === 0) {
        await db.insert(lyrics).values({
          songId,
          lrcPath: song.lrc,
        });
      } else {
        await db.update(lyrics).set({ lrcPath: song.lrc }).where(eq(lyrics.id, existingLrc[0].id));
      }
    }
  }

  // Handle removed files: check existing songs in db for this library, if mainAudioPath / instrumentalAudioPath no longer exist on disk, remove them
  const dbSongs = await db.select().from(songs).where(eq(songs.libraryId, libraryId));
  for (const dbSong of dbSongs) {
    const mainExists = fsSync.existsSync(dbSong.mainAudioPath);
    const instExists = dbSong.instrumentalAudioPath ? fsSync.existsSync(dbSong.instrumentalAudioPath) : false;
    if (!mainExists && !instExists) {
      // Remove associated lyrics first
      await db.delete(lyrics).where(eq(lyrics.songId, dbSong.id));
      // Remove song record
      await db.delete(songs).where(eq(songs.id, dbSong.id));
    }
  }

  await db.update(libraries).set({ lastScan: new Date() }).where(eq(libraries.id, libraryId));
}
