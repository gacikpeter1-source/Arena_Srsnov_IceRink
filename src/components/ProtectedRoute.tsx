import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { staff, loading } = useAuth()

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">Loading...</div>
  }

  if (!staff) {
    return <Navigate to="/admin/login" replace />
  }

  return <>{children}</>
}
