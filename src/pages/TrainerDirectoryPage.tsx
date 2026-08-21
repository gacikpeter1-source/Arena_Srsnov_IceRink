import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { fetchTrainers } from '@/lib/staff'
import { StaffUser } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import BackButton from '@/components/BackButton'

export default function TrainerDirectoryPage() {
  const { t } = useTranslation()
  const [trainers, setTrainers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTrainers().then(setTrainers).finally(() => setLoading(false))
  }, [])

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/treningy" />
      <h1 className="text-2xl font-bold text-white">{t('trainerDirectory.title')}</h1>

      {loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : trainers.length === 0 ? (
        <p className="text-text-muted">{t('trainerDirectory.none')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trainers.map((tr) => (
            <Card key={tr.uid} className="arena-card">
              <CardContent className="pt-4 space-y-3">
                {tr.photoUrl ? (
                  <img src={tr.photoUrl} alt={tr.name} className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl"
                    style={{ backgroundColor: tr.calendarColor || '#FDB913' }}
                  >
                    {tr.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-white font-semibold">{tr.name}</p>
                  {tr.bio && <p className="text-text-secondary text-sm mt-1">{tr.bio}</p>}
                </div>
                <Link
                  to={`/treningy?trainer=${tr.uid}`}
                  className="inline-block text-sm text-primary hover:underline"
                >
                  {t('trainerDirectory.viewSessions')}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
