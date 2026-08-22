import { useEffect, useState, ReactNode } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { Home, Music, Mic, Settings, Users, LogOut, Loader2 } from 'lucide-react';

export default function Layout() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(data => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        navigate('/login');
      });
  }, [navigate]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">
        <Loader2 className="animate-spin w-8 h-8 text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col hidden md:flex">
        <div className="p-6">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Mic className="w-6 h-6 text-emerald-500" />
            Yimly
          </h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          <NavItem to="/" icon={<Home className="w-5 h-5" />} label="Home" />
          <NavItem to="/library" icon={<Music className="w-5 h-5" />} label="Library" />
          <NavItem to="/rooms" icon={<Mic className="w-5 h-5" />} label="Karaoke Rooms" />
          
          {user?.role === 'administrator' && (
            <>
              <div className="mt-8 mb-2 px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Administration
              </div>
              <NavItem to="/users" icon={<Users className="w-5 h-5" />} label="Users" />
              <NavItem to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" />
            </>
          )}
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{user?.username}</span>
              <span className="text-xs text-zinc-500 capitalize">{user?.role}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet context={{ user }} />
      </main>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string, icon: ReactNode, label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => 
        `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
          isActive 
            ? 'bg-zinc-800 text-white font-medium' 
            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
