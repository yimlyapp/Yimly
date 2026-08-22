import re

with open('src/pages/Settings.tsx', 'r') as f:
    content = f.read()

# Add Trash2 to imports
content = content.replace("import { Plus, Folder, RefreshCw } from 'lucide-react';", "import { Plus, Folder, RefreshCw, Trash2, AlertCircle } from 'lucide-react';")

# Add libToRemove state
content = content.replace("const [newLibPath, setNewLibPath] = useState('');", "const [newLibPath, setNewLibPath] = useState('');\n  const [libToRemove, setLibToRemove] = useState<any>(null);")

# Add removeLibrary function
remove_fn = """  const removeLibrary = async () => {
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
  };"""

content = content.replace("const scanLibrary = async (id: number) => {", remove_fn + "\n\n  const scanLibrary = async (id: number) => {")

# Update Actions td
actions_td = """                  <td className="px-4 py-3 text-right">
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
                  </td>"""

content = re.sub(r'<td className="px-4 py-3 text-right">.*?<\/td>', actions_td, content, flags=re.DOTALL)

# Add Modal at the end of the return
modal = """      </section>

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
    </div>"""

content = content.replace("      </section>\n    </div>", modal)

with open('src/pages/Settings.tsx', 'w') as f:
    f.write(content)

