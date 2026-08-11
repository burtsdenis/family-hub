import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuth } from './lib/auth';
import { DialogProvider } from './components/Dialog';
import { ChangePassword, Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Tasks } from './pages/Tasks';
import { Notes } from './pages/Notes';
import { Calendar } from './pages/Calendar';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { Money } from './pages/Money';

function Gate() {
  const { user, loading, mustChangePassword } = useAuth();

  if (loading) {
    return <div className="min-h-dvh bg-surface-2" />;
  }
  if (!user) return <Login />;
  if (mustChangePassword) return <ChangePassword />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="notes" element={<Notes />} />
        <Route path="money" element={<Money />} />
        <Route path="settings" element={<Settings />} />
        {user.role === 'admin' && <Route path="users" element={<Users />} />}
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
          <Gate />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
