import { useState, useEffect } from 'react';
import { Search, Play, Plus, Music, Disc, Mic, RefreshCw, Calendar, FileText, ChevronRight, ArrowLeft, AlertCircle, Check } from 'lucide-react';

export default function Library() {
  const [tab, setTab] = useState<'artists' | 'albums' | 'songs'>('artists');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ artists: 0, albums: 0, songs: 0 });
  
  const [artists, setArtists] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [songs, setSongs] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Detailed view states
  const [selectedArtist, setSelectedArtist] = useState<any | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);

  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queuedSongId, setQueuedSongId] = useState<number | null>(null);

  useEffect(() => {
    loadAllData();
  }, [tab]);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch stats
      const statsRes = await fetch('/api/libraries/stats');
      if (!statsRes.ok) {
        throw new Error(`Failed to fetch stats (status ${statsRes.status})`);
      }
      const statsData = await statsRes.json();
      setStats(statsData);

      // 2. Fetch tab data
      const endpoint = tab === 'artists' ? '/api/artists' : tab === 'albums' ? '/api/albums' : '/api/songs';
      const dataRes = await fetch(endpoint);
      if (!dataRes.ok) {
        throw new Error(`Failed to fetch ${tab} (status ${dataRes.status})`);
      }
      const data = await dataRes.json();

      if (tab === 'artists') setArtists(Array.isArray(data) ? data : []);
      else if (tab === 'albums') setAlbums(Array.isArray(data) ? data : []);
      else if (tab === 'songs') setSongs(Array.isArray(data) ? data : []);

      setLoading(false);
    } catch (err: any) {
      console.error('Library loading error:', err);
      setError(err.message || 'Failed to load library data');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (search.trim()) {
      fetch(`/api/search?q=${encodeURIComponent(search)}`)
        .then(res => res.json())
        .then(data => setSearchResults(Array.isArray(data) ? data : []))
        .catch(err => console.error('Search failed:', err));
    } else {
      setSearchResults([]);
    }
  }, [search]);

  const triggerScan = async () => {
    try {
      setScanning(true);
      const libsRes = await fetch('/api/libraries');
      if (!libsRes.ok) throw new Error('Failed to fetch libraries');
      const libs = await libsRes.json();
      if (libs.length === 0) {
        alert('No libraries configured. Please add a library in Settings first.');
        setScanning(false);
        return;
      }
      for (const lib of libs) {
        const scanRes = await fetch(`/api/libraries/${lib.id}/scan`, { method: 'POST' });
        if (!scanRes.ok) {
          throw new Error(`Scan failed for library ${lib.id}`);
        }
      }
      setTimeout(() => {
        loadAllData();
        setScanning(false);
      }, 2000);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Library scan failed');
      setScanning(false);
    }
  };

  const openArtist = async (artistId: number) => {
    try {
      const res = await fetch(`/api/artists/${artistId}`);
      if (!res.ok) throw new Error('Failed to fetch artist details');
      const data = await res.json();
      setSelectedArtist(data);
      setSelectedAlbum(null);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Could not load artist details');
    }
  };

  const openAlbum = async (albumId: number) => {
    try {
      const res = await fetch(`/api/albums/${albumId}`);
      if (!res.ok) throw new Error('Failed to fetch album details');
      const data = await res.json();
      setSelectedAlbum(data);
      setSelectedArtist(null);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Could not load album details');
    }
  };

  const addToQueue = async (songId: number) => {
    try {
      const activeRoomsRes = await fetch('/api/karaoke/active-sessions');
      const rooms = await activeRoomsRes.json();
      if (rooms.length === 0) {
        alert("No active karaoke rooms found. Please host or join a room first from Karaoke Rooms.");
        return;
      }
      const sessionId = rooms[0].id;
      
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId })
      });
      if (res.ok) {
        setQueuedSongId(songId);
        setTimeout(() => setQueuedSongId(null), 2000);
      } else {
        alert('Failed to add to room queue');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add song to queue');
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // -----------------------------------------------------------------
  // VIEW: Selected Artist Drill-down
  // -----------------------------------------------------------------
  if (selectedArtist) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
        <button 
          onClick={() => setSelectedArtist(null)}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </button>

        {/* Artist Hero */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 bg-[#141622] p-8 rounded-3xl border border-white/5 shadow-xl">
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center shrink-0 border border-white/10 shadow-lg shadow-[#FF4FA3]/10 overflow-hidden">
            {selectedArtist.hasArtwork ? (
              <img
                src={`/api/artists/${selectedArtist.id}/artwork`}
                alt={selectedArtist.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Mic className="w-12 h-12 text-[#FF4FA3]" />
            )}
          </div>
          <div className="text-center sm:text-left">
            <span className="text-xs uppercase tracking-widest text-[#FF4FA3] font-bold">Artist</span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-1 mb-2">{selectedArtist.name}</h1>
            <p className="text-sm text-zinc-400 font-medium">
              {selectedArtist.albums?.length || 0} Albums • {selectedArtist.songs?.length || 0} Songs
            </p>
          </div>
        </div>

        {/* Albums by Artist */}
        {selectedArtist.albums?.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight">Discography & Albums</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {selectedArtist.albums.map((album: any) => (
                <div 
                  key={album.id}
                  onClick={() => openAlbum(album.id)}
                  className="bg-[#141622] hover:bg-[#1A1C2C] p-4 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group"
                >
                  <div className="w-full aspect-square bg-[#1C1E2D] rounded-xl mb-3 flex items-center justify-center relative overflow-hidden group-hover:border-[#FF4FA3]/20 border border-white/5">
                    {album.hasArtwork ? (
                      <img
                        src={`/api/albums/${album.id}/artwork`}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-10 h-10 text-zinc-600 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#FF4FA3] transition-colors">{album.title}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">{album.year || 'Album'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Songs by Artist */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white tracking-tight">Songs</h2>
          <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Title</th>
                  <th className="px-5 py-3.5">Duration</th>
                  <th className="px-5 py-3.5">Variant</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {selectedArtist.songs?.map((song: any) => {
                  const isQueued = queuedSongId === song.id;
                  return (
                    <tr key={song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                      <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                          {song.hasArtwork ? (
                            <img
                              src={`/api/songs/${song.id}/artwork`}
                              alt={song.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Music className="w-4 h-4 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                          )}
                        </div>
                        <span className="truncate">{song.title}</span>
                        {song.hasLrc && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25 shrink-0">
                            LRC
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-zinc-400 text-xs font-mono">{formatDuration(song.duration)}</td>
                      <td className="px-5 py-3.5 text-zinc-400 text-xs capitalize">{song.variant}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button 
                          onClick={() => addToQueue(song.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                            isQueued 
                              ? 'bg-[#FF4FA3] text-white' 
                              : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                          }`}
                        >
                          {isQueued ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          <span>{isQueued ? 'Added' : 'Queue'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // VIEW: Selected Album Drill-down
  // -----------------------------------------------------------------
  if (selectedAlbum) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
        <button 
          onClick={() => setSelectedAlbum(null)}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </button>

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 bg-[#141622] p-8 rounded-3xl border border-white/5 shadow-xl">
          <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center shrink-0 border border-white/10 shadow-lg shadow-[#FF4FA3]/10 overflow-hidden">
            {selectedAlbum.hasArtwork ? (
              <img
                src={`/api/albums/${selectedAlbum.id}/artwork`}
                alt={selectedAlbum.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Disc className="w-16 h-16 text-[#FF4FA3]" />
            )}
          </div>
          <div className="text-center sm:text-left">
            <span className="text-xs uppercase tracking-widest text-[#FF4FA3] font-bold">Album</span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-1 mb-1">{selectedAlbum.title}</h1>
            <p className="text-zinc-300 font-medium text-base mb-1">{selectedAlbum.artist}</p>
            <p className="text-xs text-zinc-400">
              {selectedAlbum.year || 'Unknown Year'} • {selectedAlbum.songs?.length || 0} Tracks
            </p>
          </div>
        </div>

        <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5 w-16">#</th>
                <th className="px-5 py-3.5">Title</th>
                <th className="px-5 py-3.5">Duration</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {selectedAlbum.songs?.map((song: any, idx: number) => {
                const isQueued = queuedSongId === song.id;
                return (
                  <tr key={song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                    <td className="px-5 py-3.5 text-zinc-500 font-mono text-xs">{song.trackNumber || idx + 1}</td>
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                      <span>{song.title}</span>
                      {song.hasLrc && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
                          LRC
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 font-mono text-xs">{formatDuration(song.duration)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button 
                        onClick={() => addToQueue(song.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                          isQueued 
                            ? 'bg-[#FF4FA3] text-white' 
                            : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                        }`}
                      >
                        {isQueued ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        <span>{isQueued ? 'Added' : 'Queue'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // MAIN VIEW: Library Catalogs & Search
  // -----------------------------------------------------------------
  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Karaoke Media Library</h1>
          <p className="text-sm text-zinc-400 mt-1">
            <span className="text-[#FF4FA3] font-semibold">{stats.artists}</span> Artists • <span className="text-[#FF4FA3] font-semibold">{stats.albums}</span> Albums • <span className="text-[#FF4FA3] font-semibold">{stats.songs}</span> Songs
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search artists, albums, or songs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#141622] border border-white/10 rounded-full text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all"
            />
          </div>
          <button 
            onClick={triggerScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-white rounded-full text-xs font-semibold border border-white/10 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin text-[#FF4FA3]' : ''}`} />
            <span>{scanning ? 'Scanning...' : 'Scan Media'}</span>
          </button>
        </div>
      </div>

      {/* Error state alert banner */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-2xl flex items-center justify-between gap-4 text-red-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="font-semibold text-red-200 text-sm">Failed to load library data</p>
              <p className="text-xs text-red-300/80">{error}</p>
            </div>
          </div>
          <button 
            onClick={loadAllData}
            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 text-[#FF4FA3] animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading media catalog...</p>
        </div>
      )}

      {/* Search results view if searching */}
      {search.trim() && !loading && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Search Results for "{search}"</h2>
          <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Type</th>
                  <th className="px-5 py-3.5">Name / Title</th>
                  <th className="px-5 py-3.5">Details</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {searchResults.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-[#1A1C2C]/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
                        {item.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                        {item.hasArtwork ? (
                          <img
                            src={
                              item.type === 'artist'
                                ? `/api/artists/${item.id}/artwork`
                                : item.type === 'album'
                                ? `/api/albums/${item.id}/artwork`
                                : `/api/songs/${item.id}/artwork`
                            }
                            alt={item.title || item.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : item.type === 'artist' ? (
                          <Mic className="w-4 h-4 text-zinc-400" />
                        ) : item.type === 'album' ? (
                          <Disc className="w-4 h-4 text-zinc-400" />
                        ) : (
                          <Music className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>
                      <span className="truncate">{item.title || item.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 text-xs">{item.artist || item.album || '—'}</td>
                    <td className="px-5 py-3.5 text-right">
                      {item.type === 'artist' && (
                        <button onClick={() => openArtist(item.id)} className="px-3 py-1.5 bg-white/5 hover:bg-white/15 text-white rounded-lg text-xs font-medium">View</button>
                      )}
                      {item.type === 'album' && (
                        <button onClick={() => openAlbum(item.id)} className="px-3 py-1.5 bg-white/5 hover:bg-white/15 text-white rounded-lg text-xs font-medium">View</button>
                      )}
                      {item.type === 'song' && (
                        <button onClick={() => addToQueue(item.id)} className="px-3 py-1.5 bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white rounded-lg text-xs font-medium">Queue</button>
                      )}
                    </td>
                  </tr>
                ))}
                {searchResults.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-zinc-500 text-sm">No matching items found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-8">
        <button 
          onClick={() => setTab('artists')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all ${tab === 'artists' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Artists ({stats.artists})
        </button>
        <button 
          onClick={() => setTab('albums')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all ${tab === 'albums' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Albums ({stats.albums})
        </button>
        <button 
          onClick={() => setTab('songs')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all ${tab === 'songs' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Songs ({stats.songs})
        </button>
      </div>

      {!loading && !error && (
        <>
          {/* Artists Grid */}
          {tab === 'artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {artists.map(artist => (
                <div 
                  key={artist.id}
                  onClick={() => openArtist(artist.id)}
                  className="bg-[#141622] hover:bg-[#1A1C2C] p-5 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group flex flex-col items-center text-center shadow-lg"
                >
                  <div className="w-24 h-24 rounded-full bg-[#1C1E2D] flex items-center justify-center mb-4 border border-white/10 group-hover:border-[#FF4FA3]/40 transition-colors shadow-inner overflow-hidden">
                    {artist.hasArtwork ? (
                      <img
                        src={`/api/artists/${artist.id}/artwork`}
                        alt={artist.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Mic className="w-10 h-10 text-zinc-500 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate w-full group-hover:text-[#FF4FA3] transition-colors">{artist.name}</h3>
                  <p className="text-xs text-zinc-400 mt-1">{artist.songCount || 0} Songs • {artist.albumCount || 0} Albums</p>
                </div>
              ))}
              {artists.length === 0 && (
                <div className="col-span-full py-16 text-center text-zinc-500">
                  No artists found. Run a library scan or configure a directory in Settings.
                </div>
              )}
            </div>
          )}

          {/* Albums Grid */}
          {tab === 'albums' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {albums.map(album => (
                <div 
                  key={album.id}
                  onClick={() => openAlbum(album.id)}
                  className="bg-[#141622] hover:bg-[#1A1C2C] p-4 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group shadow-lg"
                >
                  <div className="w-full aspect-square bg-[#1C1E2D] rounded-xl mb-3 flex items-center justify-center border border-white/5 group-hover:border-[#FF4FA3]/40 transition-colors shadow-inner overflow-hidden">
                    {album.hasArtwork ? (
                      <img
                        src={`/api/albums/${album.id}/artwork`}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-12 h-12 text-zinc-500 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#FF4FA3] transition-colors">{album.title}</h3>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{album.artist || 'Unknown Artist'}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">{album.year || 'Album'} • {album.songCount || 0} Tracks</p>
                </div>
              ))}
              {albums.length === 0 && (
                <div className="col-span-full py-16 text-center text-zinc-500">
                  No albums found in media library.
                </div>
              )}
            </div>
          )}

          {/* Songs Table */}
          {tab === 'songs' && (
            <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Title</th>
                    <th className="px-5 py-3.5">Artist</th>
                    <th className="px-5 py-3.5">Album</th>
                    <th className="px-5 py-3.5">Duration</th>
                    <th className="px-5 py-3.5">Variant</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {songs.map(song => {
                    const isQueued = queuedSongId === song.id;
                    return (
                      <tr key={song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                        <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                            {song.hasArtwork ? (
                              <img
                                src={`/api/songs/${song.id}/artwork`}
                                alt={song.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <Music className="w-4 h-4 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                            )}
                          </div>
                          <span className="truncate" title={song.title}>{song.title}</span>
                          {song.hasLrc && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25 shrink-0">
                              LRC
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-300 text-xs truncate max-w-xs" title={song.artist}>{song.artist || 'Unknown Artist'}</td>
                        <td className="px-5 py-3.5 text-zinc-400 text-xs truncate max-w-xs" title={song.album}>{song.album || '—'}</td>
                        <td className="px-5 py-3.5 text-zinc-400 text-xs font-mono">{formatDuration(song.duration)}</td>
                        <td className="px-5 py-3.5 text-zinc-400 text-xs capitalize">{song.variant}</td>
                        <td className="px-5 py-3.5 text-right">
                          <button 
                            onClick={() => addToQueue(song.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                              isQueued 
                                ? 'bg-[#FF4FA3] text-white' 
                                : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                            }`}
                            title="Add song to live room queue"
                          >
                            {isQueued ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                            <span>{isQueued ? 'Added' : 'Queue'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {songs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-zinc-500">
                        No songs found in library.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
