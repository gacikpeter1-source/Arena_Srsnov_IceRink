import { Routes, Route, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HubHomePage from './pages/HubHomePage'
import BookingPage from './pages/BookingPage'
import CancelLookupPage from './pages/CancelLookupPage'
import CancelViaTokenPage from './pages/CancelViaTokenPage'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import ProtectedRoute from './components/ProtectedRoute'
import LanguageSwitcher from './components/LanguageSwitcher'

export default function App() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="content-container flex items-center justify-between py-3 gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-md" />
            {t('nav.brand')}
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/my-booking" className="text-sm text-text-secondary hover:text-primary">
              {t('nav.manageBooking')}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<HubHomePage />} />
          <Route path="/book" element={<BookingPage />} />
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
