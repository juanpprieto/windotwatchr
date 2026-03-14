import { useState, useEffect } from 'react';
import { Home } from './pages/Home';
import { Payments } from './pages/Payments';
import { Dashboard } from './pages/Dashboard';

function getRoute(): string {
  return window.location.hash.replace('#', '') || '/';
}

export function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: 0,
        padding: '2rem',
        backgroundColor: '#1e1e2e',
        color: '#cdd6f4',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      {route === '/payments' ? (
        <Payments />
      ) : route === '/dashboard' ? (
        <Dashboard />
      ) : (
        <Home />
      )}
    </div>
  );
}
