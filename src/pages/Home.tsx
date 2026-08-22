import { useEffect, useState, ReactNode } from 'react';
import { useOutletContext, Link } from 'react-router-dom';

export default function Home() {
  const { user } = useOutletContext<{ user: any }>();
  const [stats, setStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [rooms, setRooms] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/libraries/stats')
      .then(res => res.json())
      .then(setStats)
      .catch(console.error);

    fetch('/api/karaoke/active-sessions')
      .then(res => res.json())
      .then(setRooms)
      .catch(console.error);
  }, []);

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Welcome, {user?.username}</h1>
        <p className="text-zinc-400">Your karaoke media server is ready.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <DashboardCard 
          title="Library Stats" 
          description={`${stats.artists} Artists, ${stats.albums} Albums, ${stats.songs} Songs`}
          action={<Link to="/settings" className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-md self-start transition-colors inline-block mt-4">Manage Libraries</Link>}
        />
        <DashboardCard 
          title="Active Sessions" 
          description={rooms.length === 0 ? "No active karaoke rooms." : `${rooms.length} active room(s).`}
          action={<Link to="/rooms" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md self-start transition-colors inline-block mt-4">Go to Rooms</Link>}
        />
        <DashboardCard 
          title="Recent Activity" 
          description="You logged in."
        />
      </div>
    </div>
  );
}

function DashboardCard({ title, description, action }: { title: string, description: string, action?: ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 flex flex-col h-full">
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-zinc-400 flex-1">{description}</p>
      {action}
    </div>
  );
}
