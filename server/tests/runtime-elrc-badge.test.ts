import { test } from 'node:test';
import assert from 'node:assert';
import fsSync from 'fs';
import path from 'path';
import { db, setupDatabase } from '../db/index.js';
import { songs, artists, albums, libraries, lyrics, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import LyricBadges from '../../src/components/LyricBadges.js';

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';
const baseUrl = 'http://localhost:3000';

test('Runtime ELRC and LRC badge verification (API and UI states)', async (t) => {
  await setupDatabase();
  // 1. Create a test directory with audio and lyric files
  const testDir = path.join(process.cwd(), 'data', 'badge_runtime_test');
  if (!fsSync.existsSync(testDir)) {
    fsSync.mkdirSync(testDir, { recursive: true });
  }

  const runSuffix = Date.now();
  // Create library
  const libRes = await db.insert(libraries).values({
    name: `Badge Runtime Library ${runSuffix}`,
    path: testDir,
  }).returning();
  const libId = libRes[0].id;

  // Create artist & album
  const artRes = await db.insert(artists).values({ name: `Badge Artist ${runSuffix}` }).returning();
  const artId = artRes[0].id;

  const albRes = await db.insert(albums).values({ title: `Badge Album ${runSuffix}`, artistId: artId }).returning();
  const albId = albRes[0].id;

  // Song 1: No files (both missing)
  const s1Audio = path.join(testDir, 'Song 1 No Files.mp3');
  fsSync.writeFileSync(s1Audio, 'audio content 1');
  const s1Res = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Song 1 No Files',
    mainAudioPath: s1Audio,
    duration: 120,
  }).returning();
  const s1Id = s1Res[0].id;

  // Song 2: LRC only
  const s2Audio = path.join(testDir, 'Song 2 LRC Only.mp3');
  const s2Lrc = path.join(testDir, 'Song 2 LRC Only.lrc');
  fsSync.writeFileSync(s2Audio, 'audio content 2');
  fsSync.writeFileSync(s2Lrc, '[00:01.00] standard lrc only');
  const s2Res = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Song 2 LRC Only',
    mainAudioPath: s2Audio,
    duration: 130,
  }).returning();
  const s2Id = s2Res[0].id;

  // Song 3: ELRC only
  const s3Audio = path.join(testDir, 'Song 3 ELRC Only.mp3');
  const s3Elrc = path.join(testDir, 'Song 3 ELRC Only.elrc.lrc');
  fsSync.writeFileSync(s3Audio, 'audio content 3');
  fsSync.writeFileSync(s3Elrc, '[00:01.00] <00:01.00>word <00:01.50>sync');
  const s3Res = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Song 3 ELRC Only',
    mainAudioPath: s3Audio,
    duration: 140,
  }).returning();
  const s3Id = s3Res[0].id;

  // Song 4: Both LRC and ELRC
  const s4Audio = path.join(testDir, 'Song 4 Both Files.mp3');
  const s4Lrc = path.join(testDir, 'Song 4 Both Files.lrc');
  const s4Elrc = path.join(testDir, 'Song 4 Both Files.elrc.lrc');
  fsSync.writeFileSync(s4Audio, 'audio content 4');
  fsSync.writeFileSync(s4Lrc, '[00:01.00] regular lrc');
  fsSync.writeFileSync(s4Elrc, '[00:01.00] <00:01.00>both <00:01.50>files');
  const s4Res = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Song 4 Both Files',
    mainAudioPath: s4Audio,
    duration: 150,
  }).returning();
  const s4Id = s4Res[0].id;

  let testUserId: number;
  const existingUser = await db.select().from(users).limit(1);
  if (existingUser.length > 0) {
    testUserId = existingUser[0].id;
  } else {
    const newUser = await db.insert(users).values({
      username: `badge_admin_${runSuffix}`,
      password: 'hashed_password',
      role: 'administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    testUserId = newUser[0].id;
  }

  // Generate valid test JWT auth cookie and header
  const token = jwt.sign({ id: testUserId, username: 'badge_test_admin', role: 'administrator' }, JWT_SECRET);
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Cookie': `yimly_token=${token}`
  };

  // 2. Verify API responses for all 4 states
  const songsRes = await fetch(`${baseUrl}/api/songs`, { headers: authHeaders });
  assert.strictEqual(songsRes.status, 200);
  const songList = await songsRes.json();

  const song1 = songList.find((s: any) => s.id === s1Id);
  const song2 = songList.find((s: any) => s.id === s2Id);
  const song3 = songList.find((s: any) => s.id === s3Id);
  const song4 = songList.find((s: any) => s.id === s4Id);

  assert.ok(song1, 'Song 1 should be found');
  assert.ok(song2, 'Song 2 should be found');
  assert.ok(song3, 'Song 3 should be found');
  assert.ok(song4, 'Song 4 should be found');

  // Verify State 1: No files -> both false
  assert.strictEqual(song1.hasLrc, false, 'Song 1 hasLrc must be false');
  assert.strictEqual(song1.hasElrc, false, 'Song 1 hasElrc must be false');

  // Verify State 2: LRC only -> hasLrc true, hasElrc false
  assert.strictEqual(song2.hasLrc, true, 'Song 2 hasLrc must be true');
  assert.strictEqual(song2.hasElrc, false, 'Song 2 hasElrc must be false');

  // Verify State 3: ELRC only -> hasLrc false, hasElrc true
  assert.strictEqual(song3.hasLrc, false, 'Song 3 hasLrc must be false');
  assert.strictEqual(song3.hasElrc, true, 'Song 3 hasElrc must be true');

  // Verify State 4: Both -> hasLrc true, hasElrc true
  assert.strictEqual(song4.hasLrc, true, 'Song 4 hasLrc must be true');
  assert.strictEqual(song4.hasElrc, true, 'Song 4 hasElrc must be true');

  // 3. Verify Album endpoint provides accurate hasLrc and hasElrc
  const albFetch = await fetch(`${baseUrl}/api/albums/${albId}`, { headers: authHeaders });
  assert.strictEqual(albFetch.status, 200);
  const albData = await albFetch.json();
  const albS1 = albData.songs.find((s: any) => s.id === s1Id);
  const albS2 = albData.songs.find((s: any) => s.id === s2Id);
  const albS3 = albData.songs.find((s: any) => s.id === s3Id);
  const albS4 = albData.songs.find((s: any) => s.id === s4Id);

  assert.strictEqual(albS1.hasLrc, false);
  assert.strictEqual(albS1.hasElrc, false);
  assert.strictEqual(albS2.hasLrc, true);
  assert.strictEqual(albS2.hasElrc, false);
  assert.strictEqual(albS3.hasLrc, false);
  assert.strictEqual(albS3.hasElrc, true);
  assert.strictEqual(albS4.hasLrc, true);
  assert.strictEqual(albS4.hasElrc, true);

  // 4. Verify Individual song endpoint GET /api/songs/:id
  const s3Fetch = await fetch(`${baseUrl}/api/songs/${s3Id}`, { headers: authHeaders });
  assert.strictEqual(s3Fetch.status, 200);
  const s3Data = await s3Fetch.json();
  assert.strictEqual(s3Data.hasLrc, false);
  assert.strictEqual(s3Data.hasElrc, true);

  // 5. Test UI Rendering of LyricBadges for all 4 states
  function renderBadgeHtml(hasLrc: boolean, hasElrc: boolean, songId?: number) {
    const html = renderToString(
      React.createElement(LyricBadges, { hasLrc, hasElrc, songId })
    );
    const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
    return dom.window.document;
  }

  // UI State 1: No files -> both grey
  {
    const doc = renderBadgeHtml(false, false, 1);
    const lrcBtn = doc.querySelector('[data-format="lrc"]');
    const elrcBtn = doc.querySelector('[data-format="elrc"]');
    assert.ok(lrcBtn, 'LRC button exists');
    assert.ok(elrcBtn, 'ELRC button exists');

    assert.strictEqual(lrcBtn.getAttribute('data-active'), 'false');
    assert.strictEqual(elrcBtn.getAttribute('data-active'), 'false');

    // Both should have grey text-zinc-500 class, neither should have pink or blue active classes
    assert.ok(lrcBtn.className.includes('text-zinc-500'), 'LRC is grey when missing');
    assert.ok(!lrcBtn.className.includes('text-[#FF4FA3]'), 'LRC not pink when missing');
    assert.ok(elrcBtn.className.includes('text-zinc-500'), 'ELRC is grey when missing');
    assert.ok(!elrcBtn.className.includes('text-[#3B82F6]'), 'ELRC not blue when missing');
  }

  // UI State 2: LRC only -> LRC active pink, ELRC grey
  {
    const doc = renderBadgeHtml(true, false, 2);
    const lrcBtn = doc.querySelector('[data-format="lrc"]');
    const elrcBtn = doc.querySelector('[data-format="elrc"]');

    assert.strictEqual(lrcBtn.getAttribute('data-active'), 'true');
    assert.strictEqual(elrcBtn.getAttribute('data-active'), 'false');

    assert.ok(lrcBtn.className.includes('text-[#FF4FA3]'), 'LRC active has existing pink color');
    assert.ok(lrcBtn.className.includes('bg-[#FF4FA3]/15'), 'LRC active has pink background');
    assert.ok(elrcBtn.className.includes('text-zinc-500'), 'ELRC is grey when missing');
    assert.ok(!elrcBtn.className.includes('text-[#3B82F6]'), 'ELRC not blue when missing');
  }

  // UI State 3: ELRC only -> LRC grey, ELRC active BLUE
  {
    const doc = renderBadgeHtml(false, true, 3);
    const lrcBtn = doc.querySelector('[data-format="lrc"]');
    const elrcBtn = doc.querySelector('[data-format="elrc"]');

    assert.strictEqual(lrcBtn.getAttribute('data-active'), 'false');
    assert.strictEqual(elrcBtn.getAttribute('data-active'), 'true');

    assert.ok(lrcBtn.className.includes('text-zinc-500'), 'LRC is grey when missing');
    assert.ok(!lrcBtn.className.includes('text-[#FF4FA3]'), 'LRC not pink when missing');
    assert.ok(elrcBtn.className.includes('text-[#3B82F6]'), 'ELRC active is BLUE');
    assert.ok(elrcBtn.className.includes('bg-[#3B82F6]/20'), 'ELRC active has blue highlight');
    assert.ok(elrcBtn.className.includes('border-[#3B82F6]/40'), 'ELRC active has blue border');
  }

  // UI State 4: Both -> LRC active pink, ELRC active BLUE
  {
    const doc = renderBadgeHtml(true, true, 4);
    const lrcBtn = doc.querySelector('[data-format="lrc"]');
    const elrcBtn = doc.querySelector('[data-format="elrc"]');

    assert.strictEqual(lrcBtn.getAttribute('data-active'), 'true');
    assert.strictEqual(elrcBtn.getAttribute('data-active'), 'true');

    assert.ok(lrcBtn.className.includes('text-[#FF4FA3]'), 'LRC active has existing pink color');
    assert.ok(elrcBtn.className.includes('text-[#3B82F6]'), 'ELRC active is BLUE');
  }

  // 6. Test Click Interaction in all states: both remain clickable
  {
    const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`);
    let clickedFormat: string | null = null;
    const element = React.createElement(LyricBadges, {
      hasLrc: false,
      hasElrc: true,
      songId: 10,
      onOpenLyrics: (fmt) => { clickedFormat = fmt; }
    });

    // Render into JSDOM and click
    const html = renderToString(element);
    dom.window.document.getElementById('root')!.innerHTML = html;

    const lrcButton = dom.window.document.querySelector('[data-format="lrc"]') as HTMLButtonElement;
    const elrcButton = dom.window.document.querySelector('[data-format="elrc"]') as HTMLButtonElement;

    assert.ok(lrcButton, 'LRC button element exists in DOM');
    assert.ok(elrcButton, 'ELRC button element exists in DOM');
    assert.strictEqual(lrcButton.tagName, 'BUTTON');
    assert.strictEqual(elrcButton.tagName, 'BUTTON');
    assert.ok(lrcButton.className.includes('cursor-pointer'), 'LRC is clickable');
    assert.ok(elrcButton.className.includes('cursor-pointer'), 'ELRC is clickable');
  }

  // Cleanup test files and records
  try {
    fsSync.rmSync(testDir, { recursive: true, force: true });
    await db.delete(songs).where(eq(songs.libraryId, libId));
    await db.delete(albums).where(eq(albums.id, albId));
    await db.delete(artists).where(eq(artists.id, artId));
    await db.delete(libraries).where(eq(libraries.id, libId));
  } catch (err) {}
});
