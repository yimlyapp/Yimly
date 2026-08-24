import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Users as UsersIcon, Shield, User as UserIcon, ShieldCheck } from 'lucide-react';

export default function Users() {
  const { user } = useOutletContext<{ user: any }>();
  const [usersList, setUsersList] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role === 'administrator') {
      fetch('/api/users')
        .then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return [];
        })
        .then(data => setUsersList(Array.isArray(data) ? data : []))
        .catch(err => console.error('Users fetch error:', err));
    }
  }, [user]);

  if (user?.role !== 'administrator') {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Shield className="w-12 h-12 text-red-400 mb-3" />
        <h2 className="text-xl font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-sm text-zinc-400">Only system administrators can access user management.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-2">
          <UsersIcon className="w-3.5 h-3.5" />
          <span>Accounts & Permissions</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">User Management</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage registered user accounts and permission roles.</p>
      </div>
      
      <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3.5">ID</th>
              <th className="px-5 py-3.5">Username</th>
              <th className="px-5 py-3.5">Role</th>
              <th className="px-5 py-3.5">Created At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {usersList.map(u => (
              <tr key={u.id} className="hover:bg-[#1A1C2C]/60 transition-colors">
                <td className="px-5 py-3.5 text-zinc-500 font-mono text-xs">#{u.id}</td>
                <td className="px-5 py-3.5 font-medium text-white flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-xs font-bold text-white">
                    {u.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span>{u.username}</span>
                </td>
                <td className="px-5 py-3.5">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize inline-flex items-center gap-1.5 ${
                    u.role === 'administrator' 
                      ? 'bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/30' 
                      : 'bg-white/5 text-zinc-300 border border-white/10'
                  }`}>
                    {u.role === 'administrator' && <ShieldCheck className="w-3 h-3" />}
                    <span>{u.role}</span>
                  </span>
                </td>
                <td className="px-5 py-3.5 text-zinc-400 text-xs font-mono">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {usersList.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-zinc-500 text-sm">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
