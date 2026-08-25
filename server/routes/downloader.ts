import { Router } from 'express';
import { db } from '../db/index.js';
import { settings, libraries } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { scanLibrary } from '../lib/scanner.js';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import NodeID3 from 'node-id3';
import {
  fetchLyrics,
  saveLrcSidecar,
  computeEffectiveLyricsProviders,
  stripLrcTimestamps,
  Lyrics,
} from '../lib/lyrics.js';

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Helper: Ensure yt-dlp executable exists
async function getYtDlpPath(): Promise<string> {
  const possiblePaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.cwd(), 'yt-dlp'),
    './yt-dlp',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        // Test if the file is executable and valid
        await execFilePromise(p, ['--version']);
        return p;
      } catch (err) {
        console.warn(`Binary at ${p} failed version check, re-downloading...`);
      }
    }
  }

  // Download yt-dlp binary if not found or invalid
  try {
    console.log('yt-dlp binary not found or invalid. Downloading latest binary...');
    const targetPath = path.join(process.cwd(), 'yt-dlp');
    await execPromise(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${targetPath} && chmod +x ${targetPath}`);
    return targetPath;
  } catch (err) {
    console.error('Failed to download yt-dlp binary:', err);
    throw new Error('yt-dlp executable unavailable on server');
  }
}

// Memory cache for active download jobs
interface TrackJob {
  id: string;
  title: string;
  artist: string;
  album: string;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: number;
  duration?: number;
  artworkUrl?: string;
  sourceUrl?: string;
  status: 'queued' | 'searching' | 'downloading' | 'tagging' | 'completed' | 'failed';
  progress: number; // 0 - 100
  error?: string;
}

interface DownloadJob {
  id: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  tracks: TrackJob[];
  libraryId: number;
  libraryPath: string;
  format: string;
  quality: string;
  embedMetadata: boolean;
  embedArtwork: boolean;
  downloadLyrics: boolean;
  lyricsProviders: string[];
  folderStructure: string;
  playlistFolder: boolean;
  playlistName?: string;
  completedCount: number;
  totalCount: number;
  createdAt: number;
  updatedAt: number;
}

const activeJobs = new Map<string, DownloadJob>();

// Cleanup completed jobs older than 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of activeJobs.entries()) {
    if (now - job.updatedAt > 2 * 60 * 60 * 1000) {
      activeJobs.delete(id);
    }
  }
}, 30 * 60 * 1000);

// Helper: Sanitize string for filenames & directories (Downtify compatible)
function sanitizeFilename(str: string): string {
  if (!str) return 'Unknown';
  const cleaned = str
    .replace(/[/\\?%*:|"<>]/g, '')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return cleaned || 'Unknown';
}

// -------------------------------------------------------------------
// SETTINGS ENDPOINTS
// -------------------------------------------------------------------

router.get('/settings', async (req, res) => {
  try {
    const allSettings = await db.select().from(settings);
    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

    // Find default library ID
    const allLibs = await db.select().from(libraries).limit(1);
    const defaultLibId = allLibs.length > 0 ? String(allLibs[0].id) : '1';

    const rawDownloadLyrics = settingsMap.get('downloader_download_lyrics');
    const rawLyricsProviders = settingsMap.get('downloader_lyrics_providers');

    let parsedProviders = ['lrclib'];
    if (rawLyricsProviders) {
      try {
        const parsed = JSON.parse(rawLyricsProviders);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedProviders = parsed;
        }
      } catch (e) {
        parsedProviders = [rawLyricsProviders];
      }
    }

    const downloadLyrics = rawDownloadLyrics !== 'false';

    res.json({
      libraryId: settingsMap.get('downloader_library_id') || defaultLibId,
      format: settingsMap.get('downloader_format') || 'mp3',
      quality: settingsMap.get('downloader_quality') || '320k',
      embedMetadata: settingsMap.get('downloader_embed_metadata') !== 'false',
      embedArtwork: settingsMap.get('downloader_embed_artwork') !== 'false',
      downloadLyrics,
      lyricsProviders: parsedProviders,
      // Compatibility keys matching Downtify naming
      download_lyrics: downloadLyrics,
      lyrics_providers: parsedProviders,
      folderStructure: settingsMap.get('downloader_folder_structure') || '{artist}/{artist} - {title}',
      playlistFolder: settingsMap.get('downloader_playlist_folder') !== 'false',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch downloader settings' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const {
      libraryId,
      format,
      quality,
      embedMetadata,
      embedArtwork,
      folderStructure,
      playlistFolder,
      downloadLyrics,
      download_lyrics,
      lyricsProviders,
      lyrics_providers,
    } = req.body;

    const finalDownloadLyrics = downloadLyrics ?? download_lyrics ?? true;
    const finalLyricsProviders = lyricsProviders ?? lyrics_providers ?? ['lrclib'];
    const providersArray = Array.isArray(finalLyricsProviders) ? finalLyricsProviders : [finalLyricsProviders];

    const pairs: [string, string][] = [
      ['downloader_library_id', String(libraryId ?? '')],
      ['downloader_format', String(format ?? 'mp3')],
      ['downloader_quality', String(quality ?? '320k')],
      ['downloader_embed_metadata', String(embedMetadata ?? true)],
      ['downloader_embed_artwork', String(embedArtwork ?? true)],
      ['downloader_folder_structure', String(folderStructure ?? '{artist}/{artist} - {title}')],
      ['downloader_playlist_folder', String(playlistFolder ?? true)],
      ['downloader_download_lyrics', String(finalDownloadLyrics)],
      ['downloader_lyrics_providers', JSON.stringify(providersArray)],
    ];

    for (const [key, value] of pairs) {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save downloader settings' });
  }
});

// -------------------------------------------------------------------
// RESOLVE & METADATA ENDPOINT
// -------------------------------------------------------------------

router.post('/resolve', async (req, res) => {
  try {
    const { urlOrQuery } = req.body;
    if (!urlOrQuery || typeof urlOrQuery !== 'string') {
      return res.status(400).json({ error: 'Search query or URL is required' });
    }

    const trimmed = urlOrQuery.trim();

    // 1. Check if Spotify URL
    if (trimmed.includes('spotify.com/')) {
      const isTrack = trimmed.includes('/track/');
      const isAlbum = trimmed.includes('/album/');
      const isPlaylist = trimmed.includes('/playlist/');

      if (isTrack) {
        // Fetch Spotify track metadata
        const trackData = await resolveSpotifyTrack(trimmed);
        return res.json({
          type: 'track',
          title: trackData.title,
          artist: trackData.artist,
          album: trackData.album,
          artworkUrl: trackData.artworkUrl,
          duration: trackData.duration,
          tracks: [trackData],
        });
      } else if (isAlbum) {
        const albumData = await resolveSpotifyAlbum(trimmed);
        return res.json(albumData);
      } else if (isPlaylist) {
        const playlistData = await resolveSpotifyPlaylist(trimmed);
        return res.json(playlistData);
      }
    }

    // 2. Check if YouTube / YouTube Music URL
    if (trimmed.includes('youtube.com/') || trimmed.includes('youtu.be/')) {
      const ytDlpPath = await getYtDlpPath();
      const isPlaylist = trimmed.includes('list=');

      if (isPlaylist) {
        const { stdout } = await execFilePromise(ytDlpPath, [
          '--flat-playlist',
          '--dump-json',
          '--js-runtimes',
          'node',
          trimmed,
        ]);

        const lines = stdout.trim().split('\n').filter(Boolean);
        const tracks = lines.map((line, idx) => {
          try {
            const parsed = JSON.parse(line);
            return {
              title: parsed.title || 'Unknown Title',
              artist: parsed.uploader || parsed.artist || 'Unknown Artist',
              album: 'YouTube Playlist',
              trackNumber: idx + 1,
              sourceUrl: parsed.url || `https://www.youtube.com/watch?v=${parsed.id}`,
              artworkUrl: parsed.thumbnails?.[0]?.url || '',
            };
          } catch (e) {
            return null;
          }
        }).filter(Boolean);

        return res.json({
          type: 'playlist',
          title: 'YouTube Playlist',
          tracks,
        });
      } else {
        const { stdout } = await execFilePromise(ytDlpPath, [
          '--dump-json',
          '--js-runtimes',
          'node',
          trimmed,
        ]);

        const parsed = JSON.parse(stdout);
        const track = {
          title: parsed.track || parsed.title || 'Unknown Title',
          artist: parsed.artist || parsed.uploader || 'Unknown Artist',
          album: parsed.album || 'Single',
          duration: parsed.duration || 0,
          artworkUrl: parsed.thumbnail || '',
          sourceUrl: trimmed,
        };

        return res.json({
          type: 'track',
          title: track.title,
          artist: track.artist,
          album: track.album,
          artworkUrl: track.artworkUrl,
          tracks: [track],
        });
      }
    }

    // 3. Text Search Query (via iTunes Search API + fallback)
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(trimmed)}&entity=song&limit=12`;
    const itunesRes = await fetch(itunesUrl);
    if (itunesRes.ok) {
      const itunesData = await itunesRes.json();
      if (itunesData.results && itunesData.results.length > 0) {
        const tracks = itunesData.results.map((item: any, idx: number) => ({
          title: item.trackName || 'Unknown Title',
          artist: item.artistName || 'Unknown Artist',
          album: item.collectionName || 'Single',
          trackNumber: item.trackNumber || idx + 1,
          discNumber: item.discNumber || 1,
          releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
          artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
          duration: Math.round((item.trackTimeMillis || 0) / 1000),
        }));

        return res.json({
          type: 'search',
          query: trimmed,
          tracks,
        });
      }
    }

    // Fallback search via yt-dlp search
    const ytDlpPath = await getYtDlpPath();
    const { stdout } = await execFilePromise(ytDlpPath, [
      `ytsearch5:${trimmed}`,
      '--dump-json',
      '--flat-playlist',
      '--js-runtimes',
      'node',
    ]);

    const lines = stdout.trim().split('\n').filter(Boolean);
    const tracks = lines.map((line, idx) => {
      try {
        const parsed = JSON.parse(line);
        return {
          title: parsed.title || 'Unknown Title',
          artist: parsed.uploader || 'Unknown Artist',
          album: 'YouTube Search',
          trackNumber: idx + 1,
          sourceUrl: parsed.url || `https://www.youtube.com/watch?v=${parsed.id}`,
          artworkUrl: parsed.thumbnails?.[0]?.url || '',
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    return res.json({
      type: 'search',
      query: trimmed,
      tracks,
    });
  } catch (error: any) {
    console.error('Error resolving URL/query:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve search or music URL' });
  }
});

