import { useState, useEffect, useRef } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Play, Pause, SkipForward, ListMusic, User } from 'lucide-react';

export default function RoomSession() {
  const { sessionId } = useParams();
  const { user } = useOutletContext<{ user: any }>();
  const [session, setSession] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playing, setPlaying] = useState(false);
  
  // For the host player
  const audioRef = useRef<HTMLAudioElement>(null);
  const isHost = session?.hostId === user?.id;

  const fetchState = async () => {
    const res = await fetch(`/api/karaoke/sessions/${sessionId}/state`);
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
      setQueue(data.queue);
    }
  };

  useEffect(() => {
    fetchState();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/karaoke?sessionId=${sessionId}`);
    
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch(msg.type) {
        case 'QUEUE_UPDATED':
          fetchState();
          break;
        case 'PLAYING':
          setPlaying(true);
          if (audioRef.current && isHost) audioRef.current.play();
          break;
        case 'PAUSED':
          setPlaying(false);
          if (audioRef.current && isHost) audioRef.current.pause();
          break;
        case 'SONG_CHANGED':
          fetchState();
          break;
      }
    };

    setWs(socket);
    return () => socket.close();
  }, [sessionId, isHost]);

  const togglePlay = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: playing ? 'PAUSE' : 'PLAY' }));
    }
  };

  if (!session) return <div className="p-8">Loading session...</div>;

  const currentSong = queue.find(q => q.status === 'playing') || queue[0];

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Main Player Area */}
      <div className="flex-1 bg-zinc-950 flex flex-col border-r border-zinc-800">
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900">
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400 uppercase tracking-widest font-semibold">Room Code</span>
            <span className="text-2xl font-mono font-bold text-emerald-400 tracking-widest bg-zinc-950 px-3 py-1 rounded border border-zinc-800">
              {session.roomCode}
            </span>
          </div>
          <div className="text-sm text-zinc-500">
            {isHost ? 'You are the Host' : 'Controller Mode'}
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
          {/* Visual Player Placeholder */}
          {currentSong ? (
            <div className="text-center z-10">
              <h2 className="text-4xl md:text-6xl font-bold text-white mb-4 drop-shadow-lg">{currentSong.songTitle}</h2>
              <p className="text-xl md:text-2xl text-zinc-300 drop-shadow">{currentSong.artistName}</p>
              
              <div className="mt-12 text-zinc-500 font-medium flex items-center justify-center gap-2">
                <User className="w-5 h-5" />
                Singer: <span className="text-zinc-300">User {currentSong.userId}</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-zinc-600">
              <ListMusic className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-xl">Queue is empty</p>
              <p className="text-sm mt-2">Add some songs from the library!</p>
            </div>
          )}
          
          {/* Background decoration */}
          {currentSong && (
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-900 to-zinc-800 opacity-50 -z-10" />
          )}

          {isHost && currentSong && (
            <audio 
              ref={audioRef} 
              src={`/api/songs/${currentSong.songId}/audio?type=instrumental`} 
              className="hidden"
            />
          )}
        </div>

        {/* Controls */}
        <div className="p-6 bg-zinc-900 border-t border-zinc-800 flex items-center justify-center gap-6">
          <button 
            onClick={togglePlay}
            className="w-14 h-14 bg-white hover:bg-zinc-200 text-black rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          >
            {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
          </button>
          <button className="w-12 h-12 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full flex items-center justify-center transition-colors">
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Sidebar Queue */}
      <div className="w-full lg:w-80 bg-zinc-900 flex flex-col">
        <div className="p-4 border-b border-zinc-800 font-semibold flex items-center justify-between">
          <span>Up Next</span>
          <span className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400">{queue.length} songs</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {queue.map((item, index) => (
            <div 
              key={item.id} 
              className={`p-3 rounded-lg mb-2 flex flex-col gap-1 ${index === 0 ? 'bg-emerald-900/20 border border-emerald-500/30' : 'bg-zinc-950 border border-zinc-800/50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-sm truncate">{item.songTitle}</span>
                {index === 0 && <span className="text-[10px] uppercase font-bold text-emerald-500">Playing</span>}
              </div>
              <div className="text-xs text-zinc-500 truncate">{item.artistName}</div>
              <div className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
                <User className="w-3 h-3" /> User {item.userId}
              </div>
            </div>
          ))}
          {queue.length === 0 && (
            <div className="p-4 text-center text-sm text-zinc-500">
              The queue is empty.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
