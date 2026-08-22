import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';
import fs from 'fs';
import path from 'path';
import { migrate } from 'drizzle-orm/libsql/migrator';

// Ensure data directory exists
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const sqlite = createClient({
  url: `file:${path.join(dataDir, 'yimly.db')}`,
});

export const db = drizzle(sqlite, { schema });

// Run migrations on startup
export async function setupDatabase() {
  // we will run this from index.ts or server.ts
  const migrationsFolder = path.resolve(process.cwd(), 'server/db/migrations');
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
}