// Helper functions for Spotify metadata resolution
async function resolveSpotifyTrack(url: string) {
  // Use oEmbed API first
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl);
  let title = 'Unknown Title';
  let artworkUrl = '';

  if (res.ok) {
    const data = await res.json();
    title = data.title || 'Unknown Title';
    artworkUrl = data.thumbnail_url || '';
  }

  // Search iTunes for clean artist & album metadata using title
  let artist = 'Unknown Artist';
  let album = 'Single';
  let releaseYear: number | undefined;
  let trackNumber = 1;
  let discNumber = 1;
  let duration = 0;

  const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=song&limit=1`);
  if (itunesRes.ok) {
    const itunesData = await itunesRes.json();
    if (itunesData.results?.[0]) {
      const match = itunesData.results[0];
      title = match.trackName || title;
      artist = match.artistName || artist;
      album = match.collectionName || album;
      artworkUrl = match.artworkUrl100 ? match.artworkUrl100.replace('100x100bb', '600x600bb') : artworkUrl;
      releaseYear = match.releaseDate ? new Date(match.releaseDate).getFullYear() : undefined;
      trackNumber = match.trackNumber || 1;
      discNumber = match.discNumber || 1;
      duration = Math.round((match.trackTimeMillis || 0) / 1000);
    }
  }

  return {
    title,
    artist,
    album,
    artworkUrl,
    releaseYear,
    trackNumber,
    discNumber,
    duration,
  };
}

async function resolveSpotifyAlbum(url: string) {
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl);
  let albumTitle = 'Spotify Album';
  let artworkUrl = '';

  if (res.ok) {
    const data = await res.json();
    albumTitle = data.title || 'Spotify Album';
    artworkUrl = data.thumbnail_url || '';
  }

  // Search iTunes for the album
  const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(albumTitle)}&entity=song&limit=25`);
  if (itunesRes.ok) {
    const itunesData = await itunesRes.json();
    if (itunesData.results && itunesData.results.length > 0) {
      const artist = itunesData.results[0].artistName || 'Unknown Artist';
      const tracks = itunesData.results.map((item: any, idx: number) => ({
        title: item.trackName || 'Unknown Title',
        artist: item.artistName || artist,
        album: item.collectionName || albumTitle,
        trackNumber: item.trackNumber || idx + 1,
        discNumber: item.discNumber || 1,
        releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
        artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : artworkUrl,
        duration: Math.round((item.trackTimeMillis || 0) / 1000),
      }));

      return {
        type: 'album',
        title: albumTitle,
        artist,
        artworkUrl,
        tracks,
      };
    }
  }

  return {
    type: 'album',
    title: albumTitle,
    artworkUrl,
    tracks: [
      {
        title: albumTitle,
        artist: 'Unknown Artist',
        album: albumTitle,
        trackNumber: 1,
        artworkUrl,
      },
    ],
  };
}

