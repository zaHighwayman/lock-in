import { useLiveQuery } from 'dexie-react-hooks';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { db } from './db/schema';
import { cx } from './ui/kit';
import TodayPage from './pages/Today';
import TrainPage from './pages/Train';
import WorkoutPage from './pages/Workout';
import ProgramPage from './pages/Program';
import RunsPage from './pages/Runs';
import FoodPage from './pages/Food';
import RecipePage from './pages/Recipe';
import ProgressPage from './pages/Progress';
import CoachPage from './pages/Coach';
import SettingsPage from './pages/Settings';
import ImportPage from './pages/Import';
import LoginPage from './pages/Login';
import ProfilePage from './pages/Profile';
import HealthSetupPage from './pages/HealthSetup';

const TABS = [
  { to: '/', label: 'Today', icon: 'M4 12h16M12 4v16' },
  { to: '/train', label: 'Train', icon: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12' },
  { to: '/food', label: 'Food', icon: 'M7 3v8a3 3 0 0 0 3 3v7M10 3v6M4 3v6a3 3 0 0 0 3 3M17 3c-2 2-2 6 0 8v10' },
  { to: '/progress', label: 'Progress', icon: 'M4 18l5-6 4 3 7-9' },
  { to: '/coach', label: 'Coach', icon: 'M4 5h16v10H9l-5 4z' },
];

/** New people fill in their profile before anything else. */
function ProfileGate() {
  const loc = useLocation();
  const settings = useLiveQuery(() => db.settings.get('settings'), []);
  if (settings && !settings.profileDone && !['/profile', '/login'].includes(loc.pathname)) return <Navigate to="/profile" replace />;
  return null;
}

function TabBar() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/workout/') || loc.pathname === '/login') return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur safe-bottom">
      <div className="mx-auto flex max-w-xl">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-accent' : 'text-muted')}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ProfileGate />
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/train" element={<TrainPage />} />
        <Route path="/workout/:id" element={<WorkoutPage />} />
        <Route path="/program" element={<ProgramPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/food" element={<FoodPage />} />
        <Route path="/food/recipe/:id" element={<RecipePage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/coach" element={<CoachPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/health-setup" element={<HealthSetupPage />} />
      </Routes>
      <TabBar />
    </HashRouter>
  );
}
