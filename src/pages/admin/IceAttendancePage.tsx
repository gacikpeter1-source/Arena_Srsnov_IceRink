import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { Button } from '@/components/ui/button'
import AdminTrainerIceLogPanel from '@/components/AdminTrainerIceLogPanel'
import BackButton from '@/components/BackButton'

/**
 * Standalone ice-attendance page — split out of TrainerDashboardPage
 * (which is now purely about a trainer/owner/superadmin manually creating
 * trainings) so an assistant, who has no reason to be on that page at
 * all, lands here directly instead (see App.tsx's redirect on
 * TrainerDashboardPage). Reachable by any ice-rink staff role
 * (assistant/owner/superadmin); only owner/superadmin can read the full
 * private ice log back (see AdminTrainerIceLogPanel/firestore.rules).
 */
export default function IceAttendancePage() {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const { club } = useClubData()
  const isIceRinkStaff = staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  if (staff && !isIceRinkStaff) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <h1>{t('trainerDashboard.notATrainerTitle')}</h1>
        <p className="text-text-secondary">{t('trainerDashboard.notATrainerNotice')}</p>
        <Link to="/admin"><Button variant="outline">{t('trainerDashboard.backToIceRink')}</Button></Link>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin/treningy" />
      <h1 className="text-2xl font-bold text-white">{t('trainerIceLog.title')}</h1>

      {user && club && (
        <AdminTrainerIceLogPanel clubId={club.id} loggedBy={user.uid} canViewLog={staff?.role === 'owner' || staff?.role === 'superadmin'} />
      )}
    </div>
  )
}
