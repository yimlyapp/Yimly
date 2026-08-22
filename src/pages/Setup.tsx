import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Setup({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to complete setup');
      }

      onComplete();
      navigate('/login');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md p-8 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800">
        <h1 className="text-2xl font-semibold mb-2">Welcome to Yimly</h1>
        <p className="text-zinc-400 mb-6">Create the first administrator account.</p>

        {error && <div className="mb-4 p-3 bg-red-900/50 border border-red-500/50 rounded text-red-200 text-sm">{error}</div>}

        <form onSubmit={handleSetup} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white focus:outline-none focus:border-zinc-500"
              required
              minLength={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white focus:outline-none focus:border-zinc-500"
              required
              minLength={8}
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 px-4 bg-white text-black rounded-md font-medium hover:bg-zinc-200 transition-colors"
          >
            Create Administrator
          </button>
        </form>
      </div>
    </div>
  );
}
