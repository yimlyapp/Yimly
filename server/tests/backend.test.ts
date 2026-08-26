import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, setupDatabase } from '../db/index.js';
import { users, libraries, artists, songs, favorites, playlists, playlistSongs } from '../db/schema.js';
import { eq } from 'drizzle-orm';

import playlistsRoutes from '../routes/playlists.js';
import favoritesRoutes from '../routes/favorites.js';
import authRoutes from '../routes/auth.js';
import songsRoutes from '../routes/songs.js';
import karaokeRoutes from '../routes/karaoke.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/songs', songsRoutes);
app.use('/api/playlists', playlistsRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/karaoke', karaokeRoutes);

let server: http.Server;
let baseUrl: string;

let tokenA: string;
let tokenB: string;
let userAId: number;
let userBId: number;
let song1Id: number;
let song2Id: number;

test('Setup test environment and start server', async () => {
  await setupDatabase();

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const hashedPass = await bcrypt.hash('password123', 10);
  
  try {
    const existingA = await db.select().from(users).where(eq(users.username, 'testuser_a')).limit(1);
    if (existingA.length > 0) userAId = existingA[0].id;
    else {
      const ins = await db.insert(users).values({ username: 'testuser_a', password: hashedPass, createdAt: new Date(), updatedAt: new Date() }).returning();
      userAId = ins[0].id;
    }

    const existingB = await db.select().from(users).where(eq(users.username, 'testuser_b')).limit(1);
    if (existingB.length > 0) userBId = existingB[0].id;
    else {
      const ins = await db.insert(users).values({ username: 'testuser_b', password: hashedPass, createdAt: new Date(), updatedAt: new Date() }).returning();
      userBId = ins[0].id;
    }
  } catch (e) {
    // ignore
  }

  tokenA = jwt.sign({ id: userAId, username: 'testuser_a', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ id: userBId, username: 'testuser_b', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  let libId: number;
  const existingLib = await db.select().from(libraries).where(eq(libraries.name, 'Test Library')).limit(1);
  if (existingLib.length > 0) {
    libId = existingLib[0].id;
  } else {
    const libRes = await db.insert(libraries).values({ name: 'Test Library', path: '/test/path' }).returning();
    libId = libRes[0].id;
  }

  let artId: number;
  const existingArt = await db.select().from(artists).where(eq(artists.name, 'Test Artist')).limit(1);
  if (existingArt.length > 0) {
    artId = existingArt[0].id;
  } else {
    const artRes = await db.insert(artists).values({ name: 'Test Artist' }).returning();
    artId = artRes[0].id;
  }

  const existingSong1 = await db.select().from(songs).where(eq(songs.title, 'Test Song 1')).limit(1);
  if (existingSong1.length > 0) {
    song1Id = existingSong1[0].id;
  } else {
    const s1 = await db.insert(songs).values({
      libraryId: libId,
      artistId: artId,
      title: 'Test Song 1',
      mainAudioPath: '/test/audio1.mp3',
      duration: 180,
    }).returning();
    song1Id = s1[0].id;
  }

  const existingSong2 = await db.select().from(songs).where(eq(songs.title, 'Test Song 2')).limit(1);
  if (existingSong2.length > 0) {
    song2Id = existingSong2[0].id;
  } else {
    const s2 = await db.insert(songs).values({
      libraryId: libId,
      artistId: artId,
      title: 'Test Song 2',
      mainAudioPath: '/test/audio2.mp3',
      duration: 200,
    }).returning();
    song2Id = s2[0].id;
  }
});

test('Favorites API tests', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/favorites`);
  assert.strictEqual(unauthRes.status, 401);

  const addRes = await fetch(`${baseUrl}/api/favorites/${song1Id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(addRes.status, 201);
  const addData = await addRes.json();
  assert.strictEqual(addData.favorited, true);
  assert.strictEqual(addData.songId, song1Id);

  const addDupRes = await fetch(`${baseUrl}/api/favorites/${song1Id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(addDupRes.status, 201);

  const getFavsRes = await fetch(`${baseUrl}/api/favorites`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(getFavsRes.status, 200);
  const favsList = await getFavsRes.json();
  assert.strictEqual(Array.isArray(favsList), true);
  assert.strictEqual(favsList.length >= 1, true);
  assert.strictEqual(favsList.some((s: any) => s.id === song1Id), true);

  const checkRes = await fetch(`${baseUrl}/api/favorites/${song1Id}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(checkRes.status, 200);
  const checkData = await checkRes.json();
  assert.strictEqual(checkData.favorited, true);

  const invalidSongRes = await fetch(`${baseUrl}/api/favorites/999999`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(invalidSongRes.status, 404);

  const getFavsBRes = await fetch(`${baseUrl}/api/favorites`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  const favsBList = await getFavsBRes.json();
  assert.strictEqual(favsBList.some((s: any) => s.id === song1Id), false);

  const delRes = await fetch(`${baseUrl}/api/favorites/${song1Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(delRes.status, 200);

  const checkAfterDel = await fetch(`${baseUrl}/api/favorites/${song1Id}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  const checkAfterData = await checkAfterDel.json();
  assert.strictEqual(checkAfterData.favorited, false);
});

test('Playlists API tests', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/playlists`);
  assert.strictEqual(unauthRes.status, 401);

  const createRes = await fetch(`${baseUrl}/api/playlists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ name: 'User A Playlist', description: 'Test description' })
  });
  assert.strictEqual(createRes.status, 201);
  const playlist = await createRes.json();
  const playlistId = playlist.id;
  assert.strictEqual(playlist.name, 'User A Playlist');
  assert.strictEqual(playlist.isOwner, true);

  const getRes = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(getRes.status, 200);
  const fetchedPlaylist = await getRes.json();
  assert.strictEqual(fetchedPlaylist.id, playlistId);
  assert.strictEqual(Array.isArray(fetchedPlaylist.songs), true);

  const updateRes = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ name: 'Updated Playlist Name' })
  });
  assert.strictEqual(updateRes.status, 200);
  const updatedData = await updateRes.json();
  assert.strictEqual(updatedData.name, 'Updated Playlist Name');

  const addSongRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ songId: song1Id })
  });
  assert.strictEqual(addSongRes.status, 201);

  const addDupSongRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ songId: song1Id })
  });
  assert.strictEqual(addDupSongRes.status, 400);

  await fetch(`${baseUrl}/api/playlists/${playlistId}/songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ songId: song2Id })
  });

  const reorderRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs/reorder`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ songIds: [song2Id, song1Id] })
  });
  assert.strictEqual(reorderRes.status, 200);

  const getReordered = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  const reorderedData = await getReordered.json();
  assert.strictEqual(reorderedData.songs[0].id, song2Id);
  assert.strictEqual(reorderedData.songs[1].id, song1Id);

  const getResB = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(getResB.status, 403);

  const removeSongRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs/${song1Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(removeSongRes.status, 200);

  const delPlaylistRes = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(delPlaylistRes.status, 200);
});

