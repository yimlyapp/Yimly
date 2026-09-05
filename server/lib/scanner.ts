import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { libraries, artists, albums, songs, lyrics, songArtists, playlistSongs, favorites, queueItems } from '../db/schema.js';
import { eq, and, or, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import * as mm from 'music-metadata';
import { parseArtists, getOrCreateArtist, syncSongArtists, normalizeMultiArtistsInDatabase, cleanupOrphanedRecords } from './artist-utils.js';
import { isLrcContentValid } from './lyrics.js';

// Setup artwork cache directory
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
const artworkDir = path.join(dataDir, 'artwork');

/**
 * Selects the best front-cover image from embedded ID3/metadata pictures.
 */
export function selectFrontCover(pictures?: mm.IPicture[]): mm.IPicture | null {
  if (!pictures || pictures.length === 0) return null;

  // 1. Look for explicit Cover (front)
  const frontCover = pictures.find(p => {
    const typeStr = (p.type || '').toLowerCase();
    return typeStr.includes('front') || typeStr.includes('cover (front)') || typeStr === 'cover';
  });
  if (frontCover) return frontCover;

  // 2. If no explicit front cover, avoid known back cover, leaflet, or icon if others exist
  const nonBackCover = pictures.find(p => {
    const typeStr = (p.type || '').toLowerCase();
    return !typeStr.includes('back') && !typeStr.includes('leaflet') && !typeStr.includes('icon');
  });
  if (nonBackCover) return nonBackCover;

  // 3. Fallback to first available picture
  return pictures[0];
}

/**
 * Saves embedded picture buffer to cached artwork directory using content-based SHA-256 hash.
 * Returns the cached filename (e.g. hash.jpg or hash.png).
 */
export async function saveEmbeddedArtwork(picture: mm.IPicture): Promise<string> {
  if (!fsSync.existsSync(artworkDir)) {
    await fs.mkdir(artworkDir, { recursive: true });
  }

  // Determine file extension
  let ext = 'jpg';
  const format = (picture.format || '').toLowerCase();
  if (format.includes('png')) {
    ext = 'png';
  } else if (format.includes('webp')) {
    ext = 'webp';
  } else if (format.includes('gif')) {
    ext = 'gif';
  } else if (format.includes('jpeg') || format.includes('jpg')) {
    ext = 'jpg';
  } else if (picture.data && picture.data.length >= 4) {
    if (picture.data[0] === 0x89 && picture.data[1] === 0x50 && picture.data[2] === 0x4E && picture.data[3] === 0x47) {
      ext = 'png';
    } else if (picture.data[0] === 0xFF && picture.data[1] === 0xD8 && picture.data[2] === 0xFF) {
      ext = 'jpg';
    }
  }

  const hash = crypto.createHash('sha256').update(picture.data).digest('hex');
  const filename = `${hash}.${ext}`;
  const filePath = path.join(artworkDir, filename);

  // If already cached, reuse existing file without re-writing
  if (!fsSync.existsSync(filePath)) {
    await fs.writeFile(filePath, Buffer.from(picture.data));
  }

  return filename;
}

export interface ScannedMediaMetadata {
  artists: string[];
  albumArtist?: string;
  album: string;
  title: string;
  duration: number;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  year?: number;
  variant: 'original' | 'instrumental' | 'vocal';
  fileSize: number;
  format: string;
  artworkPath?: string;
}

export const SUPPORTED_AUDIO_EXTS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.mp4',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.wave',
  '.wma',
  '.aiff',
  '.aif',
  '.webm',
]);

/**
 * Normalizes a base filename for matching (trims whitespace and lowercases).
 */
export function normalizeBaseName(base: string): string {
  return base.trim().toLowerCase();
}

/**
 * Normalizes title/filename by removing variant tags like (Instrumental), (Karaoke), etc.
 */
export function cleanVariantFromBaseName(base: string): string {
  return base.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();
}

/**
 * Extracts metadata, artwork, and variant information from an audio file.
 */
