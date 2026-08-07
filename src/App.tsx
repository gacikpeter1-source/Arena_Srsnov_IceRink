import { Routes, Route, Link } from 'react-router-dom'
import HomePage from './pages/HomePage'
import CancelLookupPage from './pages/CancelLookupPage'
import CancelViaTokenPage from './pages/CancelViaTokenPage'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="content-container flex items-center justify-between py-3">
          <Link to="/" className="font-semibold text-white">
            Ice Rink Booking
          </Link>
          <Link to="/my-booking" className="text-sm text-text-secondary hover:text-primary">
            Manage my booking
          </Link>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/my-booking" element={<CancelLookupPage />} />
          <Route path="/my-booking/:bookingId/:token" element={<CancelViaTokenPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
