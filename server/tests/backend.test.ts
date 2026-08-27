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
  // 1. User A creates a public Community Playlist
  const createRes = await fetch(`${baseUrl}/api/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Cover Test Community Playlist', isPublic: true })
  });
  assert.strictEqual(createRes.status, 201);
  const playlist = await createRes.json();
  assert.strictEqual(playlist.coverImageUrl, null);

  // Valid small JPEG magic bytes (FFE8 / FFD8 / FFE0 ...)
  const sampleJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x0A, 0x00, 0x0A, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x37, 0xFF, 0xD9]);

  // 2. User B (unauthorized to edit) attempts to upload cover -> 403
  const unauthorizedUpload = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${tokenB}` },
    body: sampleJpeg
  });
  assert.strictEqual(unauthorizedUpload.status, 403);

  // 3. User A (owner) uploads cover -> 200
  const uploadRes = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${tokenA}` },
    body: sampleJpeg
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.ok(uploadData.coverImageUrl);

  // 4. User B (different user) retrieves the playlist cover image -> 200 with image bytes
  const getCoverRes = await fetch(`${baseUrl}${uploadData.coverImageUrl}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(getCoverRes.status, 200);
  assert.strictEqual(getCoverRes.headers.get('content-type'), 'image/jpeg');
  const bufferResult = Buffer.from(await getCoverRes.arrayBuffer());
  assert.strictEqual(bufferResult.length, sampleJpeg.length);

  // 5. User A deletes the cover -> 200
  const deleteCoverRes = await fetch(`${baseUrl}/api/playlists/${playlist.id}/cover`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(deleteCoverRes.status, 200);
  const deletedData = await deleteCoverRes.json();
  assert.strictEqual(deletedData.coverImageUrl, null);
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

test('Close server', async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