export async function extractSongMetadata(fullPath: string, filename?: string): Promise<ScannedMediaMetadata> {
  const safeFilename = filename || path.basename(fullPath);
  const ext = path.extname(safeFilename).toLowerCase();
  const baseName = path.basename(safeFilename, ext);

  let title = baseName;
  let parsedArtists: string[] = [];
  let albumArtist: string | undefined = undefined;
  let album = 'Unknown Album';
  let duration = 0;
  let trackNumber: number | undefined = undefined;
  let discNumber: number | undefined = undefined;
  let genre: string | undefined = undefined;
  let year: number | undefined = undefined;
  let fileSize = 0;
  let format = ext.replace('.', '');
  let variant: 'original' | 'instrumental' | 'vocal' = 'original';
  let artworkFilename: string | undefined = undefined;

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

    if (common.artists && common.artists.length > 0) {
      parsedArtists = parseArtists(common.artist, common.artists);
    } else if (common.artist) {
      parsedArtists = parseArtists(common.artist);
    } else if (common.albumartist) {
      parsedArtists = parseArtists(common.albumartist);
    }

    if (common.albumartist) {
      albumArtist = common.albumartist.trim();
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

    if (common.picture && common.picture.length > 0) {
      const selectedPic = selectFrontCover(common.picture);
      if (selectedPic) {
        artworkFilename = await saveEmbeddedArtwork(selectedPic);
      }
    }
  } catch (err) {
    console.warn(`[Scanner] Failed to read audio metadata for ${safeFilename}, using filename fallbacks:`, err);
  }

  // Detect variant & filename fallbacks
  const lowerBase = baseName.toLowerCase();
  if (lowerBase.includes('instrumental') || lowerBase.includes('inst') || lowerBase.includes('karaoke') || lowerBase.includes('backing')) {
    variant = 'instrumental';
  } else if (lowerBase.includes('vocal') || lowerBase.includes('vocals')) {
    variant = 'vocal';
  }

  // Filename pattern fallback: "Artist - Title"
  const match = baseName.match(/^(.*?)\s*-\s*(.*?)(?:\s*\((Instrumental|Karaoke|Vocals|Backing)\))?$/i);
  if (match) {
    if (parsedArtists.length === 0 || (parsedArtists.length === 1 && parsedArtists[0] === 'Unknown Artist')) {
      if (match[1]) {
        parsedArtists = parseArtists(match[1]);
      }
    }
    if (title === baseName && match[2]) {
      title = match[2].trim();
    }
  }

  if (parsedArtists.length === 0) {
    parsedArtists = ['Unknown Artist'];
  }

  const cleanTitle = title
    .replace(/\s*\((instrumental|karaoke|vocals|backing version)\)\s*/gi, '')
    .trim() || title;

  return {
    artists: parsedArtists,
    albumArtist,
    album,
    title: cleanTitle,
    duration,
    trackNumber,
    discNumber,
    genre,
    year,
    variant,
    fileSize,
    format,
    artworkPath: artworkFilename,
  };
}

/**
 * Searches for matching .elrc.lrc and .lrc sidecar files in the directory of an audio file.
 * Returns separate paths for standard LRC and ELRC files.
 */
export async function findLyricsForAudio(audioFullPath: string, songTitle: string): Promise<{ lrc: string | null; elrc: string | null }> {
  const dir = path.dirname(audioFullPath);
  if (!fsSync.existsSync(dir)) return { lrc: null, elrc: null };

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const audioExt = path.extname(audioFullPath);
    const audioBase = path.basename(audioFullPath, audioExt);
    const normAudioBase = normalizeBaseName(audioBase);
    const cleanAudioBase = cleanVariantFromBaseName(audioBase);
    const songTitleNorm = normalizeBaseName(songTitle);

    const elrcCandidates: string[] = [];
    const stdLrcCandidates: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.elrc.lrc')) {
        elrcCandidates.push(path.join(dir, entry.name));
      } else if (lower.endsWith('.lrc')) {
        stdLrcCandidates.push(path.join(dir, entry.name));
      }
    }

    const rankCandidates = (candidates: string[]): string | null => {
      // 1. Exact base match
      for (const p of candidates) {
        const name = path.basename(p);
        const isElrc = name.toLowerCase().endsWith('.elrc.lrc');
        const extLen = isElrc ? 9 : 4;
        const lrcBase = name.slice(0, -extLen);
        if (normalizeBaseName(lrcBase) === normAudioBase) {
          if (validateLrcFile(p)) return p;
        }
      }
      // 2. Clean base match
      for (const p of candidates) {
        const name = path.basename(p);
        const isElrc = name.toLowerCase().endsWith('.elrc.lrc');
        const extLen = isElrc ? 9 : 4;
        const lrcBase = name.slice(0, -extLen);
        if (cleanVariantFromBaseName(lrcBase) === cleanAudioBase) {
          if (validateLrcFile(p)) return p;
        }
      }
      // 3. Title match
      for (const p of candidates) {
        const name = path.basename(p);
        const isElrc = name.toLowerCase().endsWith('.elrc.lrc');
        const extLen = isElrc ? 9 : 4;
        const lrcBase = name.slice(0, -extLen);
        const lrcNorm = normalizeBaseName(lrcBase);
        const lrcClean = cleanVariantFromBaseName(lrcBase);
        if (lrcNorm === songTitleNorm || lrcClean === songTitleNorm) {
          if (validateLrcFile(p)) return p;
        }
      }
      return null;
    };

    const elrcMatch = rankCandidates(elrcCandidates);
    const stdLrcMatch = rankCandidates(stdLrcCandidates);

    return { lrc: stdLrcMatch, elrc: elrcMatch };
  } catch (err) {
    console.warn(`[Scanner] Error searching lyrics for ${audioFullPath}:`, err);
    return { lrc: null, elrc: null };
  }
}

