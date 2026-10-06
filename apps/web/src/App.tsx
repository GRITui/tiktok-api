import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import { LoginPage } from './pages/Login';
import { OrdersPage } from './pages/Orders';
import { ShopsPage } from './pages/Shops';
import { FulfillmentPage } from './pages/Fulfillment';
import './styles.css';
import type { SessionUser } from '@oms/core/types';

function useUser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const data = await apiGet<SessionUser>('/v1/me');
        setUser(data);
      } catch (err: any) {
        // 401 will redirect in api.ts
        setError('');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  return { user, loading, error };
}

interface ProtectedRouteProps {
  children: React.ReactNode;
  user: SessionUser | null;
  loading: boolean;
}

function ProtectedRoute({ children, user, loading }: ProtectedRouteProps) {
  if (loading) {
    return <div className="spinner" style={{ margin: '20px auto' }}></div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}

function AppShell({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  const location = useLocation();

  if (!user || location.pathname === '/login') {
    return <>{children}</>;
  }

  const handleLogout = async () => {
    try {
      await apiPost('/v1/auth/logout', {});
    } catch {
      // Continue
    }
    window.location.href = '/login';
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h2>OMS</h2>
        <ul className="sidebar-nav">
          <li>
            <a href="/orders" className={isActive('/orders') ? 'active' : ''}>
              Orders
            </a>
          </li>
          <li>
            <a href="/shops" className={isActive('/shops') ? 'active' : ''}>
              Shops
            </a>
          </li>
          <li>
            <a href="/fulfillment" className={isActive('/fulfillment') ? 'active' : ''}>
              Fulfillment
            </a>
          </li>
        </ul>
      </div>

      <div className="main-content">
        <div className="header">
          <h1>Order Management System</h1>
          <div className="user-section">
            <div className="user-info">
              <div className="user-email">{user.email}</div>
              <div className="user-role">{user.role}</div>
            </div>
            <button onClick={handleLogout} className="secondary">
              Logout
            </button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useUser();

  return (
    <AppShell user={user}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/orders"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <OrdersPage userRole={user?.role || ''} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shops"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <ShopsPage userRole={user?.role || ''} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fulfillment"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <FulfillmentPage userRole={user?.role || ''} />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/orders" />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
