async function testSpotifyDirectAPI() {
  console.log('--- Testing Spotify Anonymous Web API ---');
  
  // 1. Fetch anonymous client token from open.spotify.com
  const tokenRes = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });

  console.log('Token response status:', tokenRes.status);
  const tokenData = await tokenRes.json();
  console.log('Token data received:', {
    hasToken: !!tokenData.accessToken,
    isAnonymous: tokenData.isAnonymous,
    clientId: tokenData.clientId
  });

  const accessToken = tokenData.accessToken;

  // 2. Fetch Playlist: Today's Top Hits (37i9dQZF1DXcBWIGoYBM5M)
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });

  console.log('Playlist metadata response status:', playlistRes.status);
  const playlistData = await playlistRes.json();
  console.log('Playlist name:', playlistData.name);
  console.log('Total tracks:', playlistData.tracks?.total);
  console.log('Items in first page:', playlistData.tracks?.items?.length);
  if (playlistData.tracks?.items?.[0]) {
    const item = playlistData.tracks.items[0];
    const t = item.track || item;
    console.log('Sample Track 1:', {
      title: t.name,
      artists: t.artists?.map((a: any) => a.name).join(', '),
      album: t.album?.name,
      duration_ms: t.duration_ms,
      id: t.id,
      isrc: t.external_ids?.isrc,
    });
  }

  // 3. Test pagination if > 50 tracks
  if (playlistData.tracks?.total > 50) {
    const page2Res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=50&limit=50`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    });
    const page2Data = await page2Res.json();
    console.log('Page 2 items count:', page2Data.items?.length);
  }
}

testSpotifyDirectAPI().catch(console.error);
