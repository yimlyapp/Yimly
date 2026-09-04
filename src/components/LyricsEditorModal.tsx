import React, { useState, useEffect } from 'react';
import { X, Save, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LyricsEditorModalProps {
  isOpen: boolean;
  songId: number | null;
  songTitle: string;
  format: 'lrc' | 'elrc';
  onClose: () => void;
  onSave: () => void;
}

export default function LyricsEditorModal({ isOpen, songId, songTitle, format, onClose, onSave }: LyricsEditorModalProps) {
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && songId) {
      setIsLoading(true);
      setError('');
      setContent('');
      fetch(`/api/songs/${songId}/lyrics?format=${format}`)
        .then(res => {
          if (!res.ok) {
            if (res.status === 404) return ''; // No existing lyrics, start empty
            throw new Error('Failed to fetch lyrics');
          }
          return res.text();
        })
        .then(text => {
          setContent(text);
          setIsLoading(false);
        })
        .catch(err => {
          setError('Could not load existing lyrics.');
          setIsLoading(false);
        });
    }
  }, [isOpen, songId, format]);

  const handleSave = async () => {
    if (!songId) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/songs/${songId}/lrc?format=${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
      });
      if (!res.ok) throw new Error('Failed to save lyrics');
      onSave();
      onClose();
    } catch (err) {
      setError('An error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      >
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="bg-[#1A1C2C] border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#12131C]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#FF4FA3]/15 flex items-center justify-center text-[#FF4FA3]">
                <Music className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Edit {format === 'elrc' ? 'ELRC' : 'LRC'} Lyrics</h2>
                <p className="text-sm text-zinc-400 truncate max-w-sm">{songTitle}</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 p-6 overflow-hidden flex flex-col relative">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}
            
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-zinc-400">Loading existing lyrics...</div>
            ) : (
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={format === 'elrc' ? "[00:00.00] <00:00.00>Word <00:01.00>word" : "[00:00.00] Line"}
                className="flex-1 w-full bg-black/40 border border-white/10 rounded-xl p-4 text-zinc-300 font-mono text-sm focus:outline-none focus:border-[#FF4FA3]/50 focus:ring-1 focus:ring-[#FF4FA3]/50 resize-none"
                spellCheck={false}
              />
            )}
          </div>

          <div className="p-6 border-t border-white/10 bg-[#12131C] flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-white/5 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#FF4FA3] hover:bg-[#FF4FA3]/90 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Lyrics'}
            </button>
            <button
              onClick={async () => {
                if (!songId || !window.confirm('Are you sure you want to delete these lyrics?')) return;
                setIsSaving(true);
                try {
                  const res = await fetch(`/api/songs/${songId}/lrc?format=${format}`, { method: 'DELETE' });
                  if (!res.ok) throw new Error('Failed to delete');
                  onSave();
                  onClose();
                } catch (e) { setError('Failed to delete.'); }
                finally { setIsSaving(false); }
              }}
              disabled={isSaving || isLoading}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
