async function testSpotifyEmbedScraping() {
  console.log('--- Testing Spotify Embed scraping ---');
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });

  console.log('Embed response status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  // Check for __NEXT_DATA__ or initial-state
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (nextDataMatch) {
    console.log('Found __NEXT_DATA__');
    const data = JSON.parse(nextDataMatch[1]);
    console.log('Keys in data:', Object.keys(data));
    const entity = data.props?.pageProps?.state?.data?.entity;
    console.log('Entity found:', {
      name: entity?.name,
      type: entity?.type,
      trackCount: entity?.trackList?.length,
    });
    if (entity?.trackList?.[0]) {
      console.log('Sample Track from Embed:', entity.trackList[0]);
    }
  } else {
    // Check for resource script or other json tags
    const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
    console.log('Found script tags:', scriptMatches?.length);
    for (const s of scriptMatches || []) {
      if (s.includes('Spotify') || s.includes('trackList') || s.includes('items')) {
        console.log('Relevant script snippet:', s.slice(0, 300));
      }
    }
  }
}

testSpotifyEmbedScraping().catch(console.error);
