import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';

export default function Users() {
  const { user } = useOutletContext<{ user: any }>();
  const [usersList, setUsersList] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(setUsersList);
  }, []);

  if (user?.role !== 'administrator') return <div className="p-8">Access Denied</div>;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-8">User Management</h1>
      
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-950/50 text-zinc-400 border-b border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {usersList.map(u => (
              <tr key={u.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                <td className="px-4 py-3 text-zinc-500 font-mono">{u.id}</td>
                <td className="px-4 py-3 font-medium text-white">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
                    u.role === 'administrator' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-zinc-800 text-zinc-300'
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
