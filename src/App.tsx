import { Suspense, lazy } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HubHomePage from './pages/HubHomePage'
import BookingPage from './pages/BookingPage'
import CancelLookupPage from './pages/CancelLookupPage'
import CancelViaTokenPage from './pages/CancelViaTokenPage'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import AdminSignupPage from './pages/admin/AdminSignupPage'
import ProtectedRoute from './components/ProtectedRoute'
import LanguageSwitcher from './components/LanguageSwitcher'
import { useAuth } from './contexts/AuthContext'

// Code-split: the admin dashboard pulls in the xlsx library for
// import/export, which is sizable and irrelevant to the public booking
// flow most visitors use — keep it out of the main bundle.
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'))

function Footer() {
  const { t } = useTranslation()
  const { staff } = useAuth()

  return (
    <footer className="border-t border-border mt-12">
      <div className="content-container py-4 text-center">
        <Link to={staff ? '/admin' : '/admin/login'} className="text-xs text-text-muted hover:text-primary">
          {staff ? t('admin.dashboardTitle') : t('admin.loginTitle')}
        </Link>
      </div>
    </footer>
  )
}

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
          <Route path="/admin/signup" element={<AdminSignupPage />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>}>
                  <AdminDashboardPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>

      <Footer />
    </div>
  )
}
