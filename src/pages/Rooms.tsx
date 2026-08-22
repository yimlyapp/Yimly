import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, LogIn, Users } from 'lucide-react';

export default function Rooms() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/karaoke/active-sessions')
      .then(res => res.json())
      .then(setSessions);
  }, []);

  const createRoom = async () => {
    try {
      const res = await fetch('/api/karaoke/sessions', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      navigate(`/rooms/${data.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const joinRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!joinCode) return;

    try {
      const res = await fetch('/api/karaoke/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: joinCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      navigate(`/rooms/${data.sessionId}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Karaoke Rooms</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        {/* Create Room */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-xl p-8 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
            <Play className="w-8 h-8 text-emerald-500 ml-1" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">Host a Session</h2>
          <p className="text-zinc-400 mb-6">Create a new karaoke room and display the lyrics on this screen.</p>
          <button 
            onClick={createRoom}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-full transition-colors w-full max-w-xs"
          >
            Create Room
          </button>
        </div>

        {/* Join Room */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <LogIn className="w-8 h-8 text-blue-500" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">Join a Session</h2>
          <p className="text-zinc-400 mb-6">Enter a room code to queue songs and control playback.</p>
          <form onSubmit={joinRoom} className="w-full max-w-xs flex gap-2">
            <input 
              type="text"
              placeholder="e.g. 123 456"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg text-center text-xl tracking-widest uppercase focus:outline-none focus:border-blue-500 transition-colors"
              maxLength={7}
            />
            <button type="submit" className="px-6 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors">
              Join
            </button>
          </form>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-zinc-300">
          <Users className="w-5 h-5" /> Active Sessions
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map(s => (
            <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors cursor-pointer" onClick={() => {
              setJoinCode(s.roomCode);
            }}>
              <div>
                <div className="font-mono text-lg font-bold tracking-widest text-emerald-400">{s.roomCode}</div>
                <div className="text-sm text-zinc-500 mt-1">Host ID: {s.hostId}</div>
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="col-span-full py-8 text-center text-zinc-600 border border-dashed border-zinc-800 rounded-lg">
              No active rooms right now.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
