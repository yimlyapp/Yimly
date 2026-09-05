import fs from 'fs';
import path from 'path';

export interface LyricsPresenceResult {
  hasLrc: boolean;
  hasElrc: boolean;
}

export interface SongLyricsCandidate {
  id: number;
  title?: string | null;
  mainAudioPath?: string | null;
  instrumentalAudioPath?: string | null;
}

export interface DbLyricsRecord {
  lrcPath?: string | null;
  elrcPath?: string | null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function cleanVariant(name: string): string {
  return name.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();
}

/**
 * Determines whether LRC and ELRC files exist for a song, checking both database paths
 * and the filesystem. LRC and ELRC detection remain completely independent.
 */
export function checkLyricsPresenceForSong(
  song: SongLyricsCandidate,
  dbRecord?: DbLyricsRecord | null
): LyricsPresenceResult {
  let hasLrc = false;
  let hasElrc = false;

  // 1. Check database paths if recorded
  if (dbRecord) {
    const rawLrc = dbRecord.lrcPath ? dbRecord.lrcPath.trim() : '';
    const rawElrc = dbRecord.elrcPath ? dbRecord.elrcPath.trim() : '';

    if (rawElrc.length > 0) {
      if (path.isAbsolute(rawElrc)) {
        if (fs.existsSync(rawElrc)) {
          hasElrc = true;
        }
      } else {
        hasElrc = true;
      }
    }

    if (rawLrc.length > 0) {
      // If rawLrc was stored pointing to an .elrc.lrc file, classify as ELRC
      if (rawLrc.toLowerCase().endsWith('.elrc.lrc')) {
        if (path.isAbsolute(rawLrc)) {
          if (fs.existsSync(rawLrc)) {
            hasElrc = true;
          }
        } else {
          hasElrc = true;
        }
      } else if (rawLrc.toLowerCase().endsWith('.lrc')) {
        if (path.isAbsolute(rawLrc)) {
          if (fs.existsSync(rawLrc)) {
            hasLrc = true;
          }
        } else {
          hasLrc = true;
        }
      } else {
        hasLrc = true;
      }
    }
  }

  // 2. Check filesystem independently for missing flags
  const audioPath = song.mainAudioPath || song.instrumentalAudioPath;
  if (audioPath) {
    try {
      const dir = path.dirname(audioPath);
      if (fs.existsSync(dir)) {
        const audioExt = path.extname(audioPath);
        const audioBase = path.basename(audioPath, audioExt);
        const cleanBase = audioBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
        const songTitle = song.title ? song.title.trim() : '';

        // Direct candidate paths for ELRC
        if (!hasElrc) {
          const directElrcCandidates = [
            path.join(dir, `${audioBase}.elrc.lrc`),
            path.join(dir, `${cleanBase}.elrc.lrc`),
          ];
          if (songTitle) {
            directElrcCandidates.push(path.join(dir, `${songTitle}.elrc.lrc`));
          }
          for (const p of directElrcCandidates) {
            if (fs.existsSync(p)) {
              hasElrc = true;
              break;
            }
          }
        }

        // Direct candidate paths for standard LRC
        if (!hasLrc) {
          const directLrcCandidates = [
            path.join(dir, `${audioBase}.lrc`),
            path.join(dir, `${cleanBase}.lrc`),
          ];
          if (songTitle) {
            directLrcCandidates.push(path.join(dir, `${songTitle}.lrc`));
          }
          for (const p of directLrcCandidates) {
            if (fs.existsSync(p)) {
              hasLrc = true;
              break;
            }
          }
        }

        // Scan directory if either is still not found
        if (!hasLrc || !hasElrc) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          const normAudio = normalizeName(audioBase);
          const cleanAudio = cleanVariant(audioBase);
          const normTitle = songTitle ? normalizeName(songTitle) : '';
          const cleanTitle = songTitle ? cleanVariant(songTitle) : '';

          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const lowerName = entry.name.toLowerCase();

            if (!hasElrc && lowerName.endsWith('.elrc.lrc')) {
              const elrcBase = entry.name.slice(0, -9);
              const normElrc = normalizeName(elrcBase);
              const cleanElrc = cleanVariant(elrcBase);
              if (
                normElrc === normAudio ||
                cleanElrc === cleanAudio ||
                (normTitle && (normElrc === normTitle || cleanElrc === cleanTitle))
              ) {
                hasElrc = true;
              }
            } else if (!hasLrc && lowerName.endsWith('.lrc') && !lowerName.endsWith('.elrc.lrc')) {
              const lrcBase = entry.name.slice(0, -4);
              const normLrc = normalizeName(lrcBase);
              const cleanLrc = cleanVariant(lrcBase);
              if (
                normLrc === normAudio ||
                cleanLrc === cleanAudio ||
                (normTitle && (normLrc === normTitle || cleanLrc === cleanTitle))
              ) {
                hasLrc = true;
              }
            }

            if (hasLrc && hasElrc) break;
          }
        }
      }
    } catch (err) {
      // Ignore filesystem access errors
    }
  }

  return { hasLrc, hasElrc };
}
