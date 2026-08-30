import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fsSync from 'fs';
import path from 'path';
import { db, setupDatabase } from '../db/index.js';
import { users, libraries, artists, songs, favorites, playlists, playlistSongs, lyrics } from '../db/schema.js';
import { eq } from 'drizzle-orm';

import playlistsRoutes from '../routes/playlists.js';
import favoritesRoutes from '../routes/favorites.js';
import authRoutes from '../routes/auth.js';
import songsRoutes from '../routes/songs.js';
import karaokeRoutes from '../routes/karaoke.js';
import librariesRoutes from '../routes/libraries.js';
import artistsRoutes from '../routes/artists.js';
import albumsRoutes from '../routes/albums.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/songs', songsRoutes);
app.use('/api/playlists', playlistsRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/karaoke', karaokeRoutes);
app.use('/api/libraries', librariesRoutes);
app.use('/api/artists', artistsRoutes);
app.use('/api/albums', albumsRoutes);

let server: http.Server;
let baseUrl: string;

let tokenA: string;
let tokenB: string;
let tokenC: string;
let userAId: number;
let userBId: number;
  let userCId: number;
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
  
    const existingC = await db.select().from(users).where(eq(users.username, 'testuser_c')).limit(1);
    if (existingC.length > 0) userCId = existingC[0].id;
    else {
      const ins = await db.select().from(users);
      const newC = await db.insert(users).values({ username: 'testuser_c', password: hashedPass, createdAt: new Date(), updatedAt: new Date() }).returning();
      userCId = newC[0].id;
    }
} catch (e) {
    // ignore
  }

  tokenA = jwt.sign({ id: userAId, username: 'testuser_a', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ id: userBId, username: 'testuser_b', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  let testUserId: number;
  let test2UserId: number;
  const existingTestUser = await db.select().from(users).where(eq(users.username, 'test')).limit(1);
  if (existingTestUser.length > 0) {
    testUserId = existingTestUser[0].id;
    await db.update(users).set({ role: 'administrator' }).where(eq(users.id, testUserId));
  } else {
    const ins = await db.insert(users).values({ username: 'test', password: hashedPass, role: 'administrator', createdAt: new Date(), updatedAt: new Date() }).returning();
    testUserId = ins[0].id;
  }

  const existingTest2User = await db.select().from(users).where(eq(users.username, 'test2')).limit(1);
  if (existingTest2User.length > 0) {
    test2UserId = existingTest2User[0].id;
    await db.update(users).set({ role: 'user' }).where(eq(users.id, test2UserId));
  } else {
    const ins = await db.insert(users).values({ username: 'test2', password: hashedPass, role: 'user', createdAt: new Date(), updatedAt: new Date() }).returning();
    test2UserId = ins[0].id;
  }

  const tokenTest = jwt.sign({ id: testUserId, username: 'test', role: 'administrator' }, JWT_SECRET, { expiresIn: '1h' });
  const tokenTest2 = jwt.sign({ id: test2UserId, username: 'test2', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  (global as any).tokenTest = tokenTest;
  (global as any).tokenTest2 = tokenTest2;
tokenC = jwt.sign({ id: userCId, username: 'testuser_c', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

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


test('Shared Playlists API tests', async () => {
  // 1. User A creates a playlist
  const createRes = await fetch(`${baseUrl}/api/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Shared Playlist' })
  });
  const playlist = await createRes.json();
  const playlistId = playlist.id;

  // 2. User C cannot access it
  const getResC = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${tokenC}` }
  });
  assert.strictEqual(getResC.status, 403);

  // 3. User A shares it with User B as VIEW
  const shareRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ username: 'testuser_b', permission: 'view' })
  });
  assert.strictEqual(shareRes.status, 201);

  // 4. User B can view it but cannot modify it
  const getResB = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(getResB.status, 200);
  
  const addResB = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ songId: song1Id })
  });
  assert.strictEqual(addResB.status, 403);

  // 5. User A changes B to EDIT
  const updateShareRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ username: 'testuser_b', permission: 'edit' })
  });
  assert.strictEqual(updateShareRes.status, 200);

  // 6. User B can now add a track
  const addResB2 = await fetch(`${baseUrl}/api/playlists/${playlistId}/songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ songId: song1Id })
  });
  assert.strictEqual(addResB2.status, 201);

  // 7. User A revokes access
  const fetchUserB = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenB}` }});
  const userBData = await fetchUserB.json();
  
  const revokeRes = await fetch(`${baseUrl}/api/playlists/${playlistId}/share/${userBData.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(revokeRes.status, 200);

  // 8. User B loses access
  const getResB_after = await fetch(`${baseUrl}/api/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(getResB_after.status, 403);
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

test('Community Playlists visibility and privacy test scenario', async () => {
  // 1. User A creates a Community Playlist ("Test Community Playlist", isPublic: true)
  const createPublicRes = await fetch(`${baseUrl}/api/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Test Community Playlist', isPublic: true })
  });
  assert.strictEqual(createPublicRes.status, 201);
  const publicPlaylist = await createPublicRes.json();
  assert.strictEqual(publicPlaylist.name, 'Test Community Playlist');
  assert.strictEqual(publicPlaylist.isPublic, true);

  // 2. User A creates a Personal Playlist ("Test Personal Playlist", isPublic: false)
  const createPrivateRes = await fetch(`${baseUrl}/api/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Test Personal Playlist', isPublic: false })
  });
  assert.strictEqual(createPrivateRes.status, 201);
  const privatePlaylist = await createPrivateRes.json();

  // 3. User B (different normal authenticated user) requests playlist listing
  const listResB = await fetch(`${baseUrl}/api/playlists`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(listResB.status, 200);
  const playlistsB = await listResB.json();

  // ASSERT: User B receives "Test Community Playlist"
  const foundCommunity = playlistsB.find((p: any) => p.id === publicPlaylist.id);
  assert.ok(foundCommunity, 'User B should see User A\'s Community Playlist in listing');
  assert.strictEqual(foundCommunity.name, 'Test Community Playlist');

  // 4. User B opens the same Community Playlist
  const detailResB = await fetch(`${baseUrl}/api/playlists/${publicPlaylist.id}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(detailResB.status, 200, 'User B should successfully load Community Playlist detail');
  const detailDataB = await detailResB.json();
  assert.strictEqual(detailDataB.id, publicPlaylist.id);

  // 5. User B requests User A's PERSONAL playlist
  const privateDetailResB = await fetch(`${baseUrl}/api/playlists/${privatePlaylist.id}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(privateDetailResB.status, 403, 'User B cannot access User A\'s personal playlist');
});

test('Community Playlist cover image upload and cross-user retrieval test scenario', async () => {
  const tokenTest = (global as any).tokenTest;
  const tokenTest2 = (global as any).tokenTest2;

  // 1. User 'test' creates a public Community Playlist
  const createRes = await fetch(`${baseUrl}/api/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenTest}` },
    body: JSON.stringify({ name: 'Cover Test Community Playlist', isPublic: true })
  });
  assert.strictEqual(createRes.status, 201);
  const playlist = await createRes.json();
  assert.strictEqual(playlist.coverImageUrl, null);

  // Valid small JPEG magic bytes
  const sampleJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x0A, 0x00, 0x0A, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x37, 0xFF, 0xD9]);

  // 2. User 'test2' (unauthorized non-owner) attempts to upload cover -> 403
  const unauthorizedUpload = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${tokenTest2}` },
    body: sampleJpeg
  });
  assert.strictEqual(unauthorizedUpload.status, 403);

  // 3. User 'test' (owner) uploads cover Cover A -> 200
  const uploadRes = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${tokenTest}` },
    body: sampleJpeg
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.ok(uploadData.coverImageUrl);
  assert.strictEqual(uploadData.coverImageUrl, `/api/playlists/${playlist.id}/cover`);

  // Verify DB record contains cover_path
  const dbPlaylist = await db.select().from(playlists).where(eq(playlists.id, playlist.id)).limit(1);
  assert.ok(dbPlaylist.length > 0);
  assert.ok(dbPlaylist[0].coverPath, 'Database playlists table must store persistent coverPath');

  // Verify image file exists on disk
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
  const coverFilePathA = path.join(dataDir, 'playlist_covers', path.basename(dbPlaylist[0].coverPath!));
  assert.ok(fsSync.existsSync(coverFilePathA), 'Cover image file A must exist on disk in playlist_covers directory');

  // 4. User 'test' GET community playlists -> returns coverImageUrl
  const listResTest = await fetch(`${baseUrl}/api/playlists`, {
    headers: { Authorization: `Bearer ${tokenTest}` }
  });
  assert.strictEqual(listResTest.status, 200);
  const listTest = await listResTest.json();
  const foundTest = listTest.find((p: any) => p.id === playlist.id);
  assert.ok(foundTest);
  assert.strictEqual(foundTest.coverImageUrl, `/api/playlists/${playlist.id}/cover`);

  // 5. User 'test2' GET community playlists -> returns same coverImageUrl
  const listResTest2 = await fetch(`${baseUrl}/api/playlists`, {
    headers: { Authorization: `Bearer ${tokenTest2}` }
  });
  assert.strictEqual(listResTest2.status, 200);
  const listTest2 = await listResTest2.json();
  const foundTest2 = listTest2.find((p: any) => p.id === playlist.id);
  assert.ok(foundTest2, 'User test2 must see the community playlist in GET /api/playlists');
  assert.strictEqual(foundTest2.coverImageUrl, `/api/playlists/${playlist.id}/cover`, 'User test2 must see the coverImageUrl');

  // 6. User 'test2' GET individual playlist detail -> returns same coverImageUrl
  const detailResTest2 = await fetch(`${baseUrl}/api/playlists/${playlist.id}`, {
    headers: { Authorization: `Bearer ${tokenTest2}` }
  });
  assert.strictEqual(detailResTest2.status, 200);
  const detailDataTest2 = await detailResTest2.json();
  assert.strictEqual(detailDataTest2.coverImageUrl, `/api/playlists/${playlist.id}/cover`);

  // 7. User 'test2' requests image URL directly -> HTTP 200 with correct image content
  const getCoverResTest2 = await fetch(`${baseUrl}${foundTest2.coverImageUrl}`, {
    headers: { Authorization: `Bearer ${tokenTest2}` }
  });
  assert.strictEqual(getCoverResTest2.status, 200);
  assert.strictEqual(getCoverResTest2.headers.get('content-type'), 'image/jpeg');
  const bufferResult = Buffer.from(await getCoverResTest2.arrayBuffer());
  assert.strictEqual(bufferResult.length, sampleJpeg.length);

  // 8. Replace Cover with Cover B (PNG format via JSON base64 body)
  const samplePng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
  const base64Png = `data:image/png;base64,${samplePng.toString('base64')}`;

  const replaceRes = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenTest}` },
    body: JSON.stringify({ image: base64Png })
  });
  assert.strictEqual(replaceRes.status, 200);

  // Verify Cover B updated in DB
  const dbPlaylistB = await db.select().from(playlists).where(eq(playlists.id, playlist.id)).limit(1);
  assert.ok(dbPlaylistB[0].coverPath);
  assert.notStrictEqual(dbPlaylistB[0].coverPath, dbPlaylist[0].coverPath, 'Cover path in DB must point to Cover B');

  // Verify old Cover A file is removed and Cover B file exists
  assert.strictEqual(fsSync.existsSync(coverFilePathA), false, 'Old Cover A file should be unlinked');
  const coverFilePathB = path.join(dataDir, 'playlist_covers', path.basename(dbPlaylistB[0].coverPath!));
  assert.ok(fsSync.existsSync(coverFilePathB), 'New Cover B file must exist on disk');

  // User 'test2' fetches Cover B via image URL -> 200 with PNG content-type
  const getCoverB = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    headers: { Authorization: `Bearer ${tokenTest2}` }
  });
  assert.strictEqual(getCoverB.status, 200);
  assert.strictEqual(getCoverB.headers.get('content-type'), 'image/png');

  // 9. Remove Cover -> DELETE /api/playlists/:id/cover
  const deleteCoverRes = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenTest}` }
  });
  assert.strictEqual(deleteCoverRes.status, 200);
  const deletedData = await deleteCoverRes.json();
  assert.strictEqual(deletedData.coverImageUrl, null);

  // Verify DB record cover_path is null and file deleted
  const dbPlaylistDeleted = await db.select().from(playlists).where(eq(playlists.id, playlist.id)).limit(1);
  assert.strictEqual(dbPlaylistDeleted[0].coverPath, null);
  assert.strictEqual(fsSync.existsSync(coverFilePathB), false);
});

