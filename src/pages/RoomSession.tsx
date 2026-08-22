import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Play, Pause, SkipForward, RotateCcw, Mic, Music, Disc, 
  Sliders, FileText, ArrowLeft, Plus, Radio, Check, AlertCircle, 
  User, Library as LibraryIcon, Search, Sparkles, X, RefreshCw
} from 'lucide-react';

interface LyricLine {
  time: number;
  text: string;
}

interface SongItem {
  id: number;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  hasLrc?: boolean;
  hasInstrumental?: boolean;
}

type ValidationStatus = 'loading' | 'valid' | 'not_found' | 'expired' | 'invalid_controller' | 'error';

export default function RoomSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const roleParam = searchParams.get('role');
  const controllerId = searchParams.get('controllerId');
  const isHost = roleParam === 'host';

  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

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
  const [showLibrary, setShowLibrary] = useState(false);

  // Library modal search & songs
  const [availableSongs, setAvailableSongs] = useState<SongItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [addingSongId, setAddingSongId] = useState<number | null>(null);
  const [addedSongId, setAddedSongId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const restorePositionRef = useRef<{ time: number, playing: boolean } | null>(null);

  // 1. Initial Validation on Mount
  useEffect(() => {
    let isMounted = true;

    async function validate() {
      if (!sessionId) {
        setValidationStatus('not_found');
        setErrorMessage('Session ID is missing.');
        return;
      }

      try {
        const query = new URLSearchParams({
          role: roleParam || 'guest',
          ...(controllerId ? { controllerId } : {})
        });

        const res = await fetch(`/api/karaoke/sessions/${sessionId}/validate?${query.toString()}`);
        const data = await res.json();

        if (!isMounted) return;

        if (res.ok && data.valid) {
          setSession(data.session);
          setValidationStatus('valid');
        } else {
          if (data.code === 'ROOM_NOT_FOUND' || res.status === 404) {
            setValidationStatus('not_found');
            setErrorMessage(data.error || 'The requested karaoke room does not exist.');
          } else if (data.code === 'ROOM_EXPIRED' || res.status === 410) {
            setValidationStatus('expired');
            setErrorMessage(data.error || 'This karaoke room has ended or expired.');
          } else if (data.code === 'INVALID_CONTROLLER' || data.code === 'CONTROLLER_REQUIRED' || res.status === 403) {
            setValidationStatus('invalid_controller');
            setErrorMessage(data.error || 'Guest access rejected: invalid or missing controller credentials.');
          } else {
            setValidationStatus('error');
            setErrorMessage(data.error || 'Unable to access room.');
          }
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Validation error:', err);
        setValidationStatus('error');
        setErrorMessage('Failed to connect to the karaoke server.');
      }
    }

    validate();

    return () => {
      isMounted = false;
    };
  }, [sessionId, roleParam, controllerId]);

  // 2. Fetch Session State & Queue
  const fetchState = async () => {
    if (!sessionId) return;
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

  // 3. Connect WebSocket once session is valid
  useEffect(() => {
    if (validationStatus !== 'valid' || !sessionId) return;

    fetchState();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/karaoke?sessionId=${sessionId}&isHost=${isHost}`);
    
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
          case 'SESSION_CLOSED':
            setValidationStatus('expired');
            setErrorMessage('The host has closed the session.');
            break;
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    setWs(socket);
    return () => socket.close();
  }, [validationStatus, sessionId, isHost]);

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

  // Load songs for song picker modal
  useEffect(() => {
    if (showLibrary) {
      fetch('/api/songs')
        .then(res => res.json())
        .then(data => setAvailableSongs(Array.isArray(data) ? data : []))
        .catch(err => console.error('Failed to load songs:', err));
    }
  }, [showLibrary]);

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

  // Add song to queue from picker modal
  const handleAddSongToQueue = async (songId: number) => {
    if (!sessionId) return;
    try {
      setAddingSongId(songId);
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          songId,
          controllerId: controllerId || undefined
        })
      });

      if (res.ok) {
        setAddedSongId(songId);
        setTimeout(() => setAddedSongId(null), 2000);
        fetchState();
      } else {
        alert('Failed to add song to queue');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add song to queue');
    } finally {
      setAddingSongId(null);
    }
  };

  // Find active lyric index based on current playback time + lyricOffset
  const adjustedTime = currentTime + (lyricOffset / 1000);
  const activeLyricIndex = lyrics.findIndex((l, idx) => {
    const nextLine = lyrics[idx + 1];
    return adjustedTime >= l.time && (!nextLine || adjustedTime < nextLine.time);
  });

  const filteredSongs = availableSongs.filter(s => {
    const q = searchQuery.toLowerCase();
    return s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q) || s.album?.toLowerCase().includes(q);
  });

  // -------------------------------------------------------------
  // Render: Loading State
  // -------------------------------------------------------------
  if (validationStatus === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center">
            <Disc className="w-8 h-8 text-emerald-400 animate-spin" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-100">Connecting to Karaoke Room</h2>
          <p className="text-sm text-zinc-400">Verifying session credentials and synchronizing player state...</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Error / Not Found / Expired / Invalid Controller States
  // -------------------------------------------------------------
  if (validationStatus !== 'valid') {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-red-950/50 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8" />
          </div>

          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 mb-3">
            {validationStatus === 'not_found' && 'Room Not Found'}
            {validationStatus === 'expired' && 'Room Expired'}
            {validationStatus === 'invalid_controller' && 'Guest Access Rejected'}
            {validationStatus === 'error' && 'Connection Error'}
          </span>

          <h2 className="text-2xl font-bold text-white mb-2">
            {validationStatus === 'not_found' && 'Room Does Not Exist'}
            {validationStatus === 'expired' && 'Session Has Ended'}
            {validationStatus === 'invalid_controller' && 'Invalid Controller'}
            {validationStatus === 'error' && 'Unable to Join'}
          </h2>

          <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
            {errorMessage || 'Please check the room URL or room code and try again.'}
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate('/rooms')}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Mic className="w-4 h-4" />
              Join Another Room
            </button>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Active Karaoke Room Experience
  // -------------------------------------------------------------
  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden flex-col lg:flex-row relative">
      {/* Room Song Catalog / Add to Queue Modal */}
      {showLibrary && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col h-[85vh] shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-zinc-800 bg-zinc-950/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-950/50 border border-emerald-500/30 rounded-xl text-emerald-400">
                  <LibraryIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Room Song Catalog</h2>
                  <p className="text-xs text-zinc-400">Search and add songs to the live room queue</p>
                </div>
              </div>
              <button 
                onClick={() => setShowLibrary(false)}
                className="p-2 text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 rounded-xl transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/60 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  placeholder="Search song title, artist, or album..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Song List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredSongs.map((song) => {
                const isAdding = addingSongId === song.id;
                const isAdded = addedSongId === song.id;
                const durationMin = song.duration ? Math.floor(song.duration / 60) : 0;
                const durationSec = song.duration ? song.duration % 60 : 0;
                const durationStr = song.duration ? `${durationMin}:${durationSec < 10 ? '0' : ''}${durationSec}` : '';

                return (
                  <div 
                    key={song.id}
                    className="p-3.5 bg-zinc-950/60 hover:bg-zinc-800/60 border border-zinc-800/80 rounded-xl flex items-center justify-between gap-3 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                        <Music className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm text-white truncate">{song.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-zinc-400 truncate">
                          <span>{song.artist || 'Unknown Artist'}</span>
                          {song.album && <span>• {song.album}</span>}
                          {durationStr && <span>• {durationStr}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {song.hasLrc && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          LRC
                        </span>
                      )}
                      <button
                        onClick={() => handleAddSongToQueue(song.id)}
                        disabled={isAdding || isAdded}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                          isAdded 
                            ? 'bg-emerald-600 text-white' 
                            : 'bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30'
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <Check className="w-3.5 h-3.5" /> Added
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" /> Add to Queue
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}

              {filteredSongs.length === 0 && (
                <div className="py-16 text-center text-zinc-500">
                  <Music className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No songs found</p>
                  <p className="text-xs text-zinc-600 mt-1">Try another search term or scan new media in the Library.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Left / Main Player Stage */}
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
                  {session?.roomCode}
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

        {/* Main Stage & Lyrics Viewer */}
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
                <span>Sung by: <strong className="text-white">Singer {currentSong.userId || 'Guest'}</strong></span>
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
              <p className="text-zinc-500 text-sm max-w-md mx-auto mb-6">
                No songs are currently playing. Browse the song catalog to start your karaoke party!
              </p>
              <button
                onClick={() => setShowLibrary(true)}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors inline-flex items-center gap-2 text-sm shadow-lg shadow-emerald-950/40"
              >
                <Plus className="w-4 h-4" /> Add First Song
              </button>
            </div>
          )}

          {/* Audio Player for Host */}
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

        {/* Bottom Control Bar */}
        {isHost ? (
          <div className="p-6 bg-zinc-900 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-start">
              {/* Instrumental Toggle */}
              <button 
                onClick={handleToggleInstrumental}
                className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all border ${
                  variant === 'instrumental' 
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/20' 
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                }`}
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
                  className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors"
                >
                  -250ms
                </button>
                <span className="px-2 font-mono text-emerald-400 font-bold">{lyricOffset > 0 ? `+${lyricOffset}` : lyricOffset}ms</span>
                <button 
                  onClick={() => handleOffsetChange(250)}
                  className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors"
                >
                  +250ms
                </button>
              </div>
            </div>

            {/* Center Playback Controls */}
            <div className="flex items-center gap-4">
              <button 
                onClick={handleRestart}
                disabled={!currentSong}
                className="p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors disabled:opacity-40"
                title="Restart song"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              
              <button 
                onClick={togglePlay}
                disabled={!currentSong}
                className="w-14 h-14 bg-white hover:bg-zinc-200 text-black rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-lg disabled:opacity-40"
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
              </button>

              <button 
                onClick={handleSkip}
                disabled={!currentSong}
                className="p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors disabled:opacity-40"
                title="Skip song"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={() => setShowLibrary(true)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              Add Songs
            </button>
          </div>
        ) : (
          <div className="p-6 bg-zinc-900 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLibrary(true)}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-emerald-950/40"
              >
                <LibraryIcon className="w-5 h-5" />
                Browse Song Catalog
              </button>
              <div className="text-sm text-zinc-400 hidden sm:block">Find and add your favorite songs to the queue</div>
            </div>
            <div className="text-xs text-zinc-500 font-medium hidden lg:block">
              Listening & lyrics synchronized with room
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar: Up Next Queue */}
      <div className="w-full lg:w-96 bg-zinc-900 flex flex-col h-full border-t lg:border-t-0 border-zinc-800">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-white">Up Next Queue</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-zinc-800 px-2.5 py-1 rounded-full text-zinc-300 font-medium">{queue.length} songs</span>
            <button
              onClick={() => setShowLibrary(true)}
              className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg transition-colors"
              title="Add Song"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
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
                    <span>Singer {item.userId || 'Guest'}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {queue.length === 0 && (
            <div className="py-16 text-center text-zinc-500 px-4">
              <Music className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">Queue is empty</p>
              <p className="text-xs text-zinc-600">Add songs from the catalog to build your queue.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

