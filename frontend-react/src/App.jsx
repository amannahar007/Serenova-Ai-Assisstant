import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { auth } from './firebase';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const localUser = localStorage.getItem('serenova_user');
    if (localUser) {
      try {
        setUser(JSON.parse(localUser));
      } catch (e) {
        console.error(e);
      }
    }
    const unsubscribe = auth.onAuthStateChanged((u) => {
      if (u) {
        setUser(u);
      } else if (!localStorage.getItem('serenova_user')) {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('serenova_user');
    auth.signOut();
    setUser(null);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-void text-text-primary">Loading...</div>;

  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
          <Route path="/" element={user ? <Dashboard user={user} /> : <Navigate to="/login" />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
