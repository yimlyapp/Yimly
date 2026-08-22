import re

with open('src/pages/RoomSession.tsx', 'r') as f:
    content = f.read()

replacement = """        {/* Host Controls Panel (Bottom Bar) */}
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

            <div className="text-xs text-zinc-500 font-medium hidden lg:block">
              You control playback for the room
            </div>
          </div>
        ) : (
          <div className="p-6 bg-zinc-900 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLibrary(true)}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <LibraryIcon className="w-5 h-5" />
                Browse Library
              </button>
              <div className="text-sm text-zinc-400 hidden sm:block">Find and add songs to the queue</div>
            </div>
            <div className="text-xs text-zinc-500 font-medium hidden lg:block">
              Listening & viewing synchronized
            </div>
          </div>
        )}"""

target_regex = r'\{\/\* Host Controls Panel \(Bottom Bar\) \*\/\}.*?Listening & viewing synchronized.*?<\/div>.*?<\/div>'

new_content = re.sub(target_regex, replacement, content, flags=re.DOTALL)

with open('src/pages/RoomSession.tsx', 'w') as f:
    f.write(new_content)
