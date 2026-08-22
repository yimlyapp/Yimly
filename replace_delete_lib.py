import re

with open('server/routes/libraries.ts', 'r') as f:
    content = f.read()

replacement = """import { libraries, songs, artists, albums, lyrics, queueItems } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';"""

content = re.sub(r"import \{ libraries, songs, artists, albums \} from '\.\./db/schema\.js';\nimport \{ eq \} from 'drizzle-orm';", replacement, content)

delete_endpoint = """
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lib = await db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
    
    if (lib.length === 0) {
      return res.status(404).json({ error: 'Library not found' });
    }

    const libSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.libraryId, id));
    const songIds = libSongs.map(s => s.id);

    if (songIds.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < songIds.length; i += chunkSize) {
        const chunk = songIds.slice(i, i + chunkSize);
        await db.delete(lyrics).where(inArray(lyrics.songId, chunk));
        await db.delete(queueItems).where(inArray(queueItems.songId, chunk));
        await db.delete(songs).where(inArray(songs.id, chunk));
      }
    }

    await db.delete(libraries).where(eq(libraries.id, id));
    
    res.json({ message: 'Library removed' });
  } catch (error) {
    console.error('Error deleting library:', error);
    res.status(500).json({ error: 'Failed to remove library' });
  }
});

import { sql } from 'drizzle-orm';"""

content = re.sub(r"import \{ sql \} from 'drizzle-orm';", delete_endpoint, content)

with open('server/routes/libraries.ts', 'w') as f:
    f.write(content)