function validateLrcFile(filePath: string): boolean {
  try {
    if (!fsSync.existsSync(filePath)) return false;
    const content = fsSync.readFileSync(filePath, 'utf-8');
    return isLrcContentValid(content);
  } catch {
    return false;
  }
}

/**
 * Incrementally imports or updates a single audio file into the database.
 */
export async function importSingleAudioFile(libraryId: number, audioFullPath: string): Promise<any> {
  if (!fsSync.existsSync(audioFullPath)) {
    return null;
  }

  const metadata = await extractSongMetadata(audioFullPath);
  const matchedLyrics = await findLyricsForAudio(audioFullPath, metadata.title);

  // 1. Upsert all Artists
  const artistIds: number[] = [];
  for (const artistName of metadata.artists) {
    const aId = await getOrCreateArtist(artistName, metadata.artworkPath);
    artistIds.push(aId);
  }
  const primaryArtistId = artistIds[0] || (await getOrCreateArtist('Unknown Artist', metadata.artworkPath));

  // 2. Upsert Album
  let albumId: number | null = null;
  if (metadata.album) {
    let albumArtistId = primaryArtistId;
    if (metadata.albumArtist) {
      albumArtistId = await getOrCreateArtist(metadata.albumArtist, metadata.artworkPath);
    }

    const albumRec = await db.select().from(albums).where(
      and(eq(albums.artistId, albumArtistId), eq(albums.title, metadata.album))
    ).limit(1);

    if (albumRec.length === 0) {
      const inserted = await db.insert(albums).values({
        artistId: albumArtistId,
        title: metadata.album,
        year: metadata.year,
        artworkPath: metadata.artworkPath || null,
      }).returning();
      albumId = inserted[0].id;
    } else {
      albumId = albumRec[0].id;
      const updates: any = {};
      if (metadata.year && !albumRec[0].year) updates.year = metadata.year;
      if (metadata.artworkPath && !albumRec[0].artworkPath) updates.artworkPath = metadata.artworkPath;
      if (Object.keys(updates).length > 0) {
        await db.update(albums).set(updates).where(eq(albums.id, albumId));
      }
    }
  }

  // 3. Check for existing song match
  let existingSong = await db.select().from(songs).where(
    and(eq(songs.libraryId, libraryId), eq(songs.artistId, primaryArtistId), eq(songs.title, metadata.title))
  ).limit(1);

  if (existingSong.length === 0) {
    existingSong = await db.select().from(songs).where(
      and(
        eq(songs.libraryId, libraryId),
        or(eq(songs.mainAudioPath, audioFullPath), eq(songs.instrumentalAudioPath, audioFullPath))
      )
    ).limit(1);
  }

  let songId: number;
  const isInst = metadata.variant === 'instrumental';

  if (existingSong.length === 0) {
    const inserted = await db.insert(songs).values({
      libraryId,
      artistId: primaryArtistId,
      albumId,
      title: metadata.title,
      mainAudioPath: audioFullPath,
      instrumentalAudioPath: isInst ? audioFullPath : null,
      duration: metadata.duration || 0,
      trackNumber: metadata.trackNumber,
      discNumber: metadata.discNumber,
      genre: metadata.genre,
      year: metadata.year,
      variant: isInst ? 'instrumental' : 'original',
      fileSize: metadata.fileSize,
      format: metadata.format,
      artworkPath: metadata.artworkPath || null,
    }).returning();
    songId = inserted[0].id;
  } else {
    songId = existingSong[0].id;
    const current = existingSong[0];
    const updates: any = {
      artistId: primaryArtistId,
      albumId: albumId || current.albumId,
      duration: metadata.duration || current.duration,
      trackNumber: metadata.trackNumber || current.trackNumber,
      discNumber: metadata.discNumber || current.discNumber,
      genre: metadata.genre || current.genre,
      year: metadata.year || current.year,
      fileSize: metadata.fileSize || current.fileSize,
      format: metadata.format || current.format,
      artworkPath: metadata.artworkPath || current.artworkPath,
    };

    if (isInst) {
      updates.instrumentalAudioPath = audioFullPath;
      if (!current.mainAudioPath || !fsSync.existsSync(current.mainAudioPath)) {
        updates.mainAudioPath = audioFullPath;
        updates.variant = 'instrumental';
      }
    } else {
      updates.mainAudioPath = audioFullPath;
      updates.variant = 'original';
    }

    await db.update(songs).set(updates).where(eq(songs.id, songId));
  }

  // 4. Sync song_artists
  await syncSongArtists(songId, artistIds);

  // 5. Upsert Lyrics if matched
  if (matchedLyrics.lrc || matchedLyrics.elrc) {
    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, songId)).limit(1);
    if (existingLrc.length === 0) {
      await db.insert(lyrics).values({
        songId,
        lrcPath: matchedLyrics.lrc || '',
        elrcPath: matchedLyrics.elrc || null,
      });
    } else {
      const updates: any = {};
      if (matchedLyrics.lrc) updates.lrcPath = matchedLyrics.lrc;
      if (matchedLyrics.elrc) updates.elrcPath = matchedLyrics.elrc;
      if (Object.keys(updates).length > 0) {
        await db.update(lyrics).set(updates).where(eq(lyrics.id, existingLrc[0].id));
      }
    }
  }

  // 6. Backfill artwork for album/artists if newly acquired
  if (metadata.artworkPath) {
    if (albumId) {
      await db.update(albums).set({ artworkPath: metadata.artworkPath }).where(and(eq(albums.id, albumId), isNull(albums.artworkPath)));
    }
    for (const aId of artistIds) {
      await db.update(artists).set({ artworkPath: metadata.artworkPath }).where(and(eq(artists.id, aId), isNull(artists.artworkPath)));
    }
  }

  return await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
}

