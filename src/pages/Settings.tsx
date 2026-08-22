import { useState, useEffect, FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Folder, RefreshCw, Trash2, AlertCircle } from 'lucide-react';

export default function Settings() {
  const { user } = useOutletContext<{ user: any }>();
  const [libraries, setLibraries] = useState<any[]>([]);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [libToRemove, setLibToRemove] = useState<any>(null);

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
        alert('Library removed successfully.');
      } else {
        const data = await res.json();
        alert(`Failed to remove library: ${data.error}`);
      }
    } catch (err) {
      alert('Error removing library.');
    }
  };

  const scanLibrary = async (id: number) => {
    await fetch(`/api/libraries/${id}/scan`, { method: 'POST' });
    alert('Scan started in background.');
  };

  if (user?.role !== 'administrator') return <div className="p-8">Access Denied</div>;

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      
      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4 border-b border-zinc-800 pb-2">Media Libraries</h2>
        
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-6">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-950/50 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Path</th>
                <th className="px-4 py-3 font-medium">Last Scan</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map(lib => (
                <tr key={lib.id} className="border-b border-zinc-800/50 last:border-0">
                  <td className="px-4 py-3 font-medium text-white">{lib.name}</td>
                  <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{lib.path}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {lib.lastScan ? new Date(lib.lastScan).toLocaleString() : 'Never'}
                  </td>
                                    <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => scanLibrary(lib.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" /> Scan
                      </button>
                      <button 
                        onClick={() => setLibToRemove(lib)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-400 rounded text-xs transition-colors border border-red-900/30"
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {libraries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                    No libraries configured. Add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form onSubmit={addLibrary} className="bg-zinc-900 p-4 rounded-lg border border-zinc-800 flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-400 mb-1">Library Name</label>
            <input 
              value={newLibName} onChange={e => setNewLibName(e.target.value)}
              placeholder="e.g. Karaoke Collection"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-white focus:outline-none focus:border-emerald-500 text-sm"
              required
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-400 mb-1">Folder Path (on Server, e.g. /media)</label>
            <input 
              value={newLibPath} onChange={e => setNewLibPath(e.target.value)}
              placeholder="e.g. /media"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
              required
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2 h-[38px]">
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>
      </section>

      {/* Confirmation Modal */}
      {libToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-red-400">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-xl font-bold text-white">Remove Media Library?</h3>
            </div>
            
            <p className="text-zinc-300 mb-4">
              Yimly will stop scanning this location and remove it from the media-library configuration. 
            </p>
            <div className="bg-zinc-950 border border-zinc-800 rounded p-3 mb-4">
              <div className="text-xs text-zinc-500 mb-1">Path:</div>
              <code className="text-emerald-400 font-mono">{libToRemove.path}</code>
            </div>
            <p className="text-zinc-400 text-sm mb-6">
              Your files will <strong className="text-white">NOT</strong> be deleted.
            </p>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setLibToRemove(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors font-medium text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={removeLibrary}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors font-medium text-sm shadow-lg shadow-red-900/20"
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
