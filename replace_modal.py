import re

with open('src/pages/RoomSession.tsx', 'r') as f:
    content = f.read()

replacement = """  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden flex-col lg:flex-row relative">
      {/* Guest Library Modal */}
      {showLibrary && !isHost && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between shrink-0">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <LibraryIcon className="w-5 h-5 text-emerald-400" /> Room Library
            </h2>
            <button 
              onClick={() => setShowLibrary(false)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Close Library
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Library />
          </div>
        </div>
      )}
      {/* Left / Main Player Screen */}"""

target_regex = r'  return \(\n    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden flex-col lg:flex-row">\n      \{\/\* Left \/ Main Player Screen \*\/\}'

new_content = re.sub(target_regex, replacement, content, flags=re.DOTALL)

with open('src/pages/RoomSession.tsx', 'w') as f:
    f.write(new_content)
