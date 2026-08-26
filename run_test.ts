import fs from 'fs';

let content = fs.readFileSync('server/tests/backend.test.ts', 'utf8');

const sharedPlaylistsTest = `
test('Shared Playlists API tests', async () => {
  // 1. User A creates a playlist
  const createRes = await fetch(\`\${baseUrl}/api/playlists\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${tokenA}\` },
    body: JSON.stringify({ name: 'Shared Playlist' })
  });
  const playlist = await createRes.json();
  const playlistId = playlist.id;

  // 2. User C cannot access it
  const getResC = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}\`, {
    headers: { Authorization: \`Bearer \${tokenC}\` }
  });
  assert.strictEqual(getResC.status, 403);

  // 3. User A shares it with User B as VIEW
  const shareRes = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}/share\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${tokenA}\` },
    body: JSON.stringify({ username: 'testuserb', permission: 'view' })
  });
  assert.strictEqual(shareRes.status, 201);

  // 4. User B can view it but cannot modify it
  const getResB = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}\`, {
    headers: { Authorization: \`Bearer \${tokenB}\` }
  });
  assert.strictEqual(getResB.status, 200);
  
  const addResB = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}/songs\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${tokenB}\` },
    body: JSON.stringify({ songId: song1Id })
  });
  assert.strictEqual(addResB.status, 403);

  // 5. User A changes B to EDIT
  const updateShareRes = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}/share\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${tokenA}\` },
    body: JSON.stringify({ username: 'testuserb', permission: 'edit' })
  });
  assert.strictEqual(updateShareRes.status, 200);

  // 6. User B can now add a track
  const addResB2 = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}/songs\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${tokenB}\` },
    body: JSON.stringify({ songId: song1Id })
  });
  assert.strictEqual(addResB2.status, 201);

  // 7. User A revokes access
  const fetchUserB = await fetch(\`\${baseUrl}/api/auth/me\`, { headers: { Authorization: \`Bearer \${tokenB}\` }});
  const userBData = await fetchUserB.json();
  
  const revokeRes = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}/share/\${userBData.user.id}\`, {
    method: 'DELETE',
    headers: { Authorization: \`Bearer \${tokenA}\` }
  });
  assert.strictEqual(revokeRes.status, 200);

  // 8. User B loses access
  const getResB_after = await fetch(\`\${baseUrl}/api/playlists/\${playlistId}\`, {
    headers: { Authorization: \`Bearer \${tokenB}\` }
  });
  assert.strictEqual(getResB_after.status, 403);
});
`;

content = content.replace("test('Karaoke Guest Queue API tests", sharedPlaylistsTest + "\ntest('Karaoke Guest Queue API tests");

fs.writeFileSync('server/tests/backend.test.ts', content);