test('Karaoke Guest Queue API tests', async () => {
  // 1. Host (User A) creates karaoke session
  const createRoomRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    }
  });
  assert.strictEqual(createRoomRes.status, 200);
  const session = await createRoomRes.json();
  assert.ok(session.id);
  assert.ok(session.roomCode);

  // 2. Guest joins room
  const joinRes = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: session.roomCode, displayName: 'Test Guest' })
  });
  assert.strictEqual(joinRes.status, 200);
  const joinData = await joinRes.json();
  assert.strictEqual(joinData.sessionId, session.id);
  assert.ok(joinData.controllerId);

  // 3. Guest adds song to queue
  const queueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId: song1Id, controllerId: joinData.controllerId })
  });
  assert.strictEqual(queueRes.status, 200);
  const queueItem = await queueRes.json();
  assert.ok(queueItem.id);
  assert.strictEqual(queueItem.songId, song1Id);
  assert.strictEqual(queueItem.guestName, 'Test Guest');
});

test('Multiple simultaneous karaoke rooms hosted by same user', async () => {
  // User A creates Room 1, Room 2, Room 3
  const res1 = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(res1.status, 200);
  const room1 = await res1.json();

  const res2 = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(res2.status, 200);
  const room2 = await res2.json();

  const res3 = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(res3.status, 200);
  const room3 = await res3.json();

  // Verify distinct session IDs and room codes
  assert.notStrictEqual(room1.id, room2.id);
  assert.notStrictEqual(room2.id, room3.id);
  assert.notStrictEqual(room1.roomCode, room2.roomCode);

  // Verify all three exist and are active in active-sessions list
  const activeRes = await fetch(`${baseUrl}/api/karaoke/active-sessions`);
  assert.strictEqual(activeRes.status, 200);
  const activeRooms = await activeRes.json();
  const roomIds = activeRooms.map((r: any) => r.id);
  assert.ok(roomIds.includes(room1.id));
  assert.ok(roomIds.includes(room2.id));
  assert.ok(roomIds.includes(room3.id));

  // Verify guests can join Room 1 and Room 2 independently
  const join1 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: room1.roomCode, displayName: 'Guest 1' })
  });
  assert.strictEqual(join1.status, 200);
  const data1 = await join1.json();
  assert.strictEqual(data1.sessionId, room1.id);

  const join2 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: room2.roomCode, displayName: 'Guest 2' })
  });
  assert.strictEqual(join2.status, 200);
  const data2 = await join2.json();
  assert.strictEqual(data2.sessionId, room2.id);

  // End Room 2
  const endRes = await fetch(`${baseUrl}/api/karaoke/sessions/${room2.id}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(endRes.status, 200);

  // Verify Room 1 and Room 3 are still active, while Room 2 is closed
  const activeResAfter = await fetch(`${baseUrl}/api/karaoke/active-sessions`);
  const activeRoomsAfter = await activeResAfter.json();
  const roomIdsAfter = activeRoomsAfter.map((r: any) => r.id);
  assert.ok(roomIdsAfter.includes(room1.id));
  assert.ok(roomIdsAfter.includes(room3.id));
  assert.strictEqual(roomIdsAfter.includes(room2.id), false);
});

test('Close server', async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
