/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

// Placeholders for Phase 1
import Setup from './pages/Setup.tsx';
import Login from './pages/Login.tsx';
import Home from './pages/Home.tsx';
import Layout from './components/Layout.tsx';
import Settings from './pages/Settings.tsx';
import Users from './pages/Users.tsx';
import Library from './pages/Library.tsx';
import Rooms from './pages/Rooms.tsx';
import RoomSession from './pages/RoomSession.tsx';

export default function App() {
  const [setupStatus, setSetupStatus] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/setup/status')
      .then(res => res.json())
      .then(data => setSetupStatus(data.isSetup))
      .catch(console.error);
  }, []);

  if (setupStatus === null) {
    return <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {!setupStatus ? (
          <>
            <Route path="/setup" element={<Setup onComplete={() => setSetupStatus(true)} />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </>
        ) : (
          <>
            <Route path="/setup" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="settings" element={<Settings />} />
              <Route path="users" element={<Users />} />
              <Route path="library" element={<Library />} />
              <Route path="rooms" element={<Rooms />} />
              <Route path="rooms/:sessionId" element={<RoomSession />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