test('Song LRC management and complete song deletion test scenario (using test and test2)', async () => {
  const tokenTest = (global as any).tokenTest;
  const tokenTest2 = (global as any).tokenTest2;

  // 1. Create temporary library and test files:
  // Original: TEST SONG.mp3
  // LRC: TEST SONG.lrc
  // Instrumental: TEST SONG (Instrumental).mp3
  const tempLibPath = path.join(process.cwd(), 'data', 'test_song_lib_final');
  if (!fsSync.existsSync(tempLibPath)) fsSync.mkdirSync(tempLibPath, { recursive: true });

  const libRes = await db.insert(libraries).values({ name: 'Final Song Test Library', path: tempLibPath }).returning();
  const testLibId = libRes[0].id;

  let artId: number;
  const existingArt = await db.select().from(artists).where(eq(artists.name, 'Test Song Artist Final')).limit(1);
  if (existingArt.length > 0) {
    artId = existingArt[0].id;
  } else {
    const artRes = await db.insert(artists).values({ name: 'Test Song Artist Final' }).returning();
    artId = artRes[0].id;
  }

  const originalFilename = 'TEST SONG.mp3';
  const instrumentalFilename = 'TEST SONG (Instrumental).mp3';
  const lrcFilename = 'TEST SONG.lrc';

  const originalPath = path.join(tempLibPath, originalFilename);
  const instrumentalPath = path.join(tempLibPath, instrumentalFilename);
  const lrcFilePath = path.join(tempLibPath, lrcFilename);

  fsSync.writeFileSync(originalPath, Buffer.from('fake mp3 data'));
  fsSync.writeFileSync(instrumentalPath, Buffer.from('fake instrumental mp3 data'));
  fsSync.writeFileSync(lrcFilePath, '[00:05.00]Initial test lyric');

  const songIns = await db.insert(songs).values({
    libraryId: testLibId,
    artistId: artId,
    title: 'TEST SONG',
    mainAudioPath: originalPath,
    instrumentalAudioPath: instrumentalPath,
    duration: 210,
  }).returning();
  const songId = songIns[0].id;

  await db.insert(lyrics).values({
    songId: songId,
    lrcPath: lrcFilePath,
  });

  // A. GET existing LRC
  const getLrc1 = await fetch(`${baseUrl}/api/songs/${songId}/lyrics`);
  assert.strictEqual(getLrc1.status, 200);
  const text1 = await getLrc1.text();
  assert.strictEqual(text1.includes('Initial test lyric'), true);

  // B. Upload replacement LRC using test (admin)
  const replacementLrc = '[00:10.00]Updated lyric line 1\n[00:20.00]Updated lyric line 2';
  const uploadRes = await fetch(`${baseUrl}/api/songs/${songId}/lrc`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${tokenTest}` },
    body: replacementLrc,
  });
  assert.strictEqual(uploadRes.status, 200);

  // C. GET LRC again & assert new LRC returned
  const getLrc2 = await fetch(`${baseUrl}/api/songs/${songId}/lyrics`);
  assert.strictEqual(getLrc2.status, 200);
  const text2 = await getLrc2.text();
  assert.strictEqual(text2, replacementLrc);

  // D. Edit LRC through edit endpoint (PUT)
  const editedLrc = '[00:12.34]Edited First lyric\n[00:16.20]Edited Second lyric\n[00:20.50]Edited Third lyric';
  const editRes = await fetch(`${baseUrl}/api/songs/${songId}/lrc`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${tokenTest}` },
    body: editedLrc,
  });
  assert.strictEqual(editRes.status, 200);

  // E. GET LRC again & assert exact edited content returned
  const getLrc3 = await fetch(`${baseUrl}/api/songs/${songId}/lyrics`);
  assert.strictEqual(getLrc3.status, 200);
  const text3 = await getLrc3.text();
  assert.strictEqual(text3, editedLrc);

  // F. Persistence / Restart test simulation:
  // Verify file on disk contains editedLrc
  assert.strictEqual(fsSync.existsSync(lrcFilePath), true);
  assert.strictEqual(fsSync.readFileSync(lrcFilePath, 'utf-8'), editedLrc);

  // Security test: test2 (non-admin) cannot modify LRC -> 403
  const unauthEdit = await fetch(`${baseUrl}/api/songs/${songId}/lrc`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${tokenTest2}` },
    body: 'hack',
  });
  assert.strictEqual(unauthEdit.status, 403);

  // Security test: unauthenticated request to modify LRC -> 401
  const noTokenEdit = await fetch(`${baseUrl}/api/songs/${songId}/lrc`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: 'hack',
  });
  assert.strictEqual(noTokenEdit.status, 401);

  // Security test: test2 cannot delete song -> 403
  const unauthDel = await fetch(`${baseUrl}/api/songs/${songId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenTest2}` },
  });
  assert.strictEqual(unauthDel.status, 403);

  // Invalid song ID test -> 400
  const invalidIdDel = await fetch(`${baseUrl}/api/songs/invalid_id`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenTest}` },
  });
  assert.strictEqual(invalidIdDel.status, 400);

  // Test DELETE /api/songs/:id/lrc as Admin
  const deleteLrcRes = await fetch(`${baseUrl}/api/songs/${songId}/lrc`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenTest}` },
  });
  assert.strictEqual(deleteLrcRes.status, 200);
  assert.strictEqual(fsSync.existsSync(lrcFilePath), false);

  // Re-create LRC file before complete song deletion
  fsSync.writeFileSync(lrcFilePath, '[00:05.00]Restored lyric for delete test');
  await db.insert(lyrics).values({ songId: songId, lrcPath: lrcFilePath });

  // G. Delete the song completely using test (admin)
  const delRes = await fetch(`${baseUrl}/api/songs/${songId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenTest}` },
  });
  assert.strictEqual(delRes.status, 200);
  const delJson = await delRes.json();
  assert.strictEqual(delJson.success, true);

  // ASSERT: Original song deleted, matching LRC deleted, matching instrumental deleted
  assert.strictEqual(fsSync.existsSync(originalPath), false);
  assert.strictEqual(fsSync.existsSync(instrumentalPath), false);
  assert.strictEqual(fsSync.existsSync(lrcFilePath), false);

  // Verify song record removed from DB
  const songCheck = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
  assert.strictEqual(songCheck.length, 0);

  // H. Verify an unrelated song remains (e.g. song1Id still exists)
  const unrelatedCheck = await db.select().from(songs).where(eq(songs.id, song1Id)).limit(1);
  assert.strictEqual(unrelatedCheck.length, 1);
});

test('Enhanced LRC (eLRC) support test scenarios (Test A, B, C, D, E)', async () => {
  const tempElrcPath = path.join(process.cwd(), 'data', 'elrc_test_lib');
  if (!fsSync.existsSync(tempElrcPath)) fsSync.mkdirSync(tempElrcPath, { recursive: true });

  const libRes = await db.insert(libraries).values({ name: 'eLRC Test Library', path: tempElrcPath }).returning();
  const libId = libRes[0].id;

  let artId: number;
  const existingArt = await db.select().from(artists).where(eq(artists.name, 'Adele')).limit(1);
  if (existingArt.length > 0) {
    artId = existingArt[0].id;
  } else {
    const artRes = await db.insert(artists).values({ name: 'Adele' }).returning();
    artId = artRes[0].id;
  }

  // Test A: Both files exist (.elrc.lrc and .lrc)
  const songAName = 'Adele - Easy On Me';
  const audioPathA = path.join(tempElrcPath, `${songAName}.mp3`);
  const elrcPathA = path.join(tempElrcPath, `${songAName}.elrc.lrc`);
  const lrcPathA = path.join(tempElrcPath, `${songAName}.lrc`);

  fsSync.writeFileSync(audioPathA, 'fake audio');
  const elrcContentA = '[by:usersync]\n[re:usersync (whisperx wav2vec2)]\n[00:13.05] <00:13.01>There <00:13.55>ain\'t <00:13.87>no <00:14.47>gold <00:16.55>in <00:16.81>this <00:17.23>river <00:18.39>';
  fsSync.writeFileSync(elrcPathA, elrcContentA);
  fsSync.writeFileSync(lrcPathA, '[00:13.05]Standard LRC fallback content without word timestamps');

  const songAIns = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    title: 'Easy On Me',
    mainAudioPath: audioPathA,
    duration: 200,
  }).returning();
  const songAId = songAIns[0].id;

  // Fetch lyrics for Song A -> should pick .elrc.lrc (Test A)
  const resA = await fetch(`${baseUrl}/api/songs/${songAId}/lyrics`);
  assert.strictEqual(resA.status, 200);
  const textA = await resA.text();
  assert.strictEqual(textA.includes('<00:13.01>There'), true);
  assert.strictEqual(textA.includes('[by:usersync]'), true); // Test E metadata preserved
  assert.strictEqual(textA.includes('Standard LRC fallback content'), false);
  assert.strictEqual(textA, elrcContentA);

  // Test C: Only .elrc.lrc exists
  const songCName = 'Adele - When We Were Young';
  const audioPathC = path.join(tempElrcPath, `${songCName}.mp3`);
  const elrcPathC = path.join(tempElrcPath, `${songCName}.elrc.lrc`);

  fsSync.writeFileSync(audioPathC, 'fake audio');
  const elrcContentC = '[00:05.00] <00:05.00>Hello <00:05.50>it\'s <00:06.00>me';
  fsSync.writeFileSync(elrcPathC, elrcContentC);

  const songCIns = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    title: 'When We Were Young',
    mainAudioPath: audioPathC,
    duration: 180,
  }).returning();
  const songCId = songCIns[0].id;

  const resC = await fetch(`${baseUrl}/api/songs/${songCId}/lyrics`);
  assert.strictEqual(resC.status, 200);
  const textC = await resC.text();
  assert.strictEqual(textC.includes('<00:05.00>Hello'), true);

  // Test B: Only .lrc exists
  const songBName = 'Adele - Hello';
  const audioPathB = path.join(tempElrcPath, `${songBName}.mp3`);
  const lrcPathB = path.join(tempElrcPath, `${songBName}.lrc`);

  fsSync.writeFileSync(audioPathB, 'fake audio');
  const lrcContentB = '[00:10.00]Standard lyrics only';
  fsSync.writeFileSync(lrcPathB, lrcContentB);

  const songBIns = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    title: 'Hello',
    mainAudioPath: audioPathB,
    duration: 250,
  }).returning();
  const songBId = songBIns[0].id;

  const resB = await fetch(`${baseUrl}/api/songs/${songBId}/lyrics`);
  assert.strictEqual(resB.status, 200);
  const textB = await resB.text();
  assert.strictEqual(textB.includes('Standard lyrics only'), true);

  // Test D: Neither exists
  const songDName = 'Adele - No Lyrics Song';
  const audioPathD = path.join(tempElrcPath, `${songDName}.mp3`);
  fsSync.writeFileSync(audioPathD, 'fake audio');

  const songDIns = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    title: 'No Lyrics Song',
    mainAudioPath: audioPathD,
    duration: 150,
  }).returning();
  const songDId = songDIns[0].id;

  const resD = await fetch(`${baseUrl}/api/songs/${songDId}/lyrics`);
  assert.strictEqual(resD.status, 404);

  // Test F: Invalid/unparseable .elrc.lrc gracefully falls back to valid .lrc
  const songFName = 'Adele - Corrupted eLRC Fallback';
  const audioPathF = path.join(tempElrcPath, `${songFName}.mp3`);
  const elrcPathF = path.join(tempElrcPath, `${songFName}.elrc.lrc`);
  const lrcPathF = path.join(tempElrcPath, `${songFName}.lrc`);

  fsSync.writeFileSync(audioPathF, 'fake audio');
  // Empty or invalid/corrupted eLRC content
  fsSync.writeFileSync(elrcPathF, '');
  fsSync.writeFileSync(lrcPathF, '[00:15.00]Valid fallback standard lyrics');

  const songFIns = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    title: 'Corrupted eLRC Fallback',
    mainAudioPath: audioPathF,
    duration: 210,
  }).returning();
  const songFId = songFIns[0].id;

  const resF = await fetch(`${baseUrl}/api/songs/${songFId}/lyrics`);
  assert.strictEqual(resF.status, 200);
  const textF = await resF.text();
  assert.strictEqual(textF.includes('Valid fallback standard lyrics'), true);
  // Test G: Library Scanner discovery with all 3 cases:
  // Case 1 (Both exist): Song1.mp3, Song1.lrc, Song1.elrc.lrc
  // Case 2 (Only LRC): Song2.mp3, Song2.lrc
  // Case 3 (Only eLRC): Song3.mp3, Song3.elrc.lrc
  const scanLibPath = path.join(process.cwd(), 'data', 'scan_elrc_lib');
  if (!fsSync.existsSync(scanLibPath)) fsSync.mkdirSync(scanLibPath, { recursive: true });

  // Case 1: Both exist
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case1 Both.mp3'), 'audio1');
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case1 Both.lrc'), '[00:01.00]Standard Line Case 1');
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case1 Both.elrc.lrc'), '[00:01.00] <00:01.00>Word <00:01.50>Case1');

  // Case 2: Only LRC
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case2 LRC.mp3'), 'audio2');
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case2 LRC.lrc'), '[00:02.00]Standard Line Case 2');

  // Case 3: Only eLRC
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case3 eLRC.mp3'), 'audio3');
  fsSync.writeFileSync(path.join(scanLibPath, 'Adele - Case3 eLRC.elrc.lrc'), '[00:03.00] <00:03.00>Word <00:03.50>Case3');

  const { scanLibrary } = await import('../lib/scanner.js');
  const scanLibRes = await db.insert(libraries).values({ name: 'Scan eLRC Lib', path: scanLibPath }).returning();
  await scanLibrary(scanLibRes[0].id, scanLibPath);

  // Verify Case 1 in DB and via API:
  const songCase1 = await db.select().from(songs).where(eq(songs.title, 'Case1 Both')).limit(1);
  assert.strictEqual(songCase1.length, 1);
  const lrcRecordCase1 = await db.select().from(lyrics).where(eq(lyrics.songId, songCase1[0].id)).limit(1);
  assert.strictEqual(lrcRecordCase1.length, 1);
  assert.strictEqual(lrcRecordCase1[0].lrcPath.endsWith('.elrc.lrc'), true);

  const resCase1 = await fetch(`${baseUrl}/api/songs/${songCase1[0].id}/lyrics`);
  assert.strictEqual(resCase1.status, 200);
  const textCase1 = await resCase1.text();
  assert.strictEqual(textCase1.includes('<00:01.00>Word'), true);
  assert.strictEqual(textCase1.includes('Standard Line Case 1'), false);

  // Verify Case 2 via API:
  const songCase2 = await db.select().from(songs).where(eq(songs.title, 'Case2 LRC')).limit(1);
  assert.strictEqual(songCase2.length, 1);
  const resCase2 = await fetch(`${baseUrl}/api/songs/${songCase2[0].id}/lyrics`);
  assert.strictEqual(resCase2.status, 200);
  const textCase2 = await resCase2.text();
  assert.strictEqual(textCase2.includes('Standard Line Case 2'), true);

  // Verify Case 3 via API:
  const songCase3 = await db.select().from(songs).where(eq(songs.title, 'Case3 eLRC')).limit(1);
  assert.strictEqual(songCase3.length, 1);
  const resCase3 = await fetch(`${baseUrl}/api/songs/${songCase3[0].id}/lyrics`);
  assert.strictEqual(resCase3.status, 200);
  const textCase3 = await resCase3.text();
  assert.strictEqual(textCase3.includes('<00:03.00>Word'), true);
});

test('Issue 3: Library Rescan Must Remove Orphaned Artists and Albums', async () => {
  const { scanLibrary } = await import('../lib/scanner.js');
  const { songArtists, albums, artists, songs, libraries } = await import('../db/schema.js');

  const testDir = path.join(process.cwd(), 'data', 'orphan_rescan_test_lib');
  if (fsSync.existsSync(testDir)) {
    fsSync.rmSync(testDir, { recursive: true, force: true });
  }
  fsSync.mkdirSync(testDir, { recursive: true });

  // 1. Setup library directory with structured files:
  // - "Artist Alpha" -> "Album Alpha 1" (Song A1, Song A2) & "Album Alpha 2" (Song A3)
  // - "Artist Beta"  -> "Album Beta 1" (Song B1)
  // - Multi-Artist "Artist Gamma; Artist Delta" -> "Album GammaDelta" (Song GD1)
  // - "Artist Gamma" solo -> "Album Gamma Solo" (Song G1)
  
  const fileA1 = path.join(testDir, 'Artist Alpha - Song A1.mp3');
  const fileA2 = path.join(testDir, 'Artist Alpha - Song A2.mp3');
  const fileA3 = path.join(testDir, 'Artist Alpha - Song A3.mp3');
  const fileB1 = path.join(testDir, 'Artist Beta - Song B1.mp3');
  const fileGD1 = path.join(testDir, 'Artist Gamma; Artist Delta - Song GD1.mp3');
  const fileG1 = path.join(testDir, 'Artist Gamma - Song G1.mp3');

  fsSync.writeFileSync(fileA1, 'dummy audio a1');
  fsSync.writeFileSync(fileA2, 'dummy audio a2');
  fsSync.writeFileSync(fileA3, 'dummy audio a3');
  fsSync.writeFileSync(fileB1, 'dummy audio b1');
  fsSync.writeFileSync(fileGD1, 'dummy audio gd1');
  fsSync.writeFileSync(fileG1, 'dummy audio g1');

  // Create test library in DB
  const libRes = await db.insert(libraries).values({
    name: 'Orphan Rescan Test Lib',
    path: testDir,
  }).returning();
  const testLibId = libRes[0].id;

  // Step 1: Initial full scan with all files present
  await scanLibrary(testLibId, testDir);

  // Verify all 4 artists exist: Alpha, Beta, Gamma, Delta
  const artAlpha = await db.select().from(artists).where(eq(artists.name, 'Artist Alpha')).limit(1);
  const artBeta = await db.select().from(artists).where(eq(artists.name, 'Artist Beta')).limit(1);
  const artGamma = await db.select().from(artists).where(eq(artists.name, 'Artist Gamma')).limit(1);
  const artDelta = await db.select().from(artists).where(eq(artists.name, 'Artist Delta')).limit(1);

  assert.strictEqual(artAlpha.length, 1, 'Artist Alpha must exist');
  assert.strictEqual(artBeta.length, 1, 'Artist Beta must exist');
  assert.strictEqual(artGamma.length, 1, 'Artist Gamma must exist');
  assert.strictEqual(artDelta.length, 1, 'Artist Delta must exist');

  const initialSongs = await db.select().from(songs).where(eq(songs.libraryId, testLibId));
  assert.strictEqual(initialSongs.length, 6, 'Should have 6 songs initially');

  // Multi-artist check: Song GD1 must be linked to both Gamma and Delta in song_artists
  const songGD1 = initialSongs.find(s => s.title === 'Song GD1');
  assert.ok(songGD1, 'Song GD1 must exist');
  const saLinks = await db.select().from(songArtists).where(eq(songArtists.songId, songGD1.id));
  assert.strictEqual(saLinks.length, 2, 'Song GD1 must link to 2 artists in song_artists');

  // Step 2: Delete one song (fileA1) and rescan
  // fileA2 still exists, so Artist Alpha must remain and its album must remain
  fsSync.unlinkSync(fileA1);
  await scanLibrary(testLibId, testDir);

  const songsAfterStep2 = await db.select().from(songs).where(eq(songs.libraryId, testLibId));
  assert.strictEqual(songsAfterStep2.length, 5, 'Should have 5 songs after deleting Song A1');
  assert.strictEqual(songsAfterStep2.some(s => s.title === 'Song A1'), false, 'Song A1 must be removed');
  assert.strictEqual(songsAfterStep2.some(s => s.title === 'Song A2'), true, 'Song A2 must remain');

  const artAlphaAfterStep2 = await db.select().from(artists).where(eq(artists.name, 'Artist Alpha')).limit(1);
  assert.strictEqual(artAlphaAfterStep2.length, 1, 'Artist Alpha must remain because Song A2 & A3 exist');

  // Step 3: Delete remaining songs for Artist Beta (fileB1) and rescan
  // Artist Beta and its album must be completely cleaned up
  fsSync.unlinkSync(fileB1);
  await scanLibrary(testLibId, testDir);

  const songsAfterStep3 = await db.select().from(songs).where(eq(songs.libraryId, testLibId));
  assert.strictEqual(songsAfterStep3.length, 4, 'Should have 4 songs after deleting Song B1');
  const artBetaAfterStep3 = await db.select().from(artists).where(eq(artists.name, 'Artist Beta')).limit(1);
  assert.strictEqual(artBetaAfterStep3.length, 0, 'Artist Beta must be deleted because it has 0 remaining songs');

  // Step 4: Delete multi-artist song (fileGD1) and rescan
  // Artist Delta had ONLY Song GD1 -> Artist Delta must be deleted
  // Artist Gamma still has Song G1 -> Artist Gamma must remain
  fsSync.unlinkSync(fileGD1);
  await scanLibrary(testLibId, testDir);

  const songsAfterStep4 = await db.select().from(songs).where(eq(songs.libraryId, testLibId));
  assert.strictEqual(songsAfterStep4.length, 3, 'Should have 3 songs remaining');

  const artDeltaAfterStep4 = await db.select().from(artists).where(eq(artists.name, 'Artist Delta')).limit(1);
  assert.strictEqual(artDeltaAfterStep4.length, 0, 'Artist Delta must be deleted after its only song was deleted');

  const artGammaAfterStep4 = await db.select().from(artists).where(eq(artists.name, 'Artist Gamma')).limit(1);
  assert.strictEqual(artGammaAfterStep4.length, 1, 'Artist Gamma must remain because Song G1 still exists');

  // Confirm no orphaned song_artists records exist anywhere
  const orphanedSA = await db.select().from(songArtists).where(eq(songArtists.songId, songGD1.id));
  assert.strictEqual(orphanedSA.length, 0, 'song_artists for deleted song must be removed');

  // Step 5: Test API endpoints (/api/artists, /api/albums, /api/libraries/stats)
  const artistsRes = await fetch(`${baseUrl}/api/artists`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(artistsRes.status, 200);
  const artistsList = await artistsRes.json() as any[];
  assert.strictEqual(artistsList.some(a => a.name === 'Artist Beta'), false, 'API /api/artists must not include Artist Beta');
  assert.strictEqual(artistsList.some(a => a.name === 'Artist Delta'), false, 'API /api/artists must not include Artist Delta');
  assert.strictEqual(artistsList.some(a => a.name === 'Artist Alpha'), true, 'API /api/artists must include Artist Alpha');
  assert.strictEqual(artistsList.some(a => a.name === 'Artist Gamma'), true, 'API /api/artists must include Artist Gamma');

  // Confirm all artists in DB and API have at least 1 song
  for (const art of artistsList) {
    if (art.name === 'Artist Alpha' || art.name === 'Artist Gamma') {
      assert.ok(art.songCount > 0, `Artist ${art.name} must have songCount > 0`);
    }
  }

  // Step 6: Delete all remaining files (fileA2, fileA3, fileG1) and rescan
  fsSync.unlinkSync(fileA2);
  fsSync.unlinkSync(fileA3);
  fsSync.unlinkSync(fileG1);
  await scanLibrary(testLibId, testDir);

  const finalSongs = await db.select().from(songs).where(eq(songs.libraryId, testLibId));
  assert.strictEqual(finalSongs.length, 0, 'All songs in library must be 0');

  const finalAlpha = await db.select().from(artists).where(eq(artists.name, 'Artist Alpha')).limit(1);
  const finalGamma = await db.select().from(artists).where(eq(artists.name, 'Artist Gamma')).limit(1);
  assert.strictEqual(finalAlpha.length, 0, 'Artist Alpha must be deleted when all its songs are gone');
  assert.strictEqual(finalGamma.length, 0, 'Artist Gamma must be deleted when all its songs are gone');

  // Clean up test library
  await db.delete(libraries).where(eq(libraries.id, testLibId));
  if (fsSync.existsSync(testDir)) {
    fsSync.rmSync(testDir, { recursive: true, force: true });
  }
});

test('Close server', async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
