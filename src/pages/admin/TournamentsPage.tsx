import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { fetchTournaments, deleteTournament } from '@/lib/tournaments'
import { Tournament } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import BackButton from '@/components/BackButton'

/**
 * Tournament landing list for a trainer/assistant/owner/superadmin — see
 * CLAUDE.md's "Tournaments" section. Kept deliberately thin: a "Vytvoriť
 * turnaj" button routes to its own creation page (/admin/turnaje/novy),
 * and every existing tournament is a full-width row routing to its own
 * management page (/admin/turnaje/:tournamentId, TournamentDetailPage.tsx)
 * — split out of what used to be one large page mixing the picker with
 * every tournament's teams/generators/live-control/match-list inline,
 * which got confusing once a club had more than one tournament to choose
 * between.
 */
export default function TournamentsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { staff } = useAuth()
  const { club } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  const [tournaments, setTournaments] = useState<(Tournament & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = () => {
    if (!club) return
    setLoading(true)
    fetchTournaments(club.id).then(setTournaments).finally(() => setLoading(false))
  }

  useEffect(refresh, [club])

  const handleDelete = async (id: string) => {
    if (!confirm(t('tournaments.confirmDeleteTournament'))) return
    setBusyId(id)
    try {
      await deleteTournament(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  if (staff && !canManage) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/" />
        <h1>{t('tournaments.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('tournaments.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{t('tournaments.title')}</h1>
        <Link to="/admin/turnaje/novy">
          <Button className="bg-primary hover:bg-primary-gold text-primary-foreground">{t('tournaments.createTournament')}</Button>
        </Link>
      </div>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.yourTournaments')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : tournaments.length === 0 ? (
            <p className="text-text-muted text-sm">{t('tournaments.none')}</p>
          ) : (
            tournaments.map((tr) => (
              <div key={tr.id} className="flex items-center gap-2 p-3 rounded border border-border bg-background-dark hover:border-primary transition-colors">
                <button
                  type="button"
                  onClick={() => navigate(`/admin/turnaje/${tr.id}`)}
                  className="flex-1 text-left text-white hover:text-primary"
                >
                  {tr.name}
                </button>
                <Button size="sm" variant="destructive" disabled={busyId === tr.id} onClick={() => handleDelete(tr.id)}>
                  {t('common.delete')}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
