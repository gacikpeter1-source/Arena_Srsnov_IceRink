import { Suspense, lazy } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HubHomePage from './pages/HubHomePage'
import BookingPage from './pages/BookingPage'
import CancelLookupPage from './pages/CancelLookupPage'
import CancelViaTokenPage from './pages/CancelViaTokenPage'
import ConfirmBookingPage from './pages/ConfirmBookingPage'
import SeriesCancelPage from './pages/SeriesCancelPage'
import TrainingCalendarPage from './pages/TrainingCalendarPage'
import TrainerDirectoryPage from './pages/TrainerDirectoryPage'
import TrainingConfirmPage from './pages/TrainingConfirmPage'
import TrainingCancelPage from './pages/TrainingCancelPage'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import AdminSignupPage from './pages/admin/AdminSignupPage'
import TrainerSignupPage from './pages/admin/TrainerSignupPage'
import ProtectedRoute from './components/ProtectedRoute'
import LanguageSwitcher from './components/LanguageSwitcher'
import HeaderMenu from './components/HeaderMenu'
import { useAuth } from './contexts/AuthContext'
import { useClubData } from './hooks/useClubData'

// Code-split: the admin dashboard pulls in the xlsx library for
// import/export, which is sizable and irrelevant to the public booking
// flow most visitors use — keep it out of the main bundle.
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'))
const TrainerDashboardPage = lazy(() => import('./pages/admin/TrainerDashboardPage'))
const IceAttendancePage = lazy(() => import('./pages/admin/IceAttendancePage'))
const TournamentsPage = lazy(() => import('./pages/admin/TournamentsPage'))

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
  const { club } = useClubData()

  return (
    <div className="min-h-screen">
      <header className="border-b border-border relative z-20">
        <div className="content-container flex items-center justify-between py-3 gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-md" />
            {club?.name ?? t('nav.brand')}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <HeaderMenu club={club} />
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<HubHomePage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/my-booking" element={<CancelLookupPage />} />
          <Route path="/my-booking/:bookingId/:token" element={<CancelViaTokenPage />} />
          <Route path="/confirm-booking/:bookingId/:token" element={<ConfirmBookingPage />} />
          <Route path="/my-series/:seriesId/:token" element={<SeriesCancelPage />} />
          <Route path="/treningy" element={<TrainingCalendarPage />} />
          <Route path="/treningy/treneri" element={<TrainerDirectoryPage />} />
          <Route path="/treningy/potvrdit/:regId/:token" element={<TrainingConfirmPage kind="session" />} />
          <Route path="/treningy/zrusit/:regId/:token" element={<TrainingCancelPage kind="session" />} />
          <Route path="/treningy/kurz/potvrdit/:regId/:token" element={<TrainingConfirmPage kind="bundle" />} />
          <Route path="/treningy/kurz/zrusit/:regId/:token" element={<TrainingCancelPage kind="bundle" />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/signup" element={<AdminSignupPage />} />
          <Route path="/admin/signup-trainer" element={<TrainerSignupPage />} />
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
          <Route
            path="/admin/treningy"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>}>
                  <TrainerDashboardPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/treningy/evidencia"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>}>
                  <IceAttendancePage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/turnaje"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>}>
                  <TournamentsPage />
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
