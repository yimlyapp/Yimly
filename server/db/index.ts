import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';
import fs from 'fs';
import path from 'path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';

// Ensure data directory and artwork directory exist
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const artworkDir = path.join(dataDir, 'artwork');
if (!fs.existsSync(artworkDir)) {
  fs.mkdirSync(artworkDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'yimly.db');

export let sqlite = createClient({
  url: `file:${dbPath}`,
});

export let db = drizzle(sqlite, { schema });

export let databaseCorrupted = false;
export let databaseErrorMessage: string | null = null;

// Run migrations on startup and check for corruption
export async function setupDatabase() {
  const migrationsFolder = path.resolve(process.cwd(), 'server/db/migrations');
  
  let isCorrupt = false;
  let corruptionReason = '';

  try {
    // Configure robust SQLite pragmas for stability and corruption prevention
    await sqlite.execute('PRAGMA journal_mode = WAL;');
    await sqlite.execute('PRAGMA synchronous = NORMAL;');
    await sqlite.execute('PRAGMA busy_timeout = 5000;');

    const result = await sqlite.execute('PRAGMA integrity_check;');
    if (result.rows && result.rows.length > 0) {
      const val = Object.values(result.rows[0])[0];
      if (val !== 'ok') {
        corruptionReason = `PRAGMA integrity_check returned: ${val}`;
        isCorrupt = true;
      }
    }
  } catch (err: any) {
    if (err && (err.message?.includes('CORRUPT') || err.message?.includes('malformed') || err.code === 'SQLITE_CORRUPT')) {
      corruptionReason = err.message || 'SQLITE_CORRUPT error during integrity check';
      isCorrupt = true;
    }
  }

  if (!isCorrupt) {
    try {
      await db.select().from(schema.users).limit(1);
    } catch (err: any) {
      if (err && (err.message?.includes('CORRUPT') || err.message?.includes('malformed') || err.code === 'SQLITE_CORRUPT')) {
        corruptionReason = err.message || 'SQLITE_CORRUPT error querying users table';
        isCorrupt = true;
      }
    }
  }

  if (isCorrupt) {
    databaseCorrupted = true;
    databaseErrorMessage = `Database corruption detected: ${corruptionReason}. Manual database recovery required.`;

    console.error('========================================================================');
    console.error('🚨 CRITICAL DATABASE CORRUPTION ERROR');
    console.error(`Database Path: ${dbPath}`);
    console.error(`Reason: ${corruptionReason}`);
    console.error('Action taken: Stopped database initialization. Preserved original database.');
    console.error('A timestamped backup copy has been created for diagnostic purposes.');
    console.error('MANUAL DATABASE RECOVERY IS REQUIRED. Do not delete or overwrite data.');
    console.error('========================================================================');

    try {
      if (fs.existsSync(dbPath)) {
        const timestamp = Date.now();
        const backupPath = `${dbPath}.corrupt.${timestamp}`;
        fs.copyFileSync(dbPath, backupPath);
        if (fs.existsSync(`${dbPath}-wal`)) {
          fs.copyFileSync(`${dbPath}-wal`, `${backupPath}-wal`);
        }
        if (fs.existsSync(`${dbPath}-shm`)) {
          fs.copyFileSync(`${dbPath}-shm`, `${backupPath}-shm`);
        }
        console.log(`📁 Created timestamped backup copy of corrupted database at: ${backupPath}`);
      }
    } catch (backupErr) {
      console.error('Failed to create backup copy of corrupted database:', backupErr);
    }

    // Stop normal database initialization. Do NOT create a new empty database, do NOT run migrations.
    return;
  }

  // Check if migrations folder exists before running migrate to avoid crashing if it's not generated yet
  if (fs.existsSync(migrationsFolder)) {
    try {
      await migrate(db, { migrationsFolder });
      console.log('Database migrations applied successfully.');
    } catch (error) {
      console.error('Error applying migrations:', error);
    }
  } else {
    console.warn('Migrations folder not found, skipping migrations.');
  }

  // Ensure artwork_path column exists in songs table (backward compatibility safety)
  try {
    await sqlite.execute('ALTER TABLE songs ADD COLUMN artwork_path text;');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure song_artists table exists (backward compatibility safety)
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS song_artists (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        song_id integer NOT NULL,
        artist_id integer NOT NULL,
        position integer DEFAULT 0 NOT NULL,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
        FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute('CREATE INDEX IF NOT EXISTS song_artists_song_id_idx ON song_artists (song_id);');
    await sqlite.execute('CREATE INDEX IF NOT EXISTS song_artists_artist_id_idx ON song_artists (artist_id);');
  } catch (e) {
    // Table/indices already exist, safe to ignore
  }

  // Normalize multi-artist metadata and backfill song_artists
  try {
    const { normalizeMultiArtistsInDatabase } = await import('../lib/artist-utils.js');
    await normalizeMultiArtistsInDatabase();
    console.log('Multi-artist metadata normalized.');
  } catch (err) {
    console.error('Failed to normalize multi-artist metadata:', err);
  }

  // Cleanup any sessions that were left active when the server last shut down/crashed
  try {
    await db.update(schema.sessions).set({ status: 'closed' }).where(eq(schema.sessions.status, 'active'));
    console.log('Cleaned up stale sessions on startup.');
  } catch (error) {
    console.error('Failed to cleanup stale sessions on startup:', error);
  }
}

export async function checkpointAndCloseDatabase() {
  try {
    if (sqlite && !databaseCorrupted) {
      await sqlite.execute('PRAGMA wal_checkpoint(TRUNCATE);');
      await sqlite.close();
      console.log('Database WAL checkpointed and closed cleanly.');
    }
  } catch (err) {
    console.error('Error during database clean shutdown:', err);
  }
}