/**
 * Incrementally processes a new or modified .lrc / .elrc.lrc file.
 */
export async function importSingleLrcFile(libraryId: number, lrcFullPath: string): Promise<boolean> {
  if (!fsSync.existsSync(lrcFullPath)) return false;

  let content: string;
  try {
    content = await fs.readFile(lrcFullPath, 'utf-8');
  } catch {
    return false;
  }

  if (!isLrcContentValid(content)) {
    return false;
  }

  const dir = path.dirname(lrcFullPath);
  const name = path.basename(lrcFullPath);
  const isElrc = name.toLowerCase().endsWith('.elrc.lrc');
  const extLen = isElrc ? 9 : 4;
  const lrcBase = name.slice(0, -extLen);
  const normLrcBase = normalizeBaseName(lrcBase);
  const cleanLrcBase = cleanVariantFromBaseName(lrcBase);

  // Find candidate songs in the library
  const libSongs = await db.select().from(songs).where(eq(songs.libraryId, libraryId));
  let bestMatchSongId: number | null = null;

  for (const s of libSongs) {
    const audioPath = s.mainAudioPath || s.instrumentalAudioPath;
    if (!audioPath) continue;

    const audioDir = path.dirname(audioPath);
    if (path.resolve(audioDir) !== path.resolve(dir)) continue;

    const audioExt = path.extname(audioPath);
    const audioBase = path.basename(audioPath, audioExt);
    const normAudioBase = normalizeBaseName(audioBase);
    const cleanAudioBase = cleanVariantFromBaseName(audioBase);
    const songTitleNorm = normalizeBaseName(s.title);

    if (normAudioBase === normLrcBase || cleanAudioBase === cleanLrcBase || songTitleNorm === normLrcBase || songTitleNorm === cleanLrcBase) {
      bestMatchSongId = s.id;
      break;
    }
  }

  // Fallback match by title if directory match wasn't direct
  if (!bestMatchSongId) {
    for (const s of libSongs) {
      const songTitleNorm = normalizeBaseName(s.title);
      if (songTitleNorm === normLrcBase || songTitleNorm === cleanLrcBase) {
        bestMatchSongId = s.id;
        break;
      }
    }
  }

  if (!bestMatchSongId) return false;

  const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, bestMatchSongId)).limit(1);
  if (existingLrc.length === 0) {
    await db.insert(lyrics).values({ 
      songId: bestMatchSongId, 
      lrcPath: isElrc ? '' : lrcFullPath,
      elrcPath: isElrc ? lrcFullPath : null
    });
    return true;
  } else {
    const updates: any = {};
    if (isElrc) {
      updates.elrcPath = lrcFullPath;
    } else {
      updates.lrcPath = lrcFullPath;
    }
    await db.update(lyrics).set(updates).where(eq(lyrics.id, existingLrc[0].id));
    return true;
  }
}

