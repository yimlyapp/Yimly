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

import songsRoutes from './server/routes/songs.js';
app.use('/api/songs', songsRoutes);

import karaokeRoutes from './server/routes/karaoke.js';
app.use('/api/karaoke', karaokeRoutes);

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
