import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { staff, loading } = useAuth()

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  if (!staff) {
    return <Navigate to="/admin/login" replace />
  }

  return <>{children}</>
}