async function resolveSpotifyPlaylist(url: string) {
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl);
  let playlistTitle = 'Spotify Playlist';
  let artworkUrl = '';

  if (res.ok) {
    const data = await res.json();
    playlistTitle = data.title || 'Spotify Playlist';
    artworkUrl = data.thumbnail_url || '';
  }

  return {
    type: 'playlist',
    title: playlistTitle,
    artworkUrl,
    tracks: [],
    message: 'Spotify playlist title retrieved. Enter track names or search terms directly if tracklist extraction is limited.',
  };
}

// -------------------------------------------------------------------
// DOWNLOAD EXECUTION ENDPOINTS
// -------------------------------------------------------------------

router.post('/start', async (req, res) => {
  try {
    const {
      libraryId,
      format = 'mp3',
      quality = '320k',
      embedMetadata = true,
      embedArtwork = true,
      folderStructure = '{artist}/{artist} - {title}',
      playlistFolder = true,
      playlistName,
      downloadLyrics,
      download_lyrics,
      lyricsProviders,
      lyrics_providers,
      tracks = [],
    } = req.body;

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({ error: 'No tracks specified for download' });
    }

    // Resolve target library path
    let targetLib;
    if (libraryId) {
      const libs = await db.select().from(libraries).where(eq(libraries.id, Number(libraryId))).limit(1);
      if (libs.length > 0) targetLib = libs[0];
    }

    if (!targetLib) {
      const allLibs = await db.select().from(libraries).limit(1);
      if (allLibs.length > 0) {
        targetLib = allLibs[0];
      } else {
        return res.status(400).json({ error: 'No media library configured in Yimly. Please add a library in Settings first.' });
      }
    }

    const allSettings = await db.select().from(settings);
    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

    const reqDlLyrics = downloadLyrics ?? download_lyrics;
    const finalDownloadLyrics = reqDlLyrics !== undefined 
      ? Boolean(reqDlLyrics) 
      : settingsMap.get('downloader_download_lyrics') !== 'false';

    const reqProviders = lyricsProviders ?? lyrics_providers;
    let finalProviders: string[] = ['lrclib'];
    if (reqProviders) {
      finalProviders = Array.isArray(reqProviders) ? reqProviders : [reqProviders];
    } else if (settingsMap.has('downloader_lyrics_providers')) {
      try {
        const parsed = JSON.parse(settingsMap.get('downloader_lyrics_providers')!);
        if (Array.isArray(parsed) && parsed.length > 0) {
          finalProviders = parsed;
        }
      } catch (e) {
        finalProviders = ['lrclib'];
      }
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const trackJobs: TrackJob[] = tracks.map((t: any, idx: number) => ({
      id: `tr_${idx}_${Math.random().toString(36).substring(2, 6)}`,
      title: t.title || 'Unknown Title',
      artist: t.artist || 'Unknown Artist',
      album: t.album || 'Unknown Album',
      trackNumber: t.trackNumber || idx + 1,
      discNumber: t.discNumber || 1,
      releaseYear: t.releaseYear,
      duration: t.duration,
      artworkUrl: t.artworkUrl,
      sourceUrl: t.sourceUrl,
      status: 'queued',
      progress: 0,
    }));

    const job: DownloadJob = {
      id: jobId,
      status: 'queued',
      tracks: trackJobs,
      libraryId: targetLib.id,
      libraryPath: targetLib.path,
      format,
      quality,
      embedMetadata,
      embedArtwork,
      downloadLyrics: finalDownloadLyrics,
      lyricsProviders: finalProviders,
      folderStructure,
      playlistFolder,
      playlistName,
      completedCount: 0,
      totalCount: trackJobs.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    activeJobs.set(jobId, job);

    // Process job asynchronously in background
    processJobInBackground(job);

    res.json({
      jobId,
      message: 'Download job started',
      totalTracks: trackJobs.length,
      libraryName: targetLib.name,
      libraryPath: targetLib.path,
    });
  } catch (error: any) {
    console.error('Failed to start download job:', error);
    res.status(500).json({ error: error.message || 'Failed to start download' });
  }
});

router.get('/jobs/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found' });
  }
  res.json(job);
});

