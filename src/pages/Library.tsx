import { useState, useEffect } from 'react';
import { Search, Play, Plus, Music } from 'lucide-react';

export default function Library() {
  const [songs, setSongs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  
  useEffect(() => {
    if (search) {
      fetch(`/api/songs/search?q=${encodeURIComponent(search)}`)
        .then(res => res.json())
        .then(setSongs);
    } else {
      fetch('/api/songs')
        .then(res => res.json())
        .then(setSongs);
    }
  }, [search]);

  const addToQueue = async (songId: number) => {
    try {
      const activeRoomsRes = await fetch('/api/karaoke/active-sessions');
      const rooms = await activeRoomsRes.json();
      if (rooms.length === 0) {
        alert("No active karaoke rooms to join.");
        return;
      }
      const sessionId = rooms[0].id; // Just pick the first for now
      
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId })
      });
      if (res.ok) alert('Added to queue!');
      else alert('Failed to add');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Karaoke Library</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input 
            type="text" 
            placeholder="Search songs or artists..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {songs.map(song => (
          <div key={song.id} className="bg-zinc-900/50 hover:bg-zinc-800 transition-colors border border-zinc-800 hover:border-zinc-700 rounded-lg p-4 group flex flex-col">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                <Music className="w-6 h-6 text-zinc-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-white truncate" title={song.title}>{song.title}</h3>
                <p className="text-sm text-zinc-400 truncate" title={song.artist}>{song.artist}</p>
              </div>
            </div>
            
            <div className="mt-auto flex items-center justify-between">
              <div className="flex gap-2">
                {song.hasLrc && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    LRC
                  </span>
                )}
              </div>
              <button 
                onClick={() => addToQueue(song.id)}
                className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Add to current room"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {songs.length === 0 && (
          <div className="col-span-full py-12 text-center text-zinc-500">
            No songs found.
          </div>
        )}
      </div>
    </div>
  );
}