/**
 * Handles deletion or removal of an audio or lyrics file from disk.
 */
export async function removeSingleFile(libraryId: number, filePath: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const lower = filePath.toLowerCase();
  const isLrc = lower.endsWith('.elrc.lrc') || ext === '.lrc';

  if (isLrc) {
    // Check if any lyrics record pointed to this file
    const matchedLyrics = await db.select().from(lyrics).where(or(eq(lyrics.lrcPath, filePath), eq(lyrics.elrcPath, filePath)));
    for (const l of matchedLyrics) {
      const isElrcRemove = l.elrcPath === filePath;
      const isLrcRemove = l.lrcPath === filePath;
      
      const updates: any = {};
      if (isElrcRemove) updates.elrcPath = null;
      if (isLrcRemove) updates.lrcPath = '';
      
      const newElrc = updates.elrcPath === null ? null : l.elrcPath;
      const newLrc = updates.lrcPath === '' ? '' : l.lrcPath;
      
      if ((newElrc === null || newElrc === '') && (newLrc === null || newLrc === '')) {
        await db.delete(lyrics).where(eq(lyrics.id, l.id));
      } else {
        await db.update(lyrics).set(updates).where(eq(lyrics.id, l.id));
      }
    }
    return;
  }

  // Audio file removal
  const matchingSongs = await db.select().from(songs).where(
    and(
      eq(songs.libraryId, libraryId),
      or(eq(songs.mainAudioPath, filePath), eq(songs.instrumentalAudioPath, filePath))
    )
  );

  for (const s of matchingSongs) {
    const mainStillExists = s.mainAudioPath && s.mainAudioPath !== filePath && fsSync.existsSync(s.mainAudioPath);
    const instStillExists = s.instrumentalAudioPath && s.instrumentalAudioPath !== filePath && fsSync.existsSync(s.instrumentalAudioPath);

    if (!mainStillExists && !instStillExists) {
      // Complete removal of song
      await db.delete(lyrics).where(eq(lyrics.songId, s.id));
      await db.delete(playlistSongs).where(eq(playlistSongs.songId, s.id));
      await db.delete(favorites).where(eq(favorites.songId, s.id));
      await db.delete(queueItems).where(eq(queueItems.songId, s.id));
      await db.delete(songArtists).where(eq(songArtists.songId, s.id));
      await db.delete(songs).where(eq(songs.id, s.id));
    } else if (!mainStillExists && instStillExists) {
      // Main removed, promote instrumental
      await db.update(songs).set({
        mainAudioPath: s.instrumentalAudioPath!,
        instrumentalAudioPath: null,
        variant: 'instrumental',
      }).where(eq(songs.id, s.id));
    } else if (mainStillExists && !instStillExists && s.instrumentalAudioPath === filePath) {
      // Instrumental removed
      await db.update(songs).set({
        instrumentalAudioPath: null,
      }).where(eq(songs.id, s.id));
    }
  }

  await cleanupOrphanedRecords();
}

/**
 * Full library rescan and reconciliation.
 */