router.post('/cancel/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found' });
  }

  job.status = 'cancelled';
  for (const track of job.tracks) {
    if (track.status === 'queued' || track.status === 'searching' || track.status === 'downloading') {
      track.status = 'failed';
      track.error = 'Job cancelled by user';
    }
  }
  job.updatedAt = Date.now();
  res.json({ message: 'Job cancelled' });
});

// -------------------------------------------------------------------
// BACKGROUND JOB PROCESSOR
// -------------------------------------------------------------------

async function processJobInBackground(job: DownloadJob) {
  job.status = 'downloading';
  job.updatedAt = Date.now();

  const ytDlpPath = await getYtDlpPath();

  for (const track of job.tracks) {
    if ((job.status as string) === 'cancelled') break;

    try {
      track.status = 'searching';
      track.progress = 10;
      job.updatedAt = Date.now();

      // Determine audio source URL or search query
      let queryOrUrl = track.sourceUrl;
      if (!queryOrUrl) {
        queryOrUrl = `ytsearch1:${track.artist} - ${track.title} audio`;
      }

      track.status = 'downloading';
      track.progress = 30;
      job.updatedAt = Date.now();

      // Determine lyrics providers and fetch lyrics in parallel/background
      const effectiveLyricsProviders = computeEffectiveLyricsProviders(
        job.downloadLyrics ?? true,
        job.lyricsProviders ?? ['lrclib']
      );

      let fetchedLyrics: Lyrics | null = null;
      if (effectiveLyricsProviders.length > 0) {
        try {
          console.log(`[Lyrics] Looking up lyrics for "${track.title}" by "${track.artist}" via [${effectiveLyricsProviders.join(', ')}]...`);
          fetchedLyrics = await fetchLyrics(
            {
              title: track.title,
              artists: [track.artist],
              artist: track.artist,
              album: track.album,
              duration: track.duration,
            },
            effectiveLyricsProviders
          );
          if (fetchedLyrics?.synced) {
            console.log(`[Lyrics] Found synced lyrics for "${track.title}"`);
          } else if (fetchedLyrics?.plain) {
            console.log(`[Lyrics] Found plain lyrics for "${track.title}"`);
          } else {
            console.log(`[Lyrics] No lyrics found on lrclib for "${track.title}"`);
          }
        } catch (lyricsErr) {
          console.warn(`[Lyrics] Non-fatal error during lyrics fetch for "${track.title}":`, lyricsErr);
        }
      }

      // Create temporary working directory for intermediate files
      const tmpDir = path.join(process.cwd(), 'data', 'tmp_downloads');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      const tempFileBase = path.join(tmpDir, `dl_${track.id}`);
      const formatExt = job.format === 'opus' ? 'opus' : job.format;

      // Quality mapping
      const qualityFlag = job.quality === '320k' ? '0' : job.quality === '256k' ? '1' : job.quality === '192k' ? '2' : '4';

      // Download audio via yt-dlp
      const possibleExtensions = [formatExt, 'mp3', 'm4a', 'flac', 'wav', 'opus', 'webm', 'ogg'];
      let downloadSuccess = false;
      const searchAttempts = [
        queryOrUrl,
        `scsearch1:${track.artist} ${track.title}`,
        `scsearch1:${track.artist.split(/[&,;/]|feat/i)[0].trim()} ${track.title}`,
      ];

      for (const attemptQuery of searchAttempts) {
        if (!attemptQuery) continue;
        try {
          const dlArgs = [
            '-x',
            '--audio-format',
            formatExt,
            '--audio-quality',
            qualityFlag,
          ];
          if (attemptQuery.includes('youtube') || attemptQuery.startsWith('ytsearch')) {
            dlArgs.push(
              '--js-runtimes',
              'node',
              '--extractor-args',
              'youtube:player_client=mweb,web_embedded'
            );
          }
          dlArgs.push('-o', `${tempFileBase}.%(ext)s`, attemptQuery);
          await execFilePromise(ytDlpPath, dlArgs);
          
          const hasFile = possibleExtensions.some((ext) => fs.existsSync(`${tempFileBase}.${ext}`));
          if (hasFile) {
            downloadSuccess = true;
            break;
          }
        } catch (attemptErr: any) {
          console.warn(`Download attempt with query "${attemptQuery}" failed, trying next fallback:`, attemptErr?.message || attemptErr);
        }
      }

      track.progress = 70;
      track.status = 'tagging';
      job.updatedAt = Date.now();

      // Find generated audio file
      let downloadedAudioFile = '';
      for (const ext of possibleExtensions) {
        const candidate = `${tempFileBase}.${ext}`;
        if (fs.existsSync(candidate)) {
          downloadedAudioFile = candidate;
          break;
        }
      }

      if (!downloadedAudioFile) {
        throw new Error('Downloaded audio file not found on disk');
      }

      // Download Cover Art image if present
      let artworkBuffer: Buffer | null = null;
      if (job.embedArtwork && track.artworkUrl) {
        try {
          const imgRes = await fetch(track.artworkUrl);
          if (imgRes.ok) {
            artworkBuffer = Buffer.from(await imgRes.arrayBuffer());
          }
        } catch (e) {
          console.warn('Failed to fetch artwork image:', e);
        }
      }

      // Embed ID3 Tags (for MP3)
      if (job.embedMetadata && (job.format === 'mp3' || downloadedAudioFile.endsWith('.mp3'))) {
        try {
          const tags: NodeID3.Tags = {
            title: track.title,
            artist: track.artist,
            album: track.album,
            trackNumber: track.trackNumber ? String(track.trackNumber) : undefined,
            partOfSet: track.discNumber ? String(track.discNumber) : undefined,
            year: track.releaseYear ? String(track.releaseYear) : undefined,
          };

          if (artworkBuffer) {
            tags.image = {
              mime: 'image/jpeg',
              type: { id: 3, name: 'front cover' },
              description: 'Cover Art',
              imageBuffer: artworkBuffer,
            };
          }

          if (fetchedLyrics) {
            const plainLyricsText = fetchedLyrics.plain || (fetchedLyrics.synced ? stripLrcTimestamps(fetchedLyrics.synced) : undefined);
            if (plainLyricsText) {
              tags.unsynchronisedLyrics = {
                language: 'eng',
                text: plainLyricsText,
              };
            }
          }

          NodeID3.write(tags, downloadedAudioFile);
        } catch (e) {
          console.warn('Failed to write ID3 tags:', e);
        }
      }

      // Construct final destination according to Downtify structure:
      // /media/<Artist>/<Artist> - <Title>.<formatExt>
      // /media/<Artist>/<Artist> - <Title>.lrc
      const safeArtist = sanitizeFilename(track.artist || 'Unknown Artist');
      const safeTitle = sanitizeFilename(track.title || 'Unknown Title');
      const baseFilename = `${safeArtist} - ${safeTitle}`;

      // Destination directory is strictly the artist folder inside library root (e.g. /media/<Artist>)
      const artistDir = path.join(job.libraryPath, safeArtist);

      if (!fs.existsSync(artistDir)) {
        fs.mkdirSync(artistDir, { recursive: true });
      }

      const finalDestFile = path.join(artistDir, `${baseFilename}.${formatExt}`);

      // Move temp file to final library path
      fs.copyFileSync(downloadedAudioFile, finalDestFile);
      fs.unlinkSync(downloadedAudioFile);

      // Save matching LRC sidecar directly beside the MP3 with matching base filename
      if (fetchedLyrics?.synced) {
        saveLrcSidecar(finalDestFile, fetchedLyrics.synced);
      }

      track.progress = 100;
      track.status = 'completed';
      job.completedCount++;
      job.updatedAt = Date.now();
    } catch (err: any) {
      console.error(`Error downloading track "${track.title}":`, err);
      track.status = 'failed';
      track.error = err.message || 'Download or conversion failed';
      job.updatedAt = Date.now();
    }
  }

  job.status = job.tracks.some((t) => t.status === 'completed') ? 'completed' : 'failed';
  job.updatedAt = Date.now();

  // Trigger Yimly's existing library scanner to index newly downloaded songs
  try {
    console.log(`Triggering Yimly media library rescan for library ID: ${job.libraryId} (${job.libraryPath})...`);
    await scanLibrary(job.libraryId, job.libraryPath);
    console.log(`Media library scan completed after music download.`);
  } catch (scanErr) {
    console.error('Error auto-rescanning library after download:', scanErr);
  }
}

export default router;
