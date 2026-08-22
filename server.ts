import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { setupDatabase, db, databaseCorrupted, databaseErrorMessage } from './server/db/index.js';
import { users } from './server/db/schema.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSockets } from './server/ws/index.js';

// Convert import.meta.url for path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws/karaoke' });
setupWebSockets(wss);

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(cookieParser());

// Setup database on startup
setupDatabase().then(async () => {
  console.log('Database connected.');
});

// Health Check
app.get('/health', (req, res) => {
  if (databaseCorrupted) {
    return res.status(503).json({
      status: 'unhealthy',
      version: '1.0.0',
      database: 'corrupted',
      error: databaseErrorMessage || 'Database corruption detected. Manual recovery required.'
    });
  }
  res.json({
    status: 'ok',
    version: '1.0.0',
    database: 'connected'
  });
});

// Setup Setup Routes
import setupRoutes from './server/routes/setup.js';
app.use('/api/setup', setupRoutes);

import authRoutes from './server/routes/auth.js';
app.use('/api/auth', authRoutes);

// Add users routes (we will create this later)
import usersRoutes from './server/routes/users.js';
app.use('/api/users', usersRoutes);

import librariesRoutes from './server/routes/libraries.js';
app.use('/api/libraries', librariesRoutes);

import artistsRoutes from './server/routes/artists.js';
app.use('/api/artists', artistsRoutes);

import albumsRoutes from './server/routes/albums.js';
app.use('/api/albums', albumsRoutes);

import songsRoutes from './server/routes/songs.js';
app.use('/api/songs', songsRoutes);

import karaokeRoutes from './server/routes/karaoke.js';
app.use('/api/karaoke', karaokeRoutes);

// Global Search endpoint
import { artists, albums, songs } from './server/db/schema.js';
import { eq, like, or } from 'drizzle-orm';
import { requireAuth } from './server/middleware/auth.js';

app.get('/api/search', requireAuth, async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);

    const searchStr = `%${q}%`;
    const foundSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      album: albums.title,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(or(like(songs.title, searchStr), like(songs.mainAudioPath, searchStr)))
    .limit(10);

    const foundArtists = await db.select({
      id: artists.id,
      name: artists.name,
    })
    .from(artists)
    .where(like(artists.name, searchStr))
    .limit(10);

    const foundAlbums = await db.select({
      id: albums.id,
      title: albums.title,
      artist: artists.name,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.artistId, artists.id))
    .where(like(albums.title, searchStr))
    .limit(10);

    res.json([
      ...foundArtists.map(a => ({ type: 'artist', ...a })),
      ...foundAlbums.map(al => ({ type: 'album', ...al })),
      ...foundSongs.map(s => ({ type: 'song', ...s })),
    ]);
  } catch (error) {
    res.status(500).json({ error: 'Global search failed' });
  }
});

async function startServer() {
  if (!isProd) {
    // Development mode: Use Vite's middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: serve static files
    const clientDist = fs.existsSync(path.resolve(__dirname, 'client'))
      ? path.resolve(__dirname, 'client')
      : path.resolve(process.cwd(), 'dist/client');
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(clientDist, 'index.html'));
    });
  }

  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