export async function scanLibrary(libraryId: number, dirPath: string) {
  const songsMap = new Map<string, {
    artists: string[];
    albumArtist?: string;
    album: string;
    title: string;
    mainAudio?: string;
    instrumentalAudio?: string;
    lrc?: string;
    elrc?: string;
    duration?: number;
    trackNumber?: number;
    discNumber?: number;
    genre?: string;
    year?: number;
    variant: string;
    fileSize?: number;
    format?: string;
    artworkPath?: string;
  }>();

  interface DiscoveredAudio {
    fullPath: string;
    filename: string;
    ext: string;
    baseName: string;
    cleanBaseName: string;
    dir: string;
    songKey: string;
  }

  interface DiscoveredLrc {
    fullPath: string;
    filename: string;
    baseName: string;
    cleanBaseName: string;
    dir: string;
    isElrc: boolean;
  }

  const audioList: DiscoveredAudio[] = [];
  const dirLrcMap = new Map<string, DiscoveredLrc[]>();

  async function walk(currentPath: string) {
    if (!fsSync.existsSync(currentPath)) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        await processFile(fullPath, entry.name, currentPath);
      }
    }
  }

  async function processFile(fullPath: string, filename: string, dir: string) {
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);

    if (SUPPORTED_AUDIO_EXTS.has(ext)) {
      const metadata = await extractSongMetadata(fullPath, filename);
      const cleanTitle = metadata.title;
      const normalizedArtistsKey = metadata.artists.map(a => a.toLowerCase()).sort().join(';');
      const key = `${normalizedArtistsKey}|${cleanTitle.toLowerCase()}`;

      if (!songsMap.has(key)) {
        songsMap.set(key, {
          artists: metadata.artists,
          albumArtist: metadata.albumArtist,
          album: metadata.album,
          title: cleanTitle,
          variant: metadata.variant,
          duration: metadata.duration,
          trackNumber: metadata.trackNumber,
          discNumber: metadata.discNumber,
          genre: metadata.genre,
          year: metadata.year,
          fileSize: metadata.fileSize,
          format: metadata.format,
          artworkPath: metadata.artworkPath,
        });
      }

      const songInfo = songsMap.get(key)!;
      if (metadata.artworkPath && (!songInfo.artworkPath || metadata.variant !== 'instrumental')) {
        songInfo.artworkPath = metadata.artworkPath;
      }

      if (metadata.variant === 'instrumental') {
        songInfo.instrumentalAudio = fullPath;
      } else {
        songInfo.mainAudio = fullPath;
        if (metadata.duration) songInfo.duration = metadata.duration;
        if (metadata.trackNumber) songInfo.trackNumber = metadata.trackNumber;
        if (metadata.discNumber) songInfo.discNumber = metadata.discNumber;
        if (metadata.genre) songInfo.genre = metadata.genre;
        if (metadata.year) songInfo.year = metadata.year;
        if (metadata.fileSize) songInfo.fileSize = metadata.fileSize;
        if (metadata.format) songInfo.format = metadata.format;
      }

      audioList.push({
        fullPath,
        filename,
        ext,
        baseName,
        cleanBaseName: cleanVariantFromBaseName(baseName),
        dir,
        songKey: key,
      });
    } else if (filename.toLowerCase().endsWith('.elrc.lrc')) {
      const elrcBase = filename.slice(0, -9);
      const lrcItem: DiscoveredLrc = {
        fullPath,
        filename,
        baseName: elrcBase,
        cleanBaseName: cleanVariantFromBaseName(elrcBase),
        dir,
        isElrc: true,
      };
      if (!dirLrcMap.has(dir)) {
        dirLrcMap.set(dir, []);
      }
      dirLrcMap.get(dir)!.push(lrcItem);
    } else if (ext === '.lrc') {
      const lrcItem: DiscoveredLrc = {
        fullPath,
        filename,
        baseName,
        cleanBaseName: cleanVariantFromBaseName(baseName),
        dir,
        isElrc: false,
      };
      if (!dirLrcMap.has(dir)) {
        dirLrcMap.set(dir, []);
      }
      dirLrcMap.get(dir)!.push(lrcItem);
    }
  }

  await walk(dirPath);

  // Match LRC files to songs using filesystem path and base filename (.elrc.lrc prioritized over .lrc)
  for (const audio of audioList) {
    const songInfo = songsMap.get(audio.songKey);
    if (!songInfo) continue;

    const dirLrcs = dirLrcMap.get(audio.dir);
    if (!dirLrcs || dirLrcs.length === 0) continue;

    const normAudioBase = normalizeBaseName(audio.baseName);
    const cleanAudioBase = audio.cleanBaseName;

    const elrcs = dirLrcs.filter(l => l.isElrc);
    const stdLrcs = dirLrcs.filter(l => !l.isElrc);

    const checkPool = (pool: typeof elrcs) => {
      if (pool.length === 0) return null;
      const validCandidates = pool.filter(lrc => {
        try {
          if (!fsSync.existsSync(lrc.fullPath)) return false;
          const content = fsSync.readFileSync(lrc.fullPath, 'utf-8');
          return isLrcContentValid(content);
        } catch { return false; }
      });
      if (validCandidates.length === 0) return null;
      
      const exactMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === normAudioBase);
      if (exactMatch) return exactMatch.fullPath;
      
      const cleanMatch = validCandidates.find(lrc => lrc.cleanBaseName === cleanAudioBase);
      if (cleanMatch) return cleanMatch.fullPath;
      
      const songTitleNorm = normalizeBaseName(songInfo.title);
      const titleMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === songTitleNorm || lrc.cleanBaseName === songTitleNorm);
      if (titleMatch) return titleMatch.fullPath;
      
      return null;
    };

    if (!songInfo.elrc) {
      const match = checkPool(elrcs);
      if (match) songInfo.elrc = match;
    }
    if (!songInfo.lrc) {
      const match = checkPool(stdLrcs);
      if (match) songInfo.lrc = match;
    }
  }

  // Fallback matching for remaining unmatched songs
  const allElrcs: DiscoveredLrc[] = [];
  const allStdLrcs: DiscoveredLrc[] = [];
  for (const dirLrcs of dirLrcMap.values()) {
    for (const lrc of dirLrcs) {
      if (lrc.isElrc) allElrcs.push(lrc);
      else allStdLrcs.push(lrc);
    }
  }

  for (const lrcPool of [allElrcs, allStdLrcs]) {
    for (const lrc of lrcPool) {
      try {
        if (!fsSync.existsSync(lrc.fullPath)) continue;
        const content = fsSync.readFileSync(lrc.fullPath, 'utf-8');
        if (!isLrcContentValid(content)) continue;
      } catch {
        continue;
      }

      const lrcBaseNorm = normalizeBaseName(lrc.baseName);
      const lrcClean = lrc.cleanBaseName;

      for (const songInfo of songsMap.values()) {
        if (lrc.isElrc) {
          if (songInfo.elrc) continue;
        } else {
          if (songInfo.lrc) continue;
        }
        const songTitleNorm = normalizeBaseName(songInfo.title);

        if (lrcBaseNorm === songTitleNorm || lrcClean === songTitleNorm || (songTitleNorm.length > 3 && lrcClean.includes(songTitleNorm))) {
          if (lrc.isElrc) {
            songInfo.elrc = lrc.fullPath;
          } else {
            songInfo.lrc = lrc.fullPath;
          }
          break;
        }
      }
    }
  }

  // Sync with Database
  for (const song of songsMap.values()) {
    if (!song.mainAudio && !song.instrumentalAudio) continue;

    const artistIds: number[] = [];
    for (const artistName of song.artists) {
      const aId = await getOrCreateArtist(artistName, song.artworkPath);
      artistIds.push(aId);
    }
    const primaryArtistId = artistIds[0] || (await getOrCreateArtist('Unknown Artist', song.artworkPath));

    let albumId: number | null = null;
    if (song.album) {
      let albumArtistId = primaryArtistId;
      if (song.albumArtist) {
        albumArtistId = await getOrCreateArtist(song.albumArtist, song.artworkPath);
      }

      const albumRec = await db.select().from(albums).where(
        and(eq(albums.artistId, albumArtistId), eq(albums.title, song.album))
      ).limit(1);
      if (albumRec.length === 0) {
        const inserted = await db.insert(albums).values({
          artistId: albumArtistId,
          title: song.album,
          year: song.year,
          artworkPath: song.artworkPath || null,
        }).returning();
        albumId = inserted[0].id;
      } else {
        albumId = albumRec[0].id;
        const updates: any = {};
        if (song.year && !albumRec[0].year) updates.year = song.year;
        if (song.artworkPath && !albumRec[0].artworkPath) updates.artworkPath = song.artworkPath;
        if (Object.keys(updates).length > 0) {
          await db.update(albums).set(updates).where(eq(albums.id, albumId));
        }
      }
    }

    let existingSong = await db.select().from(songs).where(
      and(eq(songs.libraryId, libraryId), eq(songs.artistId, primaryArtistId), eq(songs.title, song.title))
    ).limit(1);

    if (existingSong.length === 0 && song.mainAudio) {
      existingSong = await db.select().from(songs).where(
        and(eq(songs.libraryId, libraryId), eq(songs.mainAudioPath, song.mainAudio))
      ).limit(1);
    }

    let songId: number;
    if (existingSong.length === 0) {
      const inserted = await db.insert(songs).values({
        libraryId,
        artistId: primaryArtistId,
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
        artworkPath: song.artworkPath || null,
      }).returning();
      songId = inserted[0].id;
    } else {
      songId = existingSong[0].id;
      await db.update(songs).set({
        artistId: primaryArtistId,
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
        artworkPath: song.artworkPath || existingSong[0].artworkPath,
      }).where(eq(songs.id, songId));
    }

    await syncSongArtists(songId, artistIds);

    if (song.lrc || song.elrc) {
      const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, songId)).limit(1);
      if (existingLrc.length === 0) {
        await db.insert(lyrics).values({
          songId,
          lrcPath: song.lrc || '',
          elrcPath: song.elrc || null,
        });
      } else {
        const updates: any = {};
        if (song.lrc) updates.lrcPath = song.lrc;
        if (song.elrc) updates.elrcPath = song.elrc;
        if (Object.keys(updates).length > 0) {
          await db.update(lyrics).set(updates).where(eq(lyrics.id, existingLrc[0].id));
        }
      }
    }
  }

  // Reconcile deleted files
  const dbSongs = await db.select().from(songs).where(eq(songs.libraryId, libraryId));
  for (const dbSong of dbSongs) {
    const mainExists = fsSync.existsSync(dbSong.mainAudioPath);
    const instExists = dbSong.instrumentalAudioPath ? fsSync.existsSync(dbSong.instrumentalAudioPath) : false;

    if (!mainExists && !instExists) {
      await db.delete(lyrics).where(eq(lyrics.songId, dbSong.id));
      await db.delete(playlistSongs).where(eq(playlistSongs.songId, dbSong.id));
      await db.delete(favorites).where(eq(favorites.songId, dbSong.id));
      await db.delete(queueItems).where(eq(queueItems.songId, dbSong.id));
      await db.delete(songArtists).where(eq(songArtists.songId, dbSong.id));
      await db.delete(songs).where(eq(songs.id, dbSong.id));
    } else if (!mainExists && instExists) {
      await db.update(songs).set({
        mainAudioPath: dbSong.instrumentalAudioPath!,
        instrumentalAudioPath: null,
        variant: 'instrumental',
      }).where(eq(songs.id, dbSong.id));
    } else if (mainExists && !instExists && dbSong.instrumentalAudioPath) {
      await db.update(songs).set({
        instrumentalAudioPath: null,
      }).where(eq(songs.id, dbSong.id));
    }
  }

  await normalizeMultiArtistsInDatabase();
  await cleanupOrphanedRecords();

  // Backfill albums without artwork
  const albumsWithoutArtwork = await db.select().from(albums).where(isNull(albums.artworkPath));
  for (const alb of albumsWithoutArtwork) {
    const songWithArtwork = await db.select({ artworkPath: songs.artworkPath })
      .from(songs)
      .where(and(eq(songs.albumId, alb.id), isNotNull(songs.artworkPath)))
      .limit(1);
    if (songWithArtwork.length > 0 && songWithArtwork[0].artworkPath) {
      await db.update(albums).set({ artworkPath: songWithArtwork[0].artworkPath }).where(eq(albums.id, alb.id));
    }
  }

  // Backfill artists without artwork
  const artistsWithoutArtwork = await db.select().from(artists).where(isNull(artists.artworkPath));
  for (const art of artistsWithoutArtwork) {
    const songArtistMatch = await db.select({ artworkPath: songs.artworkPath })
      .from(songArtists)
      .innerJoin(songs, eq(songArtists.songId, songs.id))
      .where(and(eq(songArtists.artistId, art.id), isNotNull(songs.artworkPath)))
      .limit(1);

    if (songArtistMatch.length > 0 && songArtistMatch[0].artworkPath) {
      await db.update(artists).set({ artworkPath: songArtistMatch[0].artworkPath }).where(eq(artists.id, art.id));
      continue;
    }

    const directSongMatch = await db.select({ artworkPath: songs.artworkPath })
      .from(songs)
      .where(and(eq(songs.artistId, art.id), isNotNull(songs.artworkPath)))
      .limit(1);
    if (directSongMatch.length > 0 && directSongMatch[0].artworkPath) {
      await db.update(artists).set({ artworkPath: directSongMatch[0].artworkPath }).where(eq(artists.id, art.id));
    }
  }

  await db.update(libraries).set({ lastScan: new Date() }).where(eq(libraries.id, libraryId));
}
