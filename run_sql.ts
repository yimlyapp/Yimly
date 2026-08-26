import { db } from './server/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS playlist_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'view',
      created_at INTEGER NOT NULL
    )
  `);
  
  await db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS playlist_shares_user_id_playlist_id_idx ON playlist_shares(user_id, playlist_id)
  `);
  console.log("Created table");
}
main();
