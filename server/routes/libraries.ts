import { Router } from 'express';
import { db } from '../db/index.js';
import { libraries, songs, artists } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { scanLibrary } from '../lib/scanner.js';
import fs from 'fs';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allLibs = await db.select().from(libraries);
    res.json(allLibs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, path: libPath } = req.body;
    if (!name || !libPath) {
      return res.status(400).json({ error: 'Name and path required' });
    }

    if (!fs.existsSync(libPath)) {
      return res.status(400).json({ error: 'Directory does not exist on server' });
    }

    const inserted = await db.insert(libraries).values({
      name,
      path: libPath,
    }).returning();

    res.json(inserted[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create library' });
  }
});

router.post('/:id/scan', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lib = await db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
    
    if (lib.length === 0) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Run async so it doesn't block request
    scanLibrary(lib[0].id, lib[0].path)
      .then(() => console.log(`Finished scanning library: ${lib[0].name}`))
      .catch((e) => console.error(`Error scanning library: ${e}`));

    res.json({ message: 'Scan started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

import { sql } from 'drizzle-orm';

// Library statistics
router.get('/stats', async (req, res) => {
  try {
    const songCountResult = await db.select({ count: sql<number>`count(*)` }).from(songs);
    const artistCountResult = await db.select({ count: sql<number>`count(*)` }).from(artists);
    res.json({ 
      songs: songCountResult[0].count, 
      artists: artistCountResult[0].count, 
      albums: 0 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
