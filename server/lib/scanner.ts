import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { libraries, artists, albums, songs, lyrics, songArtists, playlistSongs, favorites, queueItems } from '../db/schema.js';
import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
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

interface ScannedMediaItem {
  artists: string[];
  albumArtist?: string;
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
  artworkPath?: string;
}

const SUPPORTED_AUDIO_EXTS = new Set([
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
function normalizeBaseName(base: string): string {
  return base.trim().toLowerCase();
}

/**
 * Normalizes title/filename by removing variant tags like (Instrumental), (Karaoke), etc.
 */
function cleanVariantFromBaseName(base: string): string {
  return base.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();
}

export async function scanLibrary(libraryId: number, dirPath: string) {
  const songsMap = new Map<string, ScannedMediaItem>();
  const foundFilePaths = new Set<string>();

  // Collect audio tracks and LRC files by directory
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
  // Map directory path -> Array of discovered LRC files
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
    const baseName = path.basename(filename, path.extname(filename));

    if (SUPPORTED_AUDIO_EXTS.has(ext)) {
      foundFilePaths.add(fullPath);
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
      let variant = 'original';
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

        // Multi-artist metadata parsing: support semicolon separated artists, common.artists array, common.artist string
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

        // Extract embedded front cover picture if present
        if (common.picture && common.picture.length > 0) {
          const selectedPic = selectFrontCover(common.picture);
          if (selectedPic) {
            artworkFilename = await saveEmbeddedArtwork(selectedPic);
          }
        }
      } catch (err) {
        // Fallback to filename parsing if metadata reading fails
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

      // Clean base title for grouping main and instrumental versions of the same song
      const cleanTitle = title
        .replace(/\s*\((instrumental|karaoke|vocals|backing version)\)\s*/gi, '')
        .trim();

      const normalizedArtistsKey = parsedArtists.map(a => a.toLowerCase()).sort().join(';');
      const key = `${normalizedArtistsKey}|${cleanTitle.toLowerCase()}`;

      if (!songsMap.has(key)) {
        songsMap.set(key, {
          artists: parsedArtists,
          albumArtist,
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
          artworkPath: artworkFilename,
        });
      }

      const songInfo = songsMap.get(key)!;
      if (artworkFilename && (!songInfo.artworkPath || variant !== 'instrumental')) {
        songInfo.artworkPath = artworkFilename;
      }

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
      foundFilePaths.add(fullPath);
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
      foundFilePaths.add(fullPath);
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
    if (!songInfo || songInfo.lrc) continue;

    const dirLrcs = dirLrcMap.get(audio.dir);
    if (!dirLrcs || dirLrcs.length === 0) continue;

    const normAudioBase = normalizeBaseName(audio.baseName);
    const cleanAudioBase = audio.cleanBaseName;

    const elrcs = dirLrcs.filter(l => l.isElrc);
    const stdLrcs = dirLrcs.filter(l => !l.isElrc);

    let matchedPath: string | null = null;

    for (const pool of [elrcs, stdLrcs]) {
      if (pool.length === 0) continue;

      // Filter pool to only candidates that exist and have valid parseable lyrics content
      const validCandidates = pool.filter(lrc => {
        try {
          if (!fsSync.existsSync(lrc.fullPath)) return false;
          const content = fsSync.readFileSync(lrc.fullPath, 'utf-8');
          return isLrcContentValid(content);
        } catch {
          return false;
        }
      });

      if (validCandidates.length === 0) continue;

      // 1. Exact base filename match (case-insensitive & whitespace trimmed)
      const exactMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === normAudioBase);
      if (exactMatch) {
        matchedPath = exactMatch.fullPath;
        break;
      }

      // 2. Cleaned base filename match (without variant suffix like Instrumental)
      const cleanMatch = validCandidates.find(lrc => lrc.cleanBaseName === cleanAudioBase);
      if (cleanMatch) {
        matchedPath = cleanMatch.fullPath;
        break;
      }

      // 3. Match against song's clean title if title appears as exact base filename in same dir
      const songTitleNorm = normalizeBaseName(songInfo.title);
      const titleMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === songTitleNorm || lrc.cleanBaseName === songTitleNorm);
      if (titleMatch) {
        matchedPath = titleMatch.fullPath;
        break;
      }
    }

    if (matchedPath) {
      songInfo.lrc = matchedPath;
    }
  }

  // Fallback for any unmatched LRCs: elrcs first, then stdLrcs
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
        if (songInfo.lrc) continue;
        const songTitleNorm = normalizeBaseName(songInfo.title);

        // If LRC filename contains or matches title
        if (lrcBaseNorm === songTitleNorm || lrcClean === songTitleNorm || (songTitleNorm.length > 3 && lrcClean.includes(songTitleNorm))) {
          songInfo.lrc = lrc.fullPath;
          break;
        }
      }
    }
  }

  // Sync with Database
  for (const song of songsMap.values()) {
    if (!song.mainAudio && !song.instrumentalAudio) continue;

    // 1. Upsert all Artists (independent entities)
    const artistIds: number[] = [];
    for (const artistName of song.artists) {
      const aId = await getOrCreateArtist(artistName, song.artworkPath);
      artistIds.push(aId);
    }
    const primaryArtistId = artistIds[0] || (await getOrCreateArtist('Unknown Artist', song.artworkPath));

    // 2. Upsert Album
    let albumId: number | null = null;
    if (song.album) {
      let albumArtistId = primaryArtistId;
      if (song.albumArtist) {
        albumArtistId = await getOrCreateArtist(song.albumArtist, song.artworkPath);
      }

      let albumRec = await db.select().from(albums).where(
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

    // 3. Upsert Song
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

    // 4. Sync many-to-many relationship in song_artists
    await syncSongArtists(songId, artistIds);

    // 5. Upsert Lyrics (.lrc)
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

  // Handle removed files: check existing songs in db for this library, if mainAudioPath / instrumentalAudioPath no longer exist on disk, remove or adjust them
  const dbSongs = await db.select().from(songs).where(eq(songs.libraryId, libraryId));
  for (const dbSong of dbSongs) {
    const mainExists = fsSync.existsSync(dbSong.mainAudioPath);
    const instExists = dbSong.instrumentalAudioPath ? fsSync.existsSync(dbSong.instrumentalAudioPath) : false;

    if (!mainExists && !instExists) {
      // Remove all associated records and song
      await db.delete(lyrics).where(eq(lyrics.songId, dbSong.id));
      await db.delete(playlistSongs).where(eq(playlistSongs.songId, dbSong.id));
      await db.delete(favorites).where(eq(favorites.songId, dbSong.id));
      await db.delete(queueItems).where(eq(queueItems.songId, dbSong.id));
      await db.delete(songArtists).where(eq(songArtists.songId, dbSong.id));
      await db.delete(songs).where(eq(songs.id, dbSong.id));
    } else if (!mainExists && instExists) {
      // Main audio was removed but instrumental still exists
      await db.update(songs).set({
        mainAudioPath: dbSong.instrumentalAudioPath!,
        instrumentalAudioPath: null,
        variant: 'instrumental',
      }).where(eq(songs.id, dbSong.id));
    } else if (mainExists && !instExists && dbSong.instrumentalAudioPath) {
      // Instrumental audio was removed but main audio exists
      await db.update(songs).set({
        instrumentalAudioPath: null,
      }).where(eq(songs.id, dbSong.id));
    }
  }

  // Clean up any obsolete semicolon-separated artist records from previous legacy scans
  await normalizeMultiArtistsInDatabase();

  // Clean up any orphaned albums, artists, and song_artists relationships
  await cleanupOrphanedRecords();

  // Backfill any albums without artwork from their child songs
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

  // Backfill any artists without artwork from their songs (via song_artists or songs table)
  const artistsWithoutArtwork = await db.select().from(artists).where(isNull(artists.artworkPath));
  for (const art of artistsWithoutArtwork) {
    // Check songs linked to this artist via song_artists
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
