import { useState, useEffect, FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  Plus, Folder, RefreshCw, Trash2, AlertCircle, HardDrive, 
  ShieldCheck, Type, AlignLeft, AlignCenter, AlignRight, RotateCcw, Sparkles, Download, Save, Check 
} from 'lucide-react';
import { 
  getLyricsSettings, 
  saveLyricsSettings, 
  DEFAULT_LYRICS_SETTINGS, 
  LyricsAppearanceSettings, 
  applyTextCase, 
  getFontFamilyClass, 
  getAlignmentClass 
} from '../utils/lyricsSettings';

export default function Settings() {
  const context = useOutletContext<{ user: any }>();
  const user = context?.user;

  // Media Libraries State
  const [libraries, setLibraries] = useState<any[]>([]);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [libToRemove, setLibToRemove] = useState<any>(null);
  const [scanningId, setScanningId] = useState<number | null>(null);

  // Lyrics Appearance State
  const [lyricsSettings, setLyricsSettings] = useState<LyricsAppearanceSettings>(getLyricsSettings);
  const [activeTab, setActiveTab] = useState<'highlighted' | 'unhighlighted' | 'layout'>('highlighted');

  // Downloader Settings State
  const [dlSettings, setDlSettings] = useState({
    libraryId: '',
    format: 'mp3',
    quality: '320k',
    embedMetadata: true,
    embedArtwork: true,
    folderStructure: '{artist}/{album}/{track_number} - {title}',
    playlistFolder: true,
  });
  const [savingDlSettings, setSavingDlSettings] = useState(false);
  const [dlSavedMessage, setDlSavedMessage] = useState('');

  useEffect(() => {
    fetchLibraries();
    fetchDlSettings();
  }, []);

  const fetchDlSettings = async () => {
    try {
      const res = await fetch('/api/downloader/settings');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setDlSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch downloader settings:', e);
    }
  };

  const saveDlSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingDlSettings(true);
    setDlSavedMessage('');
    try {
      const res = await fetch('/api/downloader/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dlSettings),
      });
      if (res.ok) {
        setDlSavedMessage('Downloader settings saved successfully!');
        setTimeout(() => setDlSavedMessage(''), 3000);
      } else {
        alert('Failed to save downloader settings.');
      }
    } catch (err) {
      alert('Error saving downloader settings.');
    } finally {
      setSavingDlSettings(false);
    }
  };

  const fetchLibraries = async () => {
    try {
      const res = await fetch('/api/libraries');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        setLibraries(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch libraries:', e);
    }
  };

  const addLibrary = async (e: FormEvent) => {
    e.preventDefault();
    if (!newLibName || !newLibPath) return;
    
    await fetch('/api/libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newLibName, path: newLibPath })
    });
    setNewLibName('');
    setNewLibPath('');
    fetchLibraries();
  };

  const removeLibrary = async () => {
    if (!libToRemove) return;
    try {
      const res = await fetch(`/api/libraries/${libToRemove.id}`, { method: 'DELETE' });
      if (res.ok) {
        setLibToRemove(null);
        fetchLibraries();
      } else {
        const data = await res.json();
        alert(`Failed to remove library: ${data.error}`);
      }
    } catch (err) {
      alert('Error removing library.');
    }
  };

  const scanLibrary = async (id: number) => {
    setScanningId(id);
    await fetch(`/api/libraries/${id}/scan`, { method: 'POST' });
    setTimeout(() => {
      setScanningId(null);
      fetchLibraries();
    }, 2000);
  };

  // Update & Persist Lyrics Appearance Settings
  const updateSetting = (updater: (prev: LyricsAppearanceSettings) => LyricsAppearanceSettings) => {
    const updated = updater(lyricsSettings);
    setLyricsSettings(updated);
    saveLyricsSettings(updated);
  };

  const resetLyricsToDefault = () => {
    setLyricsSettings(DEFAULT_LYRICS_SETTINGS);
    saveLyricsSettings(DEFAULT_LYRICS_SETTINGS);
  };

  return (
    <div className="p-4 md:p-10 max-w-5xl mx-auto space-y-10 font-sans select-none">
      {/* Settings Title */}
      <div>
        <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Settings</h1>
        <p className="text-xs md:text-sm text-zinc-400 mt-1">
          Customize live lyrics appearance, text styles, and media library configurations.
        </p>
      </div>

      {/* ========================================================= */}
      {/* SECTION: LYRICS APPEARANCE SETTINGS                       */}
      {/* ========================================================= */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-xl">
              <Type className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Lyrics Appearance</h2>
              <p className="text-xs text-zinc-400">Control font, size, weight, alignment, and spacing for host lyrics</p>
            </div>
          </div>

          <button
            onClick={resetLyricsToDefault}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-1.5 transition-colors"
            title="Reset to default appearance"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Defaults</span>
          </button>
        </div>

        {/* Live Preview Box */}
        <div className="bg-[#08090E] border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[190px] shadow-2xl relative overflow-hidden">
          <div className="absolute top-3 left-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#FF4FA3]">
            <Sparkles className="w-3 h-3" />
            <span>LIVE PREVIEW</span>
          </div>

          <div className={`w-full flex flex-col my-auto space-y-2 max-w-xl ${getAlignmentClass(lyricsSettings.alignment)}`}>
            {/* Previous Line (Unhighlighted) */}
            <p
              style={{
                fontSize: `${lyricsSettings.unhighlighted.size}px`,
                fontWeight: lyricsSettings.unhighlighted.weight,
                letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                opacity: lyricsSettings.unhighlighted.opacity ?? 0.4,
                textAlign: lyricsSettings.alignment
              }}
              className={`${getFontFamilyClass(lyricsSettings.unhighlighted.font)} text-zinc-300 transition-all`}
            >
              {applyTextCase('Previous lyric', lyricsSettings.unhighlighted.textCase)}
            </p>

            {/* Current Line (Highlighted) */}
            <p
              style={{
                fontSize: `${lyricsSettings.highlighted.size}px`,
                fontWeight: lyricsSettings.highlighted.weight,
                letterSpacing: `${lyricsSettings.highlighted.letterSpacing}px`,
                lineHeight: lyricsSettings.highlighted.lineSpacing,
                textAlign: lyricsSettings.alignment
              }}
              className={`${getFontFamilyClass(lyricsSettings.highlighted.font)} text-[#FF4FA3] drop-shadow-[0_0_25px_rgba(255,79,163,0.45)] transition-all`}
            >
              {applyTextCase('CURRENT LYRIC', lyricsSettings.highlighted.textCase)}
            </p>

            {/* Next Line (Unhighlighted) */}
            <p
              style={{
                fontSize: `${lyricsSettings.unhighlighted.size}px`,
                fontWeight: lyricsSettings.unhighlighted.weight,
                letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                opacity: lyricsSettings.unhighlighted.opacity ?? 0.4,
                textAlign: lyricsSettings.alignment
              }}
              className={`${getFontFamilyClass(lyricsSettings.unhighlighted.font)} text-zinc-300 transition-all`}
            >
              {applyTextCase('Next lyric', lyricsSettings.unhighlighted.textCase)}
            </p>
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('highlighted')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'highlighted'
                ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/25'
                : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            CURRENT / HIGHLIGHTED
          </button>
          <button
            onClick={() => setActiveTab('unhighlighted')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'unhighlighted'
                ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/25'
                : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            OTHER / UNHIGHLIGHTED
          </button>
          <button
            onClick={() => setActiveTab('layout')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'layout'
                ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/25'
                : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            LAYOUT & ALIGNMENT
          </button>
        </div>

        {/* Controls Body */}
        <div className="bg-[#12131D] border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl">
          {/* TAB 1: CURRENT / HIGHLIGHTED SETTINGS */}
          {activeTab === 'highlighted' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Font */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Font
                </label>
                <select
                  value={lyricsSettings.highlighted.font}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      highlighted: { ...prev.highlighted, font: e.target.value }
                    }))
                  }
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="system">Default / System</option>
                  <option value="sans">Sans-Serif</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Monospace</option>
                  <option value="display">Display / Impact</option>
                  <option value="rounded">Rounded</option>
                </select>
              </div>

              {/* Weight */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Weight
                </label>
                <select
                  value={lyricsSettings.highlighted.weight}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      highlighted: { ...prev.highlighted, weight: e.target.value }
                    }))
                  }
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="100">Thin (100)</option>
                  <option value="300">Light (300)</option>
                  <option value="400">Regular (400)</option>
                  <option value="500">Medium (500)</option>
                  <option value="600">Semi Bold (600)</option>
                  <option value="700">Bold (700)</option>
                  <option value="800">Extra Bold (800)</option>
                  <option value="900">Black (900)</option>
                </select>
              </div>

              {/* Size */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Size
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.highlighted.size}px
                  </span>
                </div>
                <input
                  type="range"
                  min="24"
                  max="80"
                  value={lyricsSettings.highlighted.size}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      highlighted: { ...prev.highlighted, size: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>

              {/* Text Case */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Text Case
                </label>
                <select
                  value={lyricsSettings.highlighted.textCase}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      highlighted: {
                        ...prev.highlighted,
                        textCase: e.target.value as any
                      }
                    }))
                  }
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="original">Original</option>
                  <option value="lowercase">lowercase</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="titlecase">Title Case</option>
                </select>
              </div>

              {/* Letter Spacing */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Letter Spacing
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.highlighted.letterSpacing}px
                  </span>
                </div>
                <input
                  type="range"
                  min="-4"
                  max="12"
                  value={lyricsSettings.highlighted.letterSpacing}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      highlighted: { ...prev.highlighted, letterSpacing: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>

              {/* Line Spacing */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Line Spacing
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.highlighted.lineSpacing}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="2.2"
                  step="0.05"
                  value={lyricsSettings.highlighted.lineSpacing}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      highlighted: { ...prev.highlighted, lineSpacing: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>
            </div>
          )}

          {/* TAB 2: OTHER / UNHIGHLIGHTED SETTINGS */}
          {activeTab === 'unhighlighted' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Font */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Font
                </label>
                <select
                  value={lyricsSettings.unhighlighted.font}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: { ...prev.unhighlighted, font: e.target.value }
                    }))
                  }
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="system">Default / System</option>
                  <option value="sans">Sans-Serif</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Monospace</option>
                  <option value="display">Display / Impact</option>
                  <option value="rounded">Rounded</option>
                </select>
              </div>

              {/* Weight */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Weight
                </label>
                <select
                  value={lyricsSettings.unhighlighted.weight}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: { ...prev.unhighlighted, weight: e.target.value }
                    }))
                  }
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="100">Thin (100)</option>
                  <option value="300">Light (300)</option>
                  <option value="400">Regular (400)</option>
                  <option value="500">Medium (500)</option>
                  <option value="600">Semi Bold (600)</option>
                  <option value="700">Bold (700)</option>
                  <option value="800">Extra Bold (800)</option>
                  <option value="900">Black (900)</option>
                </select>
              </div>

              {/* Size */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Size
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.unhighlighted.size}px
                  </span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="44"
                  value={lyricsSettings.unhighlighted.size}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: { ...prev.unhighlighted, size: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>

              {/* Opacity */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Opacity
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {Math.round((lyricsSettings.unhighlighted.opacity ?? 0.4) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="1.0"
                  step="0.05"
                  value={lyricsSettings.unhighlighted.opacity ?? 0.4}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: { ...prev.unhighlighted, opacity: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>

              {/* Text Case */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Text Case
                </label>
                <select
                  value={lyricsSettings.unhighlighted.textCase}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: {
                        ...prev.unhighlighted,
                        textCase: e.target.value as any
                      }
                    }))
                  }
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="original">Original</option>
                  <option value="lowercase">lowercase</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="titlecase">Title Case</option>
                </select>
              </div>

              {/* Letter Spacing */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Letter Spacing
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.unhighlighted.letterSpacing}px
                  </span>
                </div>
                <input
                  type="range"
                  min="-4"
                  max="12"
                  value={lyricsSettings.unhighlighted.letterSpacing}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: { ...prev.unhighlighted, letterSpacing: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>

              {/* Line Spacing */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Line Spacing
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.unhighlighted.lineSpacing}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="2.2"
                  step="0.05"
                  value={lyricsSettings.unhighlighted.lineSpacing}
                  onChange={(e) =>
                    updateSetting((prev) => ({
                      ...prev,
                      unhighlighted: { ...prev.unhighlighted, lineSpacing: Number(e.target.value) }
                    }))
                  }
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                />
              </div>
            </div>
          )}

          {/* TAB 3: LAYOUT & TEXT ALIGNMENT SETTINGS */}
          {activeTab === 'layout' && (
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-3">
                  Text Alignment
                </label>
                <div className="grid grid-cols-3 gap-3 max-w-md">
                  <button
                    onClick={() =>
                      updateSetting((prev) => ({ ...prev, alignment: 'left' }))
                    }
                    className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${
                      lyricsSettings.alignment === 'left'
                        ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                        : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <AlignLeft className="w-5 h-5" />
                    <span>Left</span>
                  </button>

                  <button
                    onClick={() =>
                      updateSetting((prev) => ({ ...prev, alignment: 'center' }))
                    }
                    className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${
                      lyricsSettings.alignment === 'center'
                        ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                        : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <AlignCenter className="w-5 h-5" />
                    <span>Centre</span>
                  </button>

                  <button
                    onClick={() =>
                      updateSetting((prev) => ({ ...prev, alignment: 'right' }))
                    }
                    className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${
                      lyricsSettings.alignment === 'right'
                        ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                        : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <AlignRight className="w-5 h-5" />
                    <span>Right</span>
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-3">
                  Controls the horizontal alignment of lyric text inside the lyrics area. The lyric block remains top-positioned.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ========================================================= */}
      {/* SECTION: DOWNLOAD MUSIC CONFIGURATION                     */}
      {/* ========================================================= */}
      <section className="space-y-6 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-xl">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Music Downloader Settings</h2>
              <p className="text-xs text-zinc-400">Configure default save location, audio formats, bitrate quality, and metadata tagging</p>
            </div>
          </div>
        </div>

        <form onSubmit={saveDlSettings} className="bg-[#141622] border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Target Library Folder */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Default Download Library
              </label>
              <select
                value={dlSettings.libraryId}
                onChange={(e) => setDlSettings({ ...dlSettings, libraryId: e.target.value })}
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3]"
              >
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} ({lib.path})
                  </option>
                ))}
                {libraries.length === 0 && <option value="">No media libraries configured</option>}
              </select>
              <p className="text-[11px] text-zinc-500">
                Downloaded tracks will be saved directly into this media library path and indexed automatically.
              </p>
            </div>

            {/* Audio Format */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Audio Output Format
              </label>
              <select
                value={dlSettings.format}
                onChange={(e) => setDlSettings({ ...dlSettings, format: e.target.value })}
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              >
                <option value="mp3">MP3 (Recommended for maximum compatibility)</option>
                <option value="m4a">M4A (AAC Audio)</option>
                <option value="flac">FLAC (Lossless Audio)</option>
                <option value="wav">WAV (Uncompressed Waveform)</option>
                <option value="opus">OPUS (High-efficiency Opus Audio)</option>
              </select>
            </div>

            {/* Quality Bitrate */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Default Audio Quality
              </label>
              <select
                value={dlSettings.quality}
                onChange={(e) => setDlSettings({ ...dlSettings, quality: e.target.value })}
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              >
                <option value="320k">320 kbps (High Quality Constant Bitrate)</option>
                <option value="256k">256 kbps (Standard High Quality)</option>
                <option value="192k">192 kbps (Medium Bitrate)</option>
                <option value="128k">128 kbps (Compact Storage)</option>
              </select>
            </div>

            {/* Folder Naming Pattern */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Folder / File Naming Pattern
              </label>
              <input
                type="text"
                value={dlSettings.folderStructure}
                onChange={(e) => setDlSettings({ ...dlSettings, folderStructure: e.target.value })}
                placeholder="{artist}/{album}/{track_number} - {title}"
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Variables: <code className="text-[#FF4FA3]">{'{artist}'}</code>, <code className="text-[#FF4FA3]">{'{album}'}</code>, <code className="text-[#FF4FA3]">{'{track_number}'}</code>, <code className="text-[#FF4FA3]">{'{title}'}</code>
              </p>
            </div>
          </div>

          {/* Toggle Switches */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/5">
            <label className="flex items-center justify-between p-3.5 bg-[#08090E] border border-white/5 rounded-xl cursor-pointer">
              <span className="text-xs font-semibold text-white">Embed ID3 Metadata Tags</span>
              <input
                type="checkbox"
                checked={dlSettings.embedMetadata}
                onChange={(e) => setDlSettings({ ...dlSettings, embedMetadata: e.target.checked })}
                className="w-4 h-4 rounded text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 bg-[#08090E] border border-white/5 rounded-xl cursor-pointer">
              <span className="text-xs font-semibold text-white">Embed High-Res Cover Artwork</span>
              <input
                type="checkbox"
                checked={dlSettings.embedArtwork}
                onChange={(e) => setDlSettings({ ...dlSettings, embedArtwork: e.target.checked })}
                className="w-4 h-4 rounded text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
              />
            </label>
          </div>

          <div className="flex items-center justify-between pt-2">
            {dlSavedMessage && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>{dlSavedMessage}</span>
              </span>
            )}
            <button
              type="submit"
              disabled={savingDlSettings}
              className="ml-auto px-6 py-2.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-xs rounded-xl shadow-lg shadow-[#FF4FA3]/20 flex items-center gap-2 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{savingDlSettings ? 'Saving...' : 'Save Downloader Settings'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* ========================================================= */}
      {/* SECTION: SYSTEM ADMINISTRATION (ADMINISTRATORS ONLY)      */}
      {/* ========================================================= */}
      {user?.role === 'administrator' && (
        <section className="space-y-4 pt-6 border-t border-white/10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#FF4FA3]" />
            <h2 className="text-sm font-bold text-[#FF4FA3] uppercase tracking-wider">
              System Administration
            </h2>
          </div>

          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <HardDrive className="w-5 h-5 text-[#FF4FA3]" />
            <h3 className="text-lg font-bold text-white">Media Library Directories</h3>
          </div>
          
          <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Name</th>
                  <th className="px-5 py-3.5">Server Directory Path</th>
                  <th className="px-5 py-3.5">Last Scanned</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {libraries.map(lib => (
                  <tr key={lib.id} className="hover:bg-[#1A1C2C]/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-2.5">
                      <Folder className="w-4 h-4 text-[#FF4FA3]" />
                      <span>{lib.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 font-mono text-xs">{lib.path}</td>
                    <td className="px-5 py-3.5 text-zinc-400 text-xs">
                      {lib.lastScan ? new Date(lib.lastScan).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => scanLibrary(lib.id)}
                          disabled={scanningId === lib.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C1E2D] hover:bg-[#25283C] text-white rounded-lg text-xs font-medium border border-white/5 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${scanningId === lib.id ? 'animate-spin text-[#FF4FA3]' : ''}`} />
                          <span>{scanningId === lib.id ? 'Scanning' : 'Scan'}</span>
                        </button>
                        <button 
                          onClick={() => setLibToRemove(lib)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-950/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium border border-red-500/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {libraries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-zinc-500 text-sm">
                      No media libraries configured. Add a directory path below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Add Library Card */}
          <form onSubmit={addLibrary} className="bg-[#141622] p-5 rounded-2xl border border-white/5 flex flex-col md:flex-row items-end gap-4 shadow-xl">
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Library Display Name</label>
              <input 
                value={newLibName} onChange={e => setNewLibName(e.target.value)}
                placeholder="e.g. Main Karaoke Collection"
                className="w-full px-3.5 py-2.5 bg-[#0A0B10] border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] text-sm"
                required
              />
            </div>
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Folder Path on Host</label>
              <input 
                value={newLibPath} onChange={e => setNewLibPath(e.target.value)}
                placeholder="e.g. /media"
                className="w-full px-3.5 py-2.5 bg-[#0A0B10] border border-white/10 rounded-xl text-white placeholder-zinc-600 font-mono text-sm focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3]"
                required
              />
            </div>
            <button 
              type="submit" 
              className="w-full md:w-auto px-5 py-2.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 h-[42px] shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Library</span>
            </button>
          </form>
        </section>
      )}

      {/* Confirmation Modal */}
      {libToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#141622] border border-white/10 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-500/30 flex items-center justify-center">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white">Remove Media Library?</h3>
            </div>
            
            <p className="text-zinc-300 text-sm mb-4 leading-relaxed">
              Yimly will stop scanning this location and remove it from the catalog configuration. 
            </p>
            <div className="bg-[#0A0B10] border border-white/10 rounded-xl p-3.5 mb-4">
              <div className="text-[11px] text-zinc-500 mb-1">Path:</div>
              <code className="text-[#FF4FA3] font-mono text-xs">{libToRemove.path}</code>
            </div>
            <p className="text-zinc-400 text-xs mb-6">
              Your audio and video files will <strong className="text-white">NOT</strong> be deleted.
            </p>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setLibToRemove(null)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-colors font-semibold text-xs"
              >
                Cancel
              </button>
              <button 
                onClick={removeLibrary}
                className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors font-semibold text-xs shadow-lg shadow-red-900/20"
              >
                Remove Library
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

