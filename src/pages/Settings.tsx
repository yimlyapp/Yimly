import { useState, useEffect, FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Folder, RefreshCw, Trash2, AlertCircle, HardDrive, ShieldCheck, Check } from 'lucide-react';

export default function Settings() {
  const { user } = useOutletContext<{ user: any }>();
  const [libraries, setLibraries] = useState<any[]>([]);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [libToRemove, setLibToRemove] = useState<any>(null);
  const [scanningId, setScanningId] = useState<number | null>(null);

  useEffect(() => {
    fetchLibraries();
  }, []);

  const fetchLibraries = async () => {
    const res = await fetch('/api/libraries');
    if (res.ok) setLibraries(await res.json());
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

  if (user?.role !== 'administrator') {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
        <h2 className="text-xl font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-sm text-zinc-400">Only system administrators can access server settings.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-2">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>System Administration</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Configure media storage paths, scan folders, and manage server options.</p>
      </div>
      
      {/* Media Libraries Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <HardDrive className="w-5 h-5 text-[#FF4FA3]" />
          <h2 className="text-lg font-bold text-white">Media Library Directories</h2>
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
