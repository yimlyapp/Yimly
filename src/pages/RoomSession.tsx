import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import GuestRoom from '../components/GuestRoom';
import { 
  getLyricsSettings, 
  resolveLyricsSettings,
  LyricsAppearanceSettings, 
  applyTextCase, 
  getFontFamilyStyle,
  getFontFamilyClass, 
  getAlignmentClass 
} from '../utils/lyricsSettings';
import { 
  Play, Pause, SkipForward, RotateCcw, Mic, Music, 
  FileText, ArrowLeft, Plus, Radio, Check, AlertCircle, 
  User, Library as LibraryIcon, Search, X, RefreshCw,
  Maximize2, Minimize2, MoreVertical, Info, LogOut, QrCode
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
  const [guestUsername, setGuestUsername] = useState<string>('');

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
  const [lyricsSettings, setLyricsSettings] = useState<LyricsAppearanceSettings>(() => {
    return getLyricsSettings();
  });
  const [currentSongDetails, setCurrentSongDetails] = useState<any>(null);

  const lastSongIdRef = useRef<number | null>(null);
  const prevSettingsJsonRef = useRef<string>('');

  // Synchronize and subscribe to canonical lyrics settings across storage, tabs, visibility, and session lifecycle
  useEffect(() => {
    const current = getLyricsSettings();
    setLyricsSettings(current);
    prevSettingsJsonRef.current = JSON.stringify(current);

    console.log('[LyricSettings] Host initialized');
    console.log('[LyricSettings] source: localStorage');
    console.log(`[LyricSettings] session: ${sessionId || 'unknown'}`);
    console.log(`[LyricSettings] font: ${current.highlighted.font}`);
    console.log(`[LyricSettings] currentSize: ${current.highlighted.size}`);
    console.log(`[LyricSettings] otherSize: ${current.unhighlighted.size}`);

    const handleSettingsChange = (e: any) => {
      const updated = e?.detail ? resolveLyricsSettings(e.detail) : getLyricsSettings();
      console.log('[LyricSettings] Updated from settings change event:', updated);
      setLyricsSettings(updated);
      prevSettingsJsonRef.current = JSON.stringify(updated);
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key || e.key === 'yimly_lyrics_appearance_settings_v1') {
        const updated = getLyricsSettings();
        console.log('[LyricSettings] Updated from storage event:', updated);
        setLyricsSettings(updated);
        prevSettingsJsonRef.current = JSON.stringify(updated);
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        const latest = getLyricsSettings();
        setLyricsSettings(latest);
        prevSettingsJsonRef.current = JSON.stringify(latest);
      }
    };

    window.addEventListener('yimly_lyrics_settings_changed', handleSettingsChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('yimly_lyrics_settings_changed', handleSettingsChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [sessionId]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [isRestartingSession, setIsRestartingSession] = useState(false);

  // Overflow menu and modals state (Host Only)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [showSessionInfoModal, setShowSessionInfoModal] = useState(false);

  // Library modal search & songs (for Guest Controller)
  const [availableSongs, setAvailableSongs] = useState<SongItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [addingSongId, setAddingSongId] = useState<number | null>(null);
  const [addedSongId, setAddedSongId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const restorePositionRef = useRef<{ time: number, playing: boolean } | null>(null);

  // -------------------------------------------------------------
  // TV Remote / D-pad Navigation Focus Management
  // -------------------------------------------------------------
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastFocusedTvIdRef = useRef<string | null>(null);
  const initialFocusSetRef = useRef(false);

  // Track last focused element ID
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && target !== document.body) {
        lastFocusedElementRef.current = target;
        const tvId = target.getAttribute('data-tv-id');
        if (tvId) {
          lastFocusedTvIdRef.current = tvId;
        }
      }
    };
    window.addEventListener('focusin', handleFocusIn);
    return () => window.removeEventListener('focusin', handleFocusIn);
  }, []);

  // Initial focus placement on Play button or primary action when Host room opens
  useEffect(() => {
    if (validationStatus === 'valid' && isHost) {
      const focusPrimary = () => {
        if (playButtonRef.current && !playButtonRef.current.hasAttribute('disabled')) {
          playButtonRef.current.focus();
          initialFocusSetRef.current = true;
          return;
        }
        const candidate = document.querySelector<HTMLElement>(
          '[data-tv-id="play-button"], [data-tv-id="start-session-button"], [data-tv-id="header-start-session-button"]'
        );
        if (candidate && !candidate.hasAttribute('disabled')) {
          candidate.focus();
          initialFocusSetRef.current = true;
        }
      };

      const t1 = setTimeout(focusPrimary, 100);
      const t2 = setTimeout(focusPrimary, 400);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [validationStatus, isHost, session?.id, queue]);

  // Focus recovery if focus lands back on body unexpectedly
  useEffect(() => {
    if (validationStatus === 'valid' && isHost) {
      if (document.activeElement === document.body) {
        if (lastFocusedTvIdRef.current) {
          const prevEl = document.querySelector<HTMLElement>(`[data-tv-id="${lastFocusedTvIdRef.current}"]`);
          if (prevEl && !prevEl.hasAttribute('disabled')) {
            prevEl.focus();
            return;
          }
        }
        if (playButtonRef.current && !playButtonRef.current.hasAttribute('disabled')) {
          playButtonRef.current.focus();
        }
      }
    }
  });

  // Overlay Focus Traps and Restoration
  useEffect(() => {
    if (showEndSessionModal) {
      const t = setTimeout(() => {
        const cancelBtn = document.querySelector<HTMLElement>('[data-tv-id="end-session-cancel"]');
        if (cancelBtn) cancelBtn.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showEndSessionModal]);

  useEffect(() => {
    if (showSessionInfoModal) {
      const t = setTimeout(() => {
        const closeBtn = document.querySelector<HTMLElement>('[data-tv-id="session-info-close"]');
        if (closeBtn) closeBtn.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showSessionInfoModal]);

  useEffect(() => {
    if (showOverflowMenu) {
      const t = setTimeout(() => {
        const firstMenuItem = document.querySelector<HTMLElement>('[data-tv-id="menu-session-info"]');
        if (firstMenuItem) firstMenuItem.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showOverflowMenu]);

  useEffect(() => {
    if (showLibrary) {
      const t = setTimeout(() => {
        const searchInput = document.querySelector<HTMLElement>('[data-tv-id="library-search"]');
        if (searchInput) searchInput.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showLibrary]);

  // Keydown Spatial & Back Key Handler for TV Remote / Keyboard
  useEffect(() => {
    if (!isHost) return;

    const getFocusable = (container: HTMLElement | Document = document): HTMLElement[] => {
      const selectors = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"]):not([disabled])',
        'a[href]'
      ].join(',');

      return Array.from(container.querySelectorAll<HTMLElement>(selectors)).filter(el => {
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
        return true;
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const keyCode = e.keyCode;

      const isDpad = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
                     keyCode === 38 || keyCode === 40 || keyCode === 37 || keyCode === 39;

      const isSelect = key === 'Enter' || key === ' ' || key === 'Select' ||
                       keyCode === 13 || keyCode === 32 || keyCode === 29443;

      const isBack = key === 'Escape' || key === 'Backspace' || key === 'GoBack' ||
                     keyCode === 27 || keyCode === 8 || keyCode === 10009 || keyCode === 461;

      // 1. Handle TV Remote Back / Escape Key
      if (isBack) {
        if (showEndSessionModal) {
          e.preventDefault();
          setShowEndSessionModal(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        if (showSessionInfoModal) {
          e.preventDefault();
          setShowSessionInfoModal(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        if (showOverflowMenu) {
          e.preventDefault();
          setShowOverflowMenu(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        if (showLibrary) {
          e.preventDefault();
          setShowLibrary(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        // Return focus to Play button if somewhere else
        const playBtn = playButtonRef.current || document.querySelector<HTMLElement>('[data-tv-id="play-button"]');
        if (playBtn && document.activeElement !== playBtn && !playBtn.hasAttribute('disabled')) {
          e.preventDefault();
          playBtn.focus();
          return;
        }
      }

      // 2. Handle OK / Select Key when focus is on body or non-interactive container
      if (isSelect) {
        if (document.activeElement === document.body) {
          e.preventDefault();
          const playBtn = playButtonRef.current || document.querySelector<HTMLElement>('[data-tv-id="play-button"], [data-tv-id="start-session-button"]');
          if (playBtn) {
            playBtn.focus();
            playBtn.click();
          }
          return;
        }
      }

      // 3. Handle D-pad Spatial Navigation
      if (isDpad) {
        const activeEl = (document.activeElement as HTMLElement) || document.body;

        // Allow range slider native left/right adjustment
        if (activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'range') {
          if (key === 'ArrowLeft' || key === 'ArrowRight' || keyCode === 37 || keyCode === 39) {
            return;
          }
        }

        // Allow text input left/right cursor movement
        if (activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'text') {
          if (key === 'ArrowLeft' || key === 'ArrowRight' || keyCode === 37 || keyCode === 39) {
            return;
          }
        }

        e.preventDefault();

        // Determine container scope
        let searchContainer: HTMLElement | Document = document;
        if (showEndSessionModal || showSessionInfoModal || showLibrary || showOverflowMenu) {
          const activeModal = document.querySelector<HTMLElement>('.fixed.inset-0, .absolute.right-0.z-50');
          if (activeModal) {
            searchContainer = activeModal;
          }
        }

        const candidates = getFocusable(searchContainer);
        if (candidates.length === 0) return;

        if (activeEl === document.body || !searchContainer.contains(activeEl)) {
          const defaultTarget = candidates.find(c => c.getAttribute('data-tv-id') === 'play-button') || candidates[0];
          if (defaultTarget) defaultTarget.focus();
          return;
        }

        const navCandidates = candidates.filter(c => c !== activeEl);
        if (navCandidates.length === 0) return;

        const activeRect = activeEl.getBoundingClientRect();
        const activeCenterX = activeRect.left + activeRect.width / 2;
        const activeCenterY = activeRect.top + activeRect.height / 2;

        let bestCandidate: HTMLElement | null = null;
        let minScore = Infinity;

        const isRight = key === 'ArrowRight' || keyCode === 39;
        const isLeft = key === 'ArrowLeft' || keyCode === 37;
        const isDown = key === 'ArrowDown' || keyCode === 40;
        const isUp = key === 'ArrowUp' || keyCode === 38;

        for (const cand of navCandidates) {
          const candRect = cand.getBoundingClientRect();
          const candCenterX = candRect.left + candRect.width / 2;
          const candCenterY = candRect.top + candRect.height / 2;

          let isDirectionValid = false;
          let score = Infinity;

          if (isRight) {
            if (candCenterX > activeCenterX + 2 || candRect.left >= activeRect.right - 5) {
              isDirectionValid = true;
              const dx = Math.max(0, candRect.left - activeRect.right);
              const dy = Math.abs(candCenterY - activeCenterY);
              score = dx + dy * 2.5;
            }
          } else if (isLeft) {
            if (candCenterX < activeCenterX - 2 || candRect.right <= activeRect.left + 5) {
              isDirectionValid = true;
              const dx = Math.max(0, activeRect.left - candRect.right);
              const dy = Math.abs(candCenterY - activeCenterY);
              score = dx + dy * 2.5;
            }
          } else if (isDown) {
            if (candCenterY > activeCenterY + 2 || candRect.top >= activeRect.bottom - 5) {
              isDirectionValid = true;
              const dy = Math.max(0, candRect.top - activeRect.bottom);
              const dx = Math.abs(candCenterX - activeCenterX);
              score = dy + dx * 2.5;
            }
          } else if (isUp) {
            if (candCenterY < activeCenterY - 2 || candRect.bottom <= activeRect.top + 5) {
              isDirectionValid = true;
              const dy = Math.max(0, activeRect.top - candRect.bottom);
              const dx = Math.abs(candCenterX - activeCenterX);
              score = dy + dx * 2.5;
            }
          }

          if (isDirectionValid && score < minScore) {
            minScore = score;
            bestCandidate = cand;
          }
        }

        if (bestCandidate) {
          bestCandidate.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHost, showEndSessionModal, showSessionInfoModal, showOverflowMenu, showLibrary]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('Fullscreen request failed:', err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(console.error);
      }
    }
  };

  // Generate QR code for guest join
  useEffect(() => {
    if (session?.roomCode) {
      const cleanCode = String(session.roomCode).replace(/\s+/g, '');
      const joinUrl = `${window.location.origin}/join?session=${cleanCode}`;
      QRCode.toDataURL(joinUrl, {
        width: 320,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => console.error('QR generation error:', err));
    }
  }, [session?.roomCode]);

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
        let data: any = {};
        if (res.headers.get('content-type')?.includes('application/json')) {
          try {
            data = await res.json();
          } catch (e) {
            console.error('Failed to parse validation JSON response:', e);
          }
        }

        if (!isMounted) return;

        if (res.ok && data.valid) {
          setSession(data.session);
          if (data.guestUsername) {
            setGuestUsername(data.guestUsername);
          }
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
        if (data.playback) {
          if (typeof data.playback.playing === 'boolean') {
            setPlaying(data.playback.playing);
          }
          if (data.playback.variant) {
            setVariant(data.playback.variant);
          }
          if (typeof data.playback.lyricOffset === 'number') {
            setLyricOffset(data.playback.lyricOffset);
          }
        }
      }
    } catch (e) {
      console.error('[STATE] Failed to fetch session state:', e);
    }
  };

  // 3. Connect WebSocket with auto-reconnect & state synchronization
  useEffect(() => {
    if (validationStatus !== 'valid' || !sessionId) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isClosedIntentionally = false;

    fetchState();

    function connect() {
      if (isClosedIntentionally) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/karaoke?sessionId=${sessionId}&isHost=${isHost}`);

      socket.onopen = () => {
        // Re-fetch authoritative state on connect/reconnect
        fetchState();
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch(msg.type) {
            case 'PING':
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'PONG' }));
              }
              break;
            case 'HEARTBEAT_ACK':
              break;
            case 'STATE_UPDATE':
              if (typeof msg.payload?.playing === 'boolean') setPlaying(msg.payload.playing);
              if (msg.payload?.variant) setVariant(msg.payload.variant);
              if (msg.payload?.lyricOffset !== undefined) setLyricOffset(msg.payload.lyricOffset);
              fetchState();
              break;
            case 'QUEUE_UPDATED':
            case 'QUEUE_EMPTY':
              fetchState();
              break;
            case 'PLAYING':
              setPlaying(true);
              break;
            case 'PAUSED':
              setPlaying(false);
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
              isClosedIntentionally = true;
              setValidationStatus('expired');
              setErrorMessage('The host has closed the session.');
              break;
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      socket.onclose = () => {
        if (!isClosedIntentionally && validationStatus === 'valid') {
          reconnectTimer = setTimeout(() => {
            connect();
          }, 2000);
        }
      };

      socket.onerror = () => {
        // Handled via onclose reconnect loop
      };

      setWs(socket);
    }

    connect();

    return () => {
      isClosedIntentionally = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [validationStatus, sessionId, isHost]);

  // 4. Host Heartbeat Loop to prevent session timeouts
  useEffect(() => {
    if (!isHost || validationStatus !== 'valid' || !sessionId) return;

    const sendHeartbeat = async () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() }));
        } catch (e) {
          // ignore
        }
      }
      try {
        await fetch(`/api/karaoke/sessions/${sessionId}/heartbeat`, { method: 'POST' });
      } catch (e) {
        // ignore network glitches
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 15000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
        fetchState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [isHost, validationStatus, sessionId, ws]);

  // Determine current song
  const currentSong = queue.find(q => q.status === 'playing') || queue.find(q => q.status === 'pending') || queue[0];

  // Fetch song details and lyrics whenever currentSong changes
  useEffect(() => {
    if (lastSongIdRef.current !== null && lastSongIdRef.current !== currentSong?.songId) {
      const currentSettings = getLyricsSettings();
      const currentJson = JSON.stringify(currentSettings);
      if (currentJson !== prevSettingsJsonRef.current && prevSettingsJsonRef.current !== '') {
        console.warn('[LyricSettings] WARNING: settings changed during song transition');
      }
    }
    lastSongIdRef.current = currentSong?.songId ?? null;

    if (currentSong?.songId) {
      fetch(`/api/songs/${currentSong.songId}`)
        .then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return null;
        })
        .then(data => {
          if (data) setCurrentSongDetails(data);
        })
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

  // Load songs for song picker modal (guests only)
  useEffect(() => {
    if (showLibrary) {
      fetch('/api/songs')
        .then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return [];
        })
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

  // Explicitly End Session (Host Only)
  const handleExplicitEndSession = async () => {
    setShowEndSessionModal(false);
    if (!sessionId) return;
    try {
      await fetch(`/api/karaoke/sessions/${sessionId}/end`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to end session:', e);
    }
    if (ws) {
      ws.close();
      setWs(null);
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlaying(false);
    setCurrentTime(0);
    setLyrics([]);
    setCurrentSongDetails(null);
    setQueue([]);
    setSession(null);
    setValidationStatus('expired');
  };

  // Start New Real Karaoke Session (Host Only)
  const handleStartNewSession = async () => {
    if (!isHost || isRestartingSession) return;
    setIsRestartingSession(true);
    try {
      if (ws) {
        ws.close();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlaying(false);
      setCurrentTime(0);
      setLyrics([]);
      setCurrentSongDetails(null);
      setQueue([]);

      const res = await fetch('/api/karaoke/sessions', { method: 'POST' });
      let newSession: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          newSession = await res.json();
        } catch (e) {
          console.error('Failed to parse new session response', e);
        }
      }
      if (!res.ok) throw new Error(newSession.error || 'Failed to create session');

      setSession(newSession);
      setValidationStatus('valid');
      navigate(`/rooms/${newSession.id}?role=host`, { replace: true });
    } catch (err) {
      console.error('Failed to start new session:', err);
      alert('Failed to start a new session. Please try again.');
    } finally {
      setIsRestartingSession(false);
    }
  };

  // Host Control actions
  const togglePlay = () => {
    if (!isHost) return;
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: nextPlaying ? 'PLAY' : 'PAUSE' }));
    }
  };

  const handleSkip = async () => {
    if (!isHost) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SKIP' }));
    } else if (sessionId) {
      try {
        await fetch(`/api/karaoke/sessions/${sessionId}/skip`, { method: 'POST' });
      } catch (e) {
        console.error('Failed to skip track via REST:', e);
      }
    }
    fetchState();
  };

  const handleRestart = () => {
    if (!isHost) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'RESTART' }));
    }
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
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
    
    if (ws && ws.readyState === WebSocket.OPEN) {
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'OFFSET_CHANGED', payload: { offset: newOffset } }));
    }
  };

  const handleSongEnded = async () => {
    if (!isHost) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SONG_FINISHED' }));
    } else if (sessionId) {
      try {
        await fetch(`/api/karaoke/sessions/${sessionId}/skip`, { method: 'POST' });
      } catch (e) {
        console.error('Failed to finish song via REST:', e);
      }
    }
    fetchState();
  };

  // Host Audio Playback Synchronization Effect
  useEffect(() => {
    if (!isHost || !audioRef.current || !currentSong) return;

    if (playing) {
      audioRef.current.play().catch(err => {
        console.warn('[AUDIO] Autoplay prevented or waiting for interaction:', err);
      });
    } else {
      audioRef.current.pause();
    }
  }, [playing, currentSong?.songId, variant, isHost]);

  const handleSeek = (e: ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Add song to queue from picker modal (Guests only)
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

  // Playback is considered active only when playing is true or currentTime has progressed significantly (>0.05s)
  const isPlaybackActive = playing || currentTime > 0.05;
  const adjustedTime = currentTime + (lyricOffset / 1000);

  // Active lyric index: only valid if playback has started AND adjustedTime has reached the first lyric's timestamp
  const firstLyricTime = lyrics[0]?.time ?? 0;
  let activeLyricIndex = -1;
  if (isPlaybackActive && lyrics.length > 0 && adjustedTime >= firstLyricTime) {
    activeLyricIndex = lyrics.findIndex((l, idx) => {
      const nextLine = lyrics[idx + 1];
      return adjustedTime >= l.time && (!nextLine || adjustedTime < nextLine.time);
    });
  }

  // Is highlighting active? True only if activeLyricIndex >= 0 AND highlight toggle in settings is enabled
  const isHighlighted = activeLyricIndex >= 0 && (lyricsSettings.highlightCurrentLine !== false);

  // Focus line index: when playing, points to activeLyricIndex; when waiting/idle/pre-intro, points to 0 (the first line preview)
  const focusIndex = activeLyricIndex >= 0 ? activeLyricIndex : 0;

  // Visible lines support (1, 3, or 5 lines)
  const visibleLinesCount = lyricsSettings.visibleLines ?? 3;

  // Compute surrounding lines based on focusIndex
  const prev2Line = focusIndex >= 2 ? lyrics[focusIndex - 2] : null;
  const prev1Line = focusIndex >= 1 ? lyrics[focusIndex - 1] : null;
  const currLine = lyrics.length > 0 ? (lyrics[focusIndex] || null) : null;
  const next1Line = focusIndex + 1 < lyrics.length ? lyrics[focusIndex + 1] : null;
  const next2Line = focusIndex + 2 < lyrics.length ? lyrics[focusIndex + 2] : null;
  const animDuration = lyricsSettings.animationDuration ?? 0.25;

  const filteredSongs = availableSongs.filter(s => {
    const q = searchQuery.toLowerCase();
    return s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q) || s.album?.toLowerCase().includes(q);
  });

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // -------------------------------------------------------------
  // Render: Loading State
  // -------------------------------------------------------------
  if (validationStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center shadow-lg shadow-[#FF4FA3]/20">
            <Music className="w-8 h-8 text-[#FF4FA3] animate-pulse" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">Connecting to Karaoke Room</h2>
          <p className="text-xs text-zinc-400">Synchronizing live lyrics and room session...</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Guest Room Experience
  // -------------------------------------------------------------
  if (!isHost) {
    return (
      <GuestRoom
        sessionId={sessionId!}
        roomCode={session?.roomCode || ''}
        guestUsername={guestUsername}
        controllerId={controllerId || ''}
        queue={queue}
        onRefreshState={fetchState}
        isSessionClosed={validationStatus !== 'valid' || session?.status === 'closed'}
      />
    );
  }

  // -------------------------------------------------------------
  // Render: Host Room - No Active Session View
  // -------------------------------------------------------------
  if (isHost && (validationStatus !== 'valid' || !session || session.status === 'closed')) {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans select-none relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#FF4FA3]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md bg-[#12131D] border border-white/10 rounded-3xl p-8 shadow-2xl text-center relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center mx-auto mb-5 text-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/20">
            <Mic className="w-8 h-8" />
          </div>

          <div className="text-[11px] font-extrabold uppercase tracking-widest text-[#FF4FA3] mb-1">
            HOST ROOM
          </div>

          <h2 className="text-2xl md:text-3xl font-black text-white mb-2 tracking-tight">
            No Active Session
          </h2>

          <p className="text-xs text-zinc-400 mb-8 leading-relaxed max-w-xs mx-auto">
            Start a new session to host karaoke, display your room QR code, and sync lyrics live with guests.
          </p>

          <button
            data-tv-id="start-session-button"
            onClick={handleStartNewSession}
            disabled={isRestartingSession}
            className="w-full py-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-base rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
          >
            <RefreshCw className={`w-5 h-5 ${isRestartingSession ? 'animate-spin' : ''}`} />
            <span>{isRestartingSession ? 'Creating Session...' : 'Start New Session'}</span>
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Guest Room - Error / Not Found / Expired States
  // -------------------------------------------------------------
  if (validationStatus !== 'valid') {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans select-none">
        <div className="w-full max-w-md bg-[#12131D] border border-white/10 rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-950/50 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">
            This room is no longer available.
          </h2>

          <p className="text-xs text-zinc-400 mb-8 leading-relaxed">
            Please ask the host for an active room QR code or link to join.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate('/join')}
              className="w-full py-3.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2"
            >
              <Mic className="w-4 h-4" />
              <span>Join A Room</span>
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
    <div className="flex h-screen bg-[#08090E] text-white overflow-hidden flex-col relative font-sans select-none">
      {/* Room Song Catalog / Add to Queue Modal (Guests Only) */}
      {!isHost && showLibrary && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-3xl bg-[#12131D] border border-white/10 rounded-3xl flex flex-col h-[85vh] shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-white/5 bg-[#0D0E17] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 rounded-xl text-[#FF4FA3]">
                  <LibraryIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Song Catalog</h2>
                  <p className="text-xs text-zinc-400">Search and queue songs to the live room</p>
                </div>
              </div>
              <button 
                data-tv-id="library-close"
                onClick={() => setShowLibrary(false)}
                className="p-2 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors focus:outline-none focus:ring-4 focus:ring-[#FF4FA3]"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-white/5 bg-[#0F101A] shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input 
                  data-tv-id="library-search"
                  type="text"
                  placeholder="Search song title, artist, or album..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-2 focus:ring-[#FF4FA3]"
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
                    className="p-3.5 bg-[#0D0E17] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 flex items-center justify-center shrink-0">
                        <Music className="w-5 h-5 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
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
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
                          LRC
                        </span>
                      )}
                      <button
                        onClick={() => handleAddSongToQueue(song.id)}
                        disabled={isAdding || isAdded}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                          isAdded 
                            ? 'bg-[#FF4FA3] text-white' 
                            : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
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

      {/* Top Room Navigation Bar */}
      <header className="px-4 md:px-6 py-3 border-b border-white/5 bg-[#0D0E17]/95 backdrop-blur-md flex items-center justify-between relative z-50 shrink-0 select-none">
        {/* Left Side: ↻ Start New Session, Room Code, [ LIVE ] */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          {/* ↻ Start New Session Button */}
          {isHost ? (
            <button 
              data-tv-id="header-start-session-button"
              onClick={handleStartNewSession}
              disabled={isRestartingSession}
              className="p-2 bg-white/5 hover:bg-[#FF4FA3]/20 hover:text-[#FF4FA3] text-zinc-300 rounded-xl transition-all border border-white/10 flex items-center justify-center shrink-0 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
              title="Start New Session"
            >
              <RefreshCw className={`w-4 h-4 ${isRestartingSession ? 'animate-spin text-[#FF4FA3]' : ''}`} />
            </button>
          ) : (
            <button 
              onClick={() => navigate(session?.roomCode ? `/join?session=${session.roomCode.replace(/\s+/g, '')}` : '/join')}
              className="p-2 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors shrink-0"
              title="Re-join / Change Name"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          
          {/* Room Code */}
          <span className="text-base md:text-xl font-mono font-black text-white tracking-widest shrink-0">
            {session?.roomCode}
          </span>

          {/* [ LIVE ] Badge */}
          <span className="px-2.5 py-0.5 rounded-full bg-[#FF4FA3]/15 text-[#FF4FA3] text-[11px] font-bold border border-[#FF4FA3]/30 flex items-center gap-1.5 shrink-0 uppercase tracking-wider">
            <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
          </span>
        </div>

        {/* Right Side: Instrumental Toggle, Offset Controls, Fullscreen */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isHost && (
            <>
              {/* Instrumental Toggle in Top Navigation */}
              <button 
                data-tv-id="inst-toggle-button"
                onClick={handleToggleInstrumental}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E] ${
                  variant === 'instrumental' 
                    ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25' 
                    : 'bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10'
                }`}
                title="Switch between Original Vocal and Instrumental backing track"
              >
                <Music className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Inst:</span> {variant === 'instrumental' ? 'ON' : 'OFF'}
              </button>

              {/* Offset Tuner in Top Navigation */}
              <div className="hidden sm:flex items-center gap-1 bg-[#08090E] px-2 py-1 rounded-xl border border-white/10 text-xs">
                <span className="text-zinc-500 text-[11px] font-medium hidden md:inline pl-1">Offset</span>
                <button 
                  data-tv-id="offset-minus-button"
                  onClick={() => handleOffsetChange(-250)}
                  className="px-1.5 py-0.5 bg-[#181926] hover:bg-[#222436] text-zinc-300 hover:text-white rounded text-[10px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                  title="-250ms"
                >
                  -250ms
                </button>
                <span className="px-1.5 font-mono text-[#FF4FA3] font-bold text-[11px]">
                  {lyricOffset > 0 ? `+${lyricOffset}` : lyricOffset}ms
                </span>
                <button 
                  data-tv-id="offset-plus-button"
                  onClick={() => handleOffsetChange(250)}
                  className="px-1.5 py-0.5 bg-[#181926] hover:bg-[#222436] text-zinc-300 hover:text-white rounded text-[10px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                  title="+250ms"
                >
                  +250ms
                </button>
              </div>
            </>
          )}

          {/* Fullscreen Toggle Button */}
          <button
            data-tv-id="fullscreen-toggle-button"
            onClick={toggleFullscreen}
            className="p-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Overflow Menu Button [ ⋮ ] (Host Only) */}
          {isHost && (
            <div className="relative z-50">
              <button
                data-tv-id="overflow-menu-button"
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="p-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
                title="Session Options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {/* Overflow Dropdown Menu */}
              <AnimatePresence>
                {showOverflowMenu && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowOverflowMenu(false)} 
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -5 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -5 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-48 bg-[#12131D] border border-white/10 rounded-2xl shadow-2xl py-2 z-50 overflow-hidden text-sm"
                    >
                      <button
                        data-tv-id="menu-session-info"
                        onClick={() => {
                          setShowOverflowMenu(false);
                          setShowSessionInfoModal(true);
                        }}
                        className="w-full px-4 py-2.5 text-left text-zinc-300 hover:text-white hover:bg-white/5 flex items-center gap-2.5 transition-colors font-medium focus:outline-none focus:bg-[#FF4FA3]/20 focus:text-white cursor-pointer"
                      >
                        <Info className="w-4 h-4 text-zinc-400" />
                        <span>Session Info</span>
                      </button>
                      <div className="border-t border-white/5 my-1" />
                      <button
                        data-tv-id="menu-end-session"
                        onClick={() => {
                          setShowOverflowMenu(false);
                          setShowEndSessionModal(true);
                        }}
                        className="w-full px-4 py-2.5 text-left text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2.5 transition-colors font-semibold focus:outline-none focus:bg-red-500/20 focus:text-red-300 cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 text-red-400" />
                        <span>End Session</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden relative w-full h-full">
        {/* Main Stage: Vertically Top-Aligned, Horizontally Centered inside Lyrics Area */}
        <main className="h-full flex flex-col justify-between relative overflow-hidden bg-gradient-to-b from-[#0B0C14] via-[#08090E] to-[#08090E] landscape:w-[80%] portrait:w-full w-full shrink-0 transition-all">
          {/* Subtle Ambient Glow */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[550px] h-[550px] bg-[#FF4FA3]/5 rounded-full blur-[140px] pointer-events-none" />

          {/* Top-Aligned Lyrics Stage (Dominant 80% width in landscape, 100% full screen in portrait) */}
          <div className="w-full flex-1 flex flex-col justify-start pt-6 sm:pt-10 md:pt-14 lg:pt-16 px-4 sm:px-8 z-10 overflow-hidden">
            {currentSong ? (
              lyrics.length > 0 ? (
                /* Dynamic Karaoke Lyric Display (Top-aligned, User-configurable Alignment, Lines & Appearance) */
                <div className={`w-full max-w-4xl mx-auto flex flex-col space-y-3 sm:space-y-4 md:space-y-6 select-none ${getAlignmentClass(lyricsSettings.alignment)}`}>
                  {/* Line -2 (if 5 lines mode) */}
                  {visibleLinesCount === 5 && (
                    <div className={`min-h-[1.75rem] md:min-h-[2.5rem] flex items-center w-full ${
                      lyricsSettings.alignment === 'left' ? 'justify-start' : lyricsSettings.alignment === 'right' ? 'justify-end' : 'justify-center'
                    }`}>
                      <AnimatePresence mode="wait">
                        {prev2Line ? (
                          <motion.p
                            key={`prev2-${prev2Line.time}-${prev2Line.text}`}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: (lyricsSettings.unhighlighted.opacity ?? 0.45) * 0.6, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: animDuration, ease: 'easeOut' }}
                            style={{
                              fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                              fontSize: `${Math.max(12, lyricsSettings.unhighlighted.size - 2)}px`,
                              fontWeight: lyricsSettings.unhighlighted.weight,
                              color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                              letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                              lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                              textAlign: lyricsSettings.alignment
                            }}
                            className="transition-all"
                          >
                            {applyTextCase(prev2Line.text, lyricsSettings.unhighlighted.textCase)}
                          </motion.p>
                        ) : (
                          <div className="h-4" />
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Line -1: Previous Lyric (if 3 or 5 lines mode) */}
                  {visibleLinesCount >= 3 && (
                    <div className={`min-h-[2.5rem] md:min-h-[3.5rem] flex items-center w-full ${
                      lyricsSettings.alignment === 'left' ? 'justify-start' : lyricsSettings.alignment === 'right' ? 'justify-end' : 'justify-center'
                    }`}>
                      <AnimatePresence mode="wait">
                        {prev1Line ? (
                          <motion.p
                            key={`prev1-${prev1Line.time}-${prev1Line.text}`}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: lyricsSettings.unhighlighted.opacity ?? 0.45, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: animDuration, ease: 'easeOut' }}
                            style={{
                              fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                              fontSize: `${lyricsSettings.unhighlighted.size}px`,
                              fontWeight: lyricsSettings.unhighlighted.weight,
                              color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                              letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                              lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                              textAlign: lyricsSettings.alignment
                            }}
                            className="transition-all"
                          >
                            {applyTextCase(prev1Line.text, lyricsSettings.unhighlighted.textCase)}
                          </motion.p>
                        ) : (
                          <div className="h-6" />
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Line 0: Current Lyric (Highlighted if active, Unhighlighted if waiting/idle) */}
                  <div className={`min-h-[3.5rem] sm:min-h-[5rem] md:min-h-[6.5rem] flex items-center w-full px-2 ${
                    lyricsSettings.alignment === 'left' ? 'justify-start' : lyricsSettings.alignment === 'right' ? 'justify-end' : 'justify-center'
                  }`}>
                    <AnimatePresence mode="wait">
                      {currLine ? (
                        <motion.p
                          key={`curr-${currLine.time}-${currLine.text}-${isHighlighted}`}
                          initial={{ opacity: 0, scale: isHighlighted ? 0.96 : 1, y: isHighlighted ? 6 : 0 }}
                          animate={{ 
                            opacity: isHighlighted ? (lyricsSettings.highlighted.opacity ?? 1.0) : (lyricsSettings.unhighlighted.opacity ?? 0.45), 
                            scale: 1, 
                            y: 0 
                          }}
                          exit={{ opacity: 0, scale: isHighlighted ? 1.02 : 1, y: -6 }}
                          transition={{ duration: animDuration, ease: 'easeOut' }}
                          style={{
                            fontFamily: isHighlighted ? getFontFamilyStyle(lyricsSettings.highlighted.font) : getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                            fontSize: `${isHighlighted ? lyricsSettings.highlighted.size : lyricsSettings.unhighlighted.size}px`,
                            fontWeight: isHighlighted ? lyricsSettings.highlighted.weight : lyricsSettings.unhighlighted.weight,
                            color: isHighlighted ? (lyricsSettings.highlighted.color || '#FF4FA3') : (lyricsSettings.unhighlighted.color || '#d4d4d8'),
                            letterSpacing: `${isHighlighted ? lyricsSettings.highlighted.letterSpacing : lyricsSettings.unhighlighted.letterSpacing}px`,
                            lineHeight: isHighlighted ? lyricsSettings.highlighted.lineSpacing : lyricsSettings.unhighlighted.lineSpacing,
                            textAlign: lyricsSettings.alignment,
                            textShadow: isHighlighted ? `0 0 35px ${(lyricsSettings.highlighted.color || '#FF4FA3')}75` : 'none'
                          }}
                          className="transition-all"
                        >
                          {applyTextCase(currLine.text || '♪ ♪ ♪', isHighlighted ? lyricsSettings.highlighted.textCase : lyricsSettings.unhighlighted.textCase)}
                        </motion.p>
                      ) : (
                        <p className="text-zinc-600 text-xl md:text-3xl font-bold">♪ ♪ ♪</p>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Line +1: Next Lyric (if 3 or 5 lines mode) */}
                  {visibleLinesCount >= 3 && (
                    <div className={`min-h-[2.5rem] md:min-h-[3.5rem] flex items-center w-full ${
                      lyricsSettings.alignment === 'left' ? 'justify-start' : lyricsSettings.alignment === 'right' ? 'justify-end' : 'justify-center'
                    }`}>
                      <AnimatePresence mode="wait">
                        {next1Line ? (
                          <motion.p
                            key={`next1-${next1Line.time}-${next1Line.text}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: lyricsSettings.unhighlighted.opacity ?? 0.45, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: animDuration, ease: 'easeOut' }}
                            style={{
                              fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                              fontSize: `${lyricsSettings.unhighlighted.size}px`,
                              fontWeight: lyricsSettings.unhighlighted.weight,
                              color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                              letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                              lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                              textAlign: lyricsSettings.alignment
                            }}
                            className="transition-all"
                          >
                            {applyTextCase(next1Line.text, lyricsSettings.unhighlighted.textCase)}
                          </motion.p>
                        ) : (
                          <div className="h-6" />
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Line +2 (if 5 lines mode) */}
                  {visibleLinesCount === 5 && (
                    <div className={`min-h-[1.75rem] md:min-h-[2.5rem] flex items-center w-full ${
                      lyricsSettings.alignment === 'left' ? 'justify-start' : lyricsSettings.alignment === 'right' ? 'justify-end' : 'justify-center'
                    }`}>
                      <AnimatePresence mode="wait">
                        {next2Line ? (
                          <motion.p
                            key={`next2-${next2Line.time}-${next2Line.text}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: (lyricsSettings.unhighlighted.opacity ?? 0.45) * 0.6, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: animDuration, ease: 'easeOut' }}
                            style={{
                              fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font),
                              fontSize: `${Math.max(12, lyricsSettings.unhighlighted.size - 2)}px`,
                              fontWeight: lyricsSettings.unhighlighted.weight,
                              color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                              letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                              lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                              textAlign: lyricsSettings.alignment
                            }}
                            className="transition-all"
                          >
                            {applyTextCase(next2Line.text, lyricsSettings.unhighlighted.textCase)}
                          </motion.p>
                        ) : (
                          <div className="h-4" />
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              ) : (
                /* Fallback when no synced LRC is available */
                <div className="text-center z-10 py-8 px-6 flex flex-col items-center max-w-2xl mx-auto">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5 shadow-xl">
                    <Mic className="w-7 h-7 text-[#FF4FA3] animate-pulse" />
                  </div>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
                    {currentSong.songTitle}
                  </h2>
                  <p className="text-base sm:text-lg text-zinc-400 font-medium mb-4">
                    {currentSong.artistName}
                  </p>
                  <div className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-zinc-400 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-zinc-500" />
                    <span>Instrumental / plain audio playback (No synchronized LRC lyrics available)</span>
                  </div>
                </div>
              )
            ) : (
              /* Queue is Empty State (Clean & Centered) */
              <div className="text-center z-10 py-12 px-6 max-w-md mx-auto flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-3xl bg-[#12131D] border border-white/10 flex items-center justify-center mx-auto mb-5 shadow-xl">
                  <Music className="w-8 h-8 text-[#FF4FA3]" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">Queue is Empty</h2>
                <p className="text-zinc-400 text-xs md:text-sm leading-relaxed">
                  Waiting for someone to choose a song...
                </p>
              </div>
            )}
          </div>

          {/* Centered Playback Controls & Timeline (Horizontally centered in lyrics area) */}
          {isHost ? (
            <div className="w-full z-20 pb-4 sm:pb-6 px-4">
              <div className="max-w-xl mx-auto flex flex-col items-center space-y-3">
                {/* Timeline Progress Slider */}
                {currentSong && (
                  <div className="w-full flex items-center gap-3 px-2">
                    <span className="text-[11px] font-mono text-zinc-500 w-10 text-right">
                      {formatTime(currentTime)}
                    </span>
                    <input
                      data-tv-id="timeline-slider"
                      type="range"
                      min="0"
                      max={duration || 100}
                      step="0.1"
                      value={currentTime}
                      onChange={handleSeek}
                      className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3] focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                    />
                    <span className="text-[11px] font-mono text-zinc-500 w-10">
                      {formatTime(duration)}
                    </span>
                  </div>
                )}

                {/* Bottom Controls: [ ↶ ] [ ▶ ] [ ⏭ ] */}
                <div className="flex items-center gap-5">
                  <button 
                    data-tv-id="restart-button"
                    onClick={handleRestart}
                    disabled={!currentSong}
                    className="p-3 bg-[#181926] hover:bg-[#222436] text-white rounded-full transition-all disabled:opacity-30 border border-white/10 hover:scale-105 active:scale-95 shadow-md focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
                    title="Restart Track"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  
                  <button 
                    ref={playButtonRef}
                    data-tv-id="play-button"
                    onClick={togglePlay}
                    disabled={!currentSong}
                    className="w-14 h-14 bg-white hover:bg-zinc-200 text-black rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl disabled:opacity-30 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E] focus:scale-110 focus:shadow-[0_0_35px_rgba(255,79,163,0.9)]"
                    title={playing ? 'Pause' : 'Play'}
                  >
                    {playing ? <Pause className="w-6 h-6 fill-black" /> : <Play className="w-6 h-6 fill-black ml-0.5" />}
                  </button>

                  <button 
                    data-tv-id="skip-button"
                    onClick={handleSkip}
                    disabled={!currentSong}
                    className="p-3 bg-[#181926] hover:bg-[#222436] text-white rounded-full transition-all disabled:opacity-30 border border-white/10 hover:scale-105 active:scale-95 shadow-md focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
                    title="Skip Track"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Singer / Guest Controller Action Bar */
            <div className="p-4 bg-[#0D0E17] border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 z-20">
              <button
                onClick={() => setShowLibrary(true)}
                className="w-full sm:w-auto px-6 py-3 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#FF4FA3]/25"
              >
                <LibraryIcon className="w-5 h-5" />
                <span>Browse & Queue Songs</span>
              </button>
              <div className="text-xs text-zinc-500 font-medium text-center">
                Lyrics synchronized live with karaoke host
              </div>
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
        </main>

        {/* Floating Join Room / Queue Card Area (Landscape = 20% width, Portrait = Hidden) */}
        {isHost && (
          <aside className="hidden landscape:flex portrait:hidden flex-col h-full landscape:w-[20%] min-w-[210px] max-w-[320px] bg-[#0A0B12]/80 backdrop-blur-xl border-l border-white/10 p-3 lg:p-4 gap-3 lg:gap-4 shadow-2xl z-20 select-none overflow-hidden shrink-0">
            {/* Card 1: Join Session / QR Code Card */}
            <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-3.5 lg:p-4 shadow-xl flex flex-col items-center shrink-0">
              {/* Ambient Glow matching Homepage Feature Card */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#FF4FA3]/15 rounded-full blur-2xl pointer-events-none -mr-10 -mt-10" />

              <div className="relative z-10 flex flex-col items-center w-full">
                {/* Header Pill */}
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-[10px] font-bold uppercase tracking-wider mb-2.5">
                  <QrCode className="w-3 h-3" />
                  <span>Join Session</span>
                </div>

                {/* QR Code Container */}
                {qrCodeDataUrl ? (
                  <div className="bg-white p-2 rounded-xl shadow-md mx-auto w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center">
                    <img 
                      src={qrCodeDataUrl} 
                      alt="Join Room QR Code" 
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <span className="text-[10px] text-zinc-500 font-mono">Loading QR...</span>
                  </div>
                )}

                {/* Session Code */}
                <div className="text-sm md:text-base font-mono font-black text-white tracking-widest mt-2 text-center">
                  {session?.roomCode}
                </div>

                {/* Subtitle */}
                <div className="text-[10px] text-zinc-400 font-medium text-center mt-0.5">
                  Scan to Join & Queue
                </div>
              </div>
            </div>

            {/* Card 2: UP NEXT Queue Card */}
            <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-3.5 lg:p-4 shadow-xl flex-1 flex flex-col min-h-0">
              {/* Subtle Ambient Glow */}
              <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FF4FA3]/10 rounded-full blur-2xl pointer-events-none -mr-10 -mb-10" />

              {/* Queue Header */}
              <div className="relative z-10 flex items-center justify-between px-0.5 mb-2.5 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white tracking-wide">
                  <Music className="w-3.5 h-3.5 text-[#FF4FA3]" />
                  <span>UP NEXT</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 border border-white/5 font-mono font-bold text-zinc-300">
                  {queue.length}
                </span>
              </div>

              {/* Scrollable Queue Items */}
              <div className="relative z-10 flex-1 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin min-h-0">
                {queue.map((item, index) => {
                  const isPlaying = item.status === 'playing' || index === 0;
                  const singerName = item.userName || (item.userId ? `Singer ${item.userId}` : 'Guest');

                  return (
                    <div 
                      key={item.id || index}
                      className={`p-2.5 rounded-xl border transition-all ${
                        isPlaying 
                          ? 'bg-[#1e192c] border-[#FF4FA3]/40 shadow-sm' 
                          : 'bg-[#10121d]/80 hover:bg-[#151726] border-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <h4 className="font-bold text-xs text-white truncate flex-1">
                          {item.songTitle}
                        </h4>
                        {isPlaying && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-[#FF4FA3] text-white shrink-0">
                            Live
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {singerName}
                      </p>
                    </div>
                  );
                })}

                {queue.length === 0 && (
                  <div className="py-6 text-center text-zinc-500">
                    <p className="text-xs font-medium">Queue is empty</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">Scan to add songs</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Confirmation Modal: End Session */}
      <AnimatePresence>
        {showEndSessionModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-sm bg-[#12131D] border border-white/10 rounded-3xl p-6 shadow-2xl text-center relative overflow-hidden"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
                <LogOut className="w-6 h-6" />
              </div>

              <h3 className="text-xl font-bold text-white mb-2">End this session?</h3>
              <p className="text-xs text-zinc-400 leading-relaxed mb-6">
                All guests will be disconnected and the queue will be cleared.
              </p>

              <div className="flex items-center gap-3">
                <button
                  data-tv-id="end-session-cancel"
                  onClick={() => setShowEndSessionModal(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-zinc-300 font-semibold text-sm rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3]"
                >
                  Cancel
                </button>
                <button
                  data-tv-id="end-session-confirm"
                  onClick={handleExplicitEndSession}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-red-600/25 focus:outline-none focus:ring-4 focus:ring-red-400"
                >
                  End Session
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Info Modal: Session Info */}
      <AnimatePresence>
        {showSessionInfoModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-sm bg-[#12131D] border border-white/10 rounded-3xl p-6 shadow-2xl text-center relative overflow-hidden"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] flex items-center justify-center mx-auto mb-3">
                <Info className="w-5 h-5" />
              </div>

              <h3 className="text-lg font-bold text-white mb-1">Session Info</h3>
              <p className="text-xs text-zinc-400 mb-4">Active Karaoke Session Details</p>

              <div className="bg-[#08090E] border border-white/10 rounded-2xl p-4 text-left space-y-3 mb-6 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Room Code:</span>
                  <span className="font-mono font-bold text-white text-sm">{session?.roomCode}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Status:</span>
                  <span className="text-[#FF4FA3] font-bold uppercase tracking-wider text-[11px]">ACTIVE</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Queue Length:</span>
                  <span className="text-zinc-300 font-semibold">{queue.length} items</span>
                </div>
              </div>

              <button
                data-tv-id="session-info-close"
                onClick={() => setShowSessionInfoModal(false)}
                className="w-full py-3 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3]"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
