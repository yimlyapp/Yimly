import { useState, useEffect } from 'react';
import { Search, Play, Plus, Music, Disc, Mic, RefreshCw, Calendar, FileText, ChevronRight, ArrowLeft, AlertCircle } from 'lucide-react';

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
  const [failedEndpoint, setFailedEndpoint] = useState<string | null>(null);

  useEffect(() => {
    loadAllData();
  }, [tab]);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    setFailedEndpoint(null);

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

      if (tab === 'artists') setArtists(data);
      else if (tab === 'albums') setAlbums(data);
      else if (tab === 'songs') setSongs(data);

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
        .then(setSearchResults)
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
      alert('Library scan triggered successfully. Refreshing in a few moments...');
      setTimeout(() => {
        loadAllData();
        setScanning(false);
      }, 2500);
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
        alert("No active karaoke rooms found. Please join or create a room first.");
        return;
      }
      const sessionId = rooms[0].id;
      
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId })
      });
      if (res.ok) alert('Added song to queue!');
      else alert('Failed to add to queue');
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

  // If viewing Artist Detail
  if (selectedArtist) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <button 
          onClick={() => setSelectedArtist(null)}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </button>

        <div className="flex items-center gap-6 mb-8 bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
          <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700">
            <Mic className="w-12 h-12 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{selectedArtist.name}</h1>
            <p className="text-sm text-zinc-400">
              {selectedArtist.albums?.length || 0} Albums • {selectedArtist.songs?.length || 0} Songs
            </p>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white mb-4">Albums</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {selectedArtist.albums?.map((album: any) => (
            <div 
              key={album.id}
              onClick={() => openAlbum(album.id)}
              className="bg-zinc-900/60 hover:bg-zinc-800 p-4 rounded-xl border border-zinc-800 cursor-pointer transition-all group"
            >
              <div className="w-full aspect-square bg-zinc-800 rounded-lg mb-3 flex items-center justify-center">
                <Disc className="w-10 h-10 text-zinc-500 group-hover:text-emerald-500 transition-colors" />
              </div>
              <h3 className="font-medium text-white truncate">{album.title}</h3>
              <p className="text-xs text-zinc-400">{album.year || 'Unknown Year'}</p>
            </div>
          ))}
        </div>

        <h2 className="text-xl font-semibold text-white mb-4">Songs</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Variant</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {selectedArtist.songs?.map((song: any) => (
                <tr key={song.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/50 group">
                  <td className="px-4 py-3 font-medium text-white flex items-center gap-3">
                    <Music className="w-4 h-4 text-zinc-500" />
                    <span>{song.title}</span>
                    {song.hasLrc && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        LRC
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{formatDuration(song.duration)}</td>
                  <td className="px-4 py-3 text-zinc-400 capitalize">{song.variant}</td>
                  <td className="px-4 py-3 text-right">
                    <button 
                      onClick={() => addToQueue(song.id)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs inline-flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add to Queue
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // If viewing Album Detail
  if (selectedAlbum) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <button 
          onClick={() => setSelectedAlbum(null)}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </button>

        <div className="flex items-center gap-6 mb-8 bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
          <div className="w-24 h-24 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700">
            <Disc className="w-12 h-12 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">{selectedAlbum.title}</h1>
            <p className="text-zinc-300 font-medium mb-1">{selectedAlbum.artist}</p>
            <p className="text-xs text-zinc-400">
              {selectedAlbum.year || 'Unknown Year'} • {selectedAlbum.songs?.length || 0} Tracks
            </p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium w-16">#</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {selectedAlbum.songs?.map((song: any, idx: number) => (
                <tr key={song.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/50 group">
                  <td className="px-4 py-3 text-zinc-500">{song.trackNumber || idx + 1}</td>
                  <td className="px-4 py-3 font-medium text-white flex items-center gap-3">
                    <span>{song.title}</span>
                    {song.hasLrc && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        LRC
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{formatDuration(song.duration)}</td>
                  <td className="px-4 py-3 text-right">
                    <button 
                      onClick={() => addToQueue(song.id)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs inline-flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add to Queue
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header & Stats */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Karaoke Media Library</h1>
          <p className="text-sm text-zinc-400">
            <span className="text-emerald-400 font-semibold">{stats.artists}</span> Artists • <span className="text-emerald-400 font-semibold">{stats.albums}</span> Albums • <span className="text-emerald-400 font-semibold">{stats.songs}</span> Songs
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search artists, albums, or songs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button 
            onClick={triggerScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Library'}
          </button>
        </div>
      </div>

      {/* Error state alert banner */}
      {error && (
        <div className="mb-8 p-4 bg-red-950/40 border border-red-500/30 rounded-xl flex items-center justify-between gap-4 text-red-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="font-semibold text-red-200">Failed to load library data</p>
              <p className="text-xs text-red-300/80">{error}</p>
            </div>
          </div>
          <button 
            onClick={loadAllData}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
          <p className="text-zinc-400 text-sm">Loading media library...</p>
        </div>
      )}

      {/* Search results view if searching */}
      {search.trim() && !loading && (
        <div className="mb-12">
          <h2 className="text-lg font-semibold text-white mb-4">Search Results for "{search}"</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Name / Title</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b border-zinc-800/40 hover:bg-zinc-800/50">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        item.type === 'artist' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                        item.type === 'album' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{item.title || item.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{item.artist || item.album || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {item.type === 'artist' && (
                        <button onClick={() => openArtist(item.id)} className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs">View</button>
                      )}
                      {item.type === 'album' && (
                        <button onClick={() => openAlbum(item.id)} className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs">View</button>
                      )}
                      {item.type === 'song' && (
                        <button onClick={() => addToQueue(item.id)} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs">Add to Queue</button>
                      )}
                    </td>
                  </tr>
                ))}
                {searchResults.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No matching items found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 mb-6 gap-8">
        <button 
          onClick={() => setTab('artists')}
          className={`pb-3 font-medium text-sm border-b-2 transition-colors ${tab === 'artists' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Artists ({stats.artists})
        </button>
        <button 
          onClick={() => setTab('albums')}
          className={`pb-3 font-medium text-sm border-b-2 transition-colors ${tab === 'albums' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Albums ({stats.albums})
        </button>
        <button 
          onClick={() => setTab('songs')}
          className={`pb-3 font-medium text-sm border-b-2 transition-colors ${tab === 'songs' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Songs ({stats.songs})
        </button>
      </div>

      {!loading && !error && (
        <>
          {/* Tab Content: Artists */}
          {tab === 'artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {artists.map(artist => (
                <div 
                  key={artist.id}
                  onClick={() => openArtist(artist.id)}
                  className="bg-zinc-900/60 hover:bg-zinc-800 p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-all group flex flex-col items-center text-center"
                >
                  <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 border border-zinc-700 group-hover:border-emerald-500/50 transition-colors shadow-lg">
                    <Mic className="w-10 h-10 text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                  </div>
                  <h3 className="font-semibold text-white truncate w-full mb-1">{artist.name}</h3>
                  <p className="text-xs text-zinc-400">{artist.songCount || 0} Songs • {artist.albumCount || 0} Albums</p>
                </div>
              ))}
              {artists.length === 0 && (
                <div className="col-span-full py-16 text-center text-zinc-500">
                  No artists found. Run a library scan from Settings or the scan button above.
                </div>
              )}
            </div>
          )}

          {/* Tab Content: Albums */}
          {tab === 'albums' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {albums.map(album => (
                <div 
                  key={album.id}
                  onClick={() => openAlbum(album.id)}
                  className="bg-zinc-900/60 hover:bg-zinc-800 p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-all group"
                >
                  <div className="w-full aspect-square bg-zinc-800 rounded-lg mb-4 flex items-center justify-center border border-zinc-700 group-hover:border-emerald-500/50 transition-colors shadow-lg">
                    <Disc className="w-12 h-12 text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                  </div>
                  <h3 className="font-semibold text-white truncate mb-0.5">{album.title}</h3>
                  <p className="text-xs text-zinc-400 truncate mb-1">{album.artist || 'Unknown Artist'}</p>
                  <p className="text-[11px] text-zinc-500">{album.year || 'Unknown Year'} • {album.songCount || 0} Tracks</p>
                </div>
              ))}
              {albums.length === 0 && (
                <div className="col-span-full py-16 text-center text-zinc-500">
                  No albums found.
                </div>
              )}
            </div>
          )}

          {/* Tab Content: Songs */}
          {tab === 'songs' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Artist</th>
                    <th className="px-4 py-3 font-medium">Album</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Variant</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {songs.map(song => (
                    <tr key={song.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/50 group">
                      <td className="px-4 py-3 font-medium text-white flex items-center gap-3">
                        <Music className="w-4 h-4 text-zinc-500 shrink-0" />
                        <span className="truncate" title={song.title}>{song.title}</span>
                        {song.hasLrc && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">
                            LRC
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-300 truncate" title={song.artist}>{song.artist || 'Unknown Artist'}</td>
                      <td className="px-4 py-3 text-zinc-400 truncate" title={song.album}>{song.album || 'Unknown Album'}</td>
                      <td className="px-4 py-3 text-zinc-400">{formatDuration(song.duration)}</td>
                      <td className="px-4 py-3 text-zinc-400 capitalize">{song.variant}</td>
                      <td className="px-4 py-3 text-right">
                        <button 
                          onClick={() => addToQueue(song.id)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs inline-flex items-center gap-1 transition-colors"
                          title="Add to queue"
                        >
                          <Plus className="w-3 h-3" /> Add to Queue
                        </button>
                      </td>
                    </tr>
                  ))}
                  {songs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
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
