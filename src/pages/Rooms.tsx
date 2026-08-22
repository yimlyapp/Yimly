import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, LogIn, Users, Mic, Radio, Sparkles, ArrowRight, Disc, RefreshCw } from 'lucide-react';

export default function Rooms() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchActiveSessions = () => {
    fetch('/api/karaoke/active-sessions')
      .then(res => res.json())
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to load active rooms:', err));
  };

  useEffect(() => {
    fetchActiveSessions();
  }, []);

  const createRoom = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/karaoke/sessions', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create room');
      navigate(`/rooms/${data.id}?role=host`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const joinRoom = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCode.replace(/\s+/g, '');
    if (!cleanCode) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/karaoke/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: cleanCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join room');
      navigate(`/rooms/${data.sessionId}?role=guest&controllerId=${data.controllerId}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-2">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>Live Session Hub</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Karaoke Rooms</h1>
          <p className="text-sm text-zinc-400 mt-1">Host a live karaoke session or join a room from your mobile device.</p>
        </div>

        <button
          onClick={fetchActiveSessions}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors self-start md:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Rooms</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-2xl text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-xs text-red-400 hover:text-white underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Action Cards Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Host a Session Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#1A1828] to-[#12131F] border border-[#FF4FA3]/25 p-8 flex flex-col items-center text-center shadow-xl group">
          <div className="absolute top-0 right-0 w-48 h-48 bg-[#FF4FA3]/10 rounded-full blur-2xl pointer-events-none" />

          <div className="w-16 h-16 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center mb-5 shadow-lg shadow-[#FF4FA3]/10">
            <Mic className="w-8 h-8 text-[#FF4FA3]" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Host a Session</h2>
          <p className="text-sm text-zinc-400 mb-8 max-w-xs leading-relaxed">
            Create a live karaoke room. Display synchronized lyrics and control audio on this screen.
          </p>

          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full max-w-xs py-3.5 px-6 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{loading ? 'Creating Room...' : 'Start Hosting'}</span>
          </button>
        </div>

        {/* Join a Session Card */}
        <div className="rounded-3xl bg-[#141622] border border-white/10 p-8 flex flex-col items-center text-center shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
            <LogIn className="w-8 h-8 text-zinc-300" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Join a Session</h2>
          <p className="text-sm text-zinc-400 mb-6 max-w-xs leading-relaxed">
            Enter a room code to browse songs, queue up tracks, and sing along from your phone.
          </p>

          <form onSubmit={joinRoom} className="w-full max-w-xs space-y-3">
            <input
              type="text"
              placeholder="e.g. 435 288"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className="w-full px-4 py-3 bg-[#0A0B10] border border-white/15 rounded-xl text-center text-xl font-mono tracking-widest text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all uppercase"
              maxLength={7}
            />
            <button
              type="submit"
              disabled={loading || !joinCode}
              className="w-full py-3 px-6 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <span>Join Room</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Active Sessions List */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-[#FF4FA3]" />
            <span>Active Karaoke Rooms ({sessions.length})</span>
          </h3>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                setJoinCode(s.roomCode);
              }}
              className="bg-[#141622] border border-white/5 hover:border-[#FF4FA3]/40 rounded-2xl p-5 flex items-center justify-between hover:bg-[#1A1C2C] transition-all cursor-pointer group"
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-[#FF4FA3] animate-pulse" />
                  <span className="font-mono text-xl font-extrabold text-white tracking-widest group-hover:text-[#FF4FA3] transition-colors">
                    {s.roomCode}
                  </span>
                </div>
                <div className="text-xs text-zinc-500">Host: {s.hostId}</div>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-[#FF4FA3]/15 text-[#FF4FA3] text-xs font-semibold border border-[#FF4FA3]/25 group-hover:bg-[#FF4FA3] group-hover:text-white transition-colors">
                Select
              </div>
            </div>
          ))}

          {sessions.length === 0 && (
            <div className="col-span-full py-12 text-center text-zinc-500 border border-dashed border-white/10 rounded-2xl bg-[#11121C]">
              <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-zinc-400">No active rooms right now</p>
              <p className="text-xs text-zinc-600 mt-1">Host a session to start singing!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
