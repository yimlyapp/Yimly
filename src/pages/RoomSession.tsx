import { useState, useEffect, useRef } from 'react';
import { useParams, useOutletContext, useNavigate } from 'react-router-dom';
import { 
  Play, Pause, SkipForward, RotateCcw, Mic, Music, Disc, 
  Sliders, FileText, ArrowLeft, Plus, Trash2, Volume2, Radio, Check, AlertCircle, User
} from 'lucide-react';

interface LyricLine {
  time: number;
  text: string;
}

export default function RoomSession() {
  const { sessionId } = useParams();
  const { user } = useOutletContext<{ user: any }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Advanced features state
  const [variant, setVariant] = useState<'original' | 'instrumental'>('original');
  const [lyricOffset, setLyricOffset] = useState<number>(0); // in ms
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentSongDetails, setCurrentSongDetails] = useState<any>(null);
  const [showLyricsModal, setShowLyricsModal] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const restorePositionRef = useRef<{ time: number, playing: boolean } | null>(null);
  const isHost = session?.hostId === user?.id;

  const fetchState = async () => {
    try {
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/state`);
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
        setQueue(data.queue || []);
      }
    } catch (e) {
      console.error('Failed to fetch session state:', e);
    }
  };

  useEffect(() => {
    fetchState();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/karaoke?sessionId=${sessionId}`);
    
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch(msg.type) {
          case 'STATE_UPDATE':
            setPlaying(msg.payload.playing);
            if (msg.payload.variant) setVariant(msg.payload.variant);
            if (msg.payload.lyricOffset !== undefined) setLyricOffset(msg.payload.lyricOffset);
            fetchState();
            break;
          case 'QUEUE_UPDATED':
          case 'QUEUE_EMPTY':
            fetchState();
            break;
          case 'PLAYING':
            setPlaying(true);
            if (audioRef.current && isHost) {
              audioRef.current.play().catch(err => console.log('Autoplay prevented:', err));
            }
            break;
          case 'PAUSED':
            setPlaying(false);
            if (audioRef.current && isHost) audioRef.current.pause();
            break;
          case 'RESTARTED':
            if (audioRef.current) {
              audioRef.current.currentTime = 0;
              setCurrentTime(0);
            }
            break;
          case 'SONG_CHANGED':
            fetchState();
            setPlaying(true);
            break;
          case 'VARIANT_CHANGED':
            setVariant(msg.payload.variant);
            if (msg.payload.position !== undefined) {
              setCurrentTime(msg.payload.position);
            }
            if (msg.payload.playing !== undefined) {
              setPlaying(msg.payload.playing);
            }
            break;
          case 'OFFSET_CHANGED':
            setLyricOffset(msg.payload.offset);
            break;
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    setWs(socket);
    return () => socket.close();
  }, [sessionId, isHost]);

  // Determine current song
  const currentSong = queue.find(q => q.status === 'playing') || queue.find(q => q.status === 'pending') || queue[0];

  // Fetch song details and lyrics whenever currentSong changes
  useEffect(() => {
    if (currentSong?.songId) {
      fetch(`/api/songs/${currentSong.songId}`)
        .then(res => res.json())
        .then(data => setCurrentSongDetails(data))
        .catch(err => console.error('Failed to fetch song details:', err));

      fetch(`/api/songs/${currentSong.songId}/lyrics`)
        .then(res => {
          if (!res.ok) throw new Error('No lyrics');
          return res.text();
        })
        .then(text => {
          setLyrics(parseLrc(text));
        })
        .catch(() => {
          setLyrics([]);
        });
    } else {
      setCurrentSongDetails(null);
      setLyrics([]);
    }
  }, [currentSong?.songId]);

  function parseLrc(lrcText: string): LyricLine[] {
    const lines = lrcText.split('\n');
    const result: LyricLine[] = [];
    const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const time = minutes * 60 + seconds + millis / 1000;
        const text = match[4].trim();
        result.push({ time, text });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  }

  // Host Control actions
  const togglePlay = () => {
    if (!isHost) return;
    if (ws) {
      ws.send(JSON.stringify({ type: playing ? 'PAUSE' : 'PLAY' }));
    }
  };

  const handleSkip = () => {
    if (!isHost) return;
    if (ws) {
      ws.send(JSON.stringify({ type: 'SKIP' }));
    }
  };

  const handleRestart = () => {
    if (!isHost) return;
    if (ws) {
      ws.send(JSON.stringify({ type: 'RESTART' }));
    }
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleToggleInstrumental = () => {
    if (!isHost) return;
    if (!currentSongDetails?.hasInstrumental && variant === 'original') {
      alert('Instrumental version not available for this song.');
      return;
    }
    
    const currentPos = audioRef.current ? audioRef.current.currentTime : currentTime;
    const wasPlaying = playing;
    
    const newVariant = variant === 'original' ? 'instrumental' : 'original';
    setVariant(newVariant);
    
    restorePositionRef.current = { time: currentPos, playing: wasPlaying };
    
    if (ws) {
      ws.send(JSON.stringify({ 
        type: 'VARIANT_CHANGED', 
        payload: { 
          variant: newVariant,
          position: currentPos,
          playing: wasPlaying
        } 
      }));
    }
  };

  const handleOffsetChange = (delta: number) => {
    if (!isHost) return;
    const newOffset = lyricOffset + delta;
    setLyricOffset(newOffset);
    if (ws) {
      ws.send(JSON.stringify({ type: 'OFFSET_CHANGED', payload: { offset: newOffset } }));
    }
  };

  const handleSongEnded = () => {
    if (isHost && ws) {
      ws.send(JSON.stringify({ type: 'SONG_FINISHED' }));
    }
  };

  // Find active lyric index based on current playback time + lyricOffset
  const adjustedTime = currentTime + (lyricOffset / 1000);
  const activeLyricIndex = lyrics.findIndex((l, idx) => {
    const nextLine = lyrics[idx + 1];
    return adjustedTime >= l.time && (!nextLine || adjustedTime < nextLine.time);
  });

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="animate-pulse flex items-center gap-3">
          <Disc className="w-8 h-8 text-emerald-500 animate-spin" />
          <span className="text-lg font-medium">Loading Karaoke Room...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden flex-col lg:flex-row">
      {/* Left / Main Player Screen */}
      <div className="flex-1 flex flex-col border-r border-zinc-800/80 relative">
        {/* Top Room Banner */}
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur flex items-center justify-between z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate('/rooms')}
              className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
              title="Back to Rooms"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <span className="text-xs text-zinc-400 uppercase tracking-widest font-semibold block">Karaoke Room</span>
              <div className="flex items-center gap-3">
                <span className="text-xl font-mono font-bold text-emerald-400 tracking-wider">
                  {session.roomCode}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20 flex items-center gap-1.5">
                  <Radio className="w-3 h-3 animate-pulse" /> Live Session
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isHost ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
              {isHost ? 'Host Mode' : 'Singer / Guest Mode'}
            </span>
          </div>
        </div>

        {/* Main Visual Stage & Lyrics Viewer */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden bg-gradient-to-b from-zinc-900/40 via-zinc-950 to-zinc-950">
          {currentSong ? (
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center text-center z-10">
              {/* Album Art / Vinyl Graphic */}
              <div className="w-36 h-36 md:w-48 md:h-48 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl flex items-center justify-center mb-6 relative group overflow-hidden">
                <Disc className={`w-20 h-20 text-emerald-500 ${playing ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
                <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Song Title & Artist */}
              <h1 className="text-3xl md:text-5xl font-bold text-white mb-2 tracking-tight">{currentSong.songTitle}</h1>
              <p className="text-lg md:text-xl text-zinc-400 font-medium mb-6">{currentSong.artistName}</p>

              {/* Singer Pill */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 mb-8 shadow-inner">
                <User className="w-4 h-4 text-emerald-400" />
                <span>Sung by: <strong className="text-white">User {currentSong.userId}</strong></span>
              </div>

              {/* Lyrics Box */}
              <div className="w-full max-w-2xl bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-6 shadow-xl backdrop-blur min-h-[180px] max-h-[240px] overflow-y-auto flex flex-col justify-center">
                {lyrics.length > 0 ? (
                  <div className="space-y-3">
                    {activeLyricIndex !== -1 && lyrics[activeLyricIndex - 1] && (
                      <p className="text-zinc-500 text-sm transition-all">{lyrics[activeLyricIndex - 1].text}</p>
                    )}
                    <p className="text-xl md:text-2xl font-bold text-emerald-400 scale-105 transition-all">
                      {activeLyricIndex !== -1 ? lyrics[activeLyricIndex].text : (lyrics[0]?.text || 'Get ready...')}
                    </p>
                    {activeLyricIndex !== -1 && lyrics[activeLyricIndex + 1] && (
                      <p className="text-zinc-400 text-sm transition-all">{lyrics[activeLyricIndex + 1].text}</p>
                    )}
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm py-8 flex flex-col items-center gap-2">
                    <FileText className="w-6 h-6 opacity-40" />
                    <span>Lyrics unavailable for this song</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center z-10 py-16">
              <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
                <Music className="w-10 h-10 text-zinc-600" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-300 mb-2">Queue is Empty</h2>
              <p className="text-zinc-500 text-sm max-w-md mx-auto">
                No songs are currently playing. Add songs from the Library to start the karaoke session!
              </p>
            </div>
          )}

          {/* Hidden Audio Element for Host */}
          {isHost && currentSong && (
            <audio 
              ref={audioRef}
              src={`/api/songs/${currentSong.songId}/audio?type=${variant}`}
              autoPlay={playing}
              onTimeUpdate={() => {
                if (audioRef.current) {
                  setCurrentTime(audioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (audioRef.current) {
                  setDuration(audioRef.current.duration);
                  
                  if (restorePositionRef.current) {
                    audioRef.current.currentTime = restorePositionRef.current.time;
                    if (restorePositionRef.current.playing) {
                      audioRef.current.play().catch(err => console.log('Autoplay prevented:', err));
                    } else {
                      audioRef.current.pause();
                    }
                    restorePositionRef.current = null;
                  }
                }
              }}
              onEnded={handleSongEnded}
              className="hidden"
            />
          )}
        </div>

        {/* Host Controls Panel (Bottom Bar) */}
        <div className="p-6 bg-zinc-900 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-start">
            {/* Instrumental Toggle */}
            <button 
              onClick={handleToggleInstrumental}
              disabled={!isHost}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all border ${
                variant === 'instrumental' 
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/20' 
                  : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
              } ${!isHost ? 'opacity-70 cursor-not-allowed' : ''}`}
              title="Switch between Original Vocal and Instrumental version"
            >
              <Music className="w-4 h-4" />
              <span>Instrumental: {variant === 'instrumental' ? 'ON' : 'OFF'}</span>
            </button>

            {/* Lyric Offset Controls */}
            <div className="flex items-center gap-1 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800 text-xs">
              <span className="text-zinc-400 mr-1 font-medium">Offset:</span>
              <button 
                onClick={() => handleOffsetChange(-250)}
                disabled={!isHost}
                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors disabled:opacity-50"
              >
                -250ms
              </button>
              <span className="px-2 font-mono text-emerald-400 font-bold">{lyricOffset > 0 ? `+${lyricOffset}` : lyricOffset}ms</span>
              <button 
                onClick={() => handleOffsetChange(250)}
                disabled={!isHost}
                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors disabled:opacity-50"
              >
                +250ms
              </button>
            </div>
          </div>

          {/* Center Playback Controls */}
          <div className="flex items-center gap-4">
            <button 
              onClick={handleRestart}
              disabled={!isHost || !currentSong}
              className="p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors disabled:opacity-40"
              title="Restart song"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button 
              onClick={togglePlay}
              disabled={!isHost || !currentSong}
              className="w-14 h-14 bg-white hover:bg-zinc-200 text-black rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-lg disabled:opacity-40"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
            </button>
            <button 
              onClick={handleSkip}
              disabled={!isHost || !currentSong}
              className="p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors disabled:opacity-40"
              title="Skip song"
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          <div className="text-xs text-zinc-500 font-medium hidden lg:block">
            {isHost ? 'You control playback for the room' : 'Listening & viewing synchronized'}
          </div>
        </div>
      </div>

      {/* Right Sidebar: Up Next Queue */}
      <div className="w-full lg:w-96 bg-zinc-900 flex flex-col h-full border-t lg:border-t-0 border-zinc-800">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-white">Up Next Queue</h2>
          </div>
          <span className="text-xs bg-zinc-800 px-2.5 py-1 rounded-full text-zinc-300 font-medium">{queue.length} songs</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {queue.map((item, index) => {
            const isCurrentPlaying = item.status === 'playing' || index === 0;
            return (
              <div 
                key={item.id} 
                className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                  isCurrentPlaying 
                    ? 'bg-emerald-950/20 border-emerald-500/40 shadow-md' 
                    : 'bg-zinc-950 border-zinc-800/60 hover:border-zinc-700'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-zinc-500">#{index + 1}</span>
                    <h3 className="font-medium text-sm text-white truncate">{item.songTitle}</h3>
                    {isCurrentPlaying && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500 text-black">
                        Playing
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 truncate mb-2">{item.artistName}</p>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <User className="w-3 h-3 text-emerald-400" />
                    <span>Sung by User {item.userId}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {queue.length === 0 && (
            <div className="py-16 text-center text-zinc-500 px-4">
              <Music className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">Queue is empty</p>
              <p className="text-xs text-zinc-600">Add songs from the library to build your queue.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
