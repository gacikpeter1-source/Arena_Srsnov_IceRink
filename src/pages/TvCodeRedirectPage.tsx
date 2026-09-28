import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchTournamentByTvCode } from '@/lib/tournaments'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import BackButton from '@/components/BackButton'

/**
 * Public short-link redirect for a tournament's TV screen — see
 * CLAUDE.md's "Tournament TV short code" note. A TV remote can only type
 * a URL through an on-screen keyboard (or, at best, a numeric keypad), so
 * `/turnaje?tournament=<firestore-id>&display=tv` is impractical to key in
 * directly; `/tv/:code` resolves a short numeric code (Tournament.tvCode)
 * back to that same URL and replaces straight into it.
 */
export default function TvCodeRedirectPage() {
  const { t } = useTranslation()
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [invalid, setInvalid] = useState(false)
  const ranRef = useRef(false)

  useEffect(() => {
    if (!code || ranRef.current) return
    ranRef.current = true
    fetchTournamentByTvCode(code).then((tournament) => {
      if (tournament) {
        navigate(`/turnaje?tournament=${tournament.id}&display=tv`, { replace: true })
      } else {
        setInvalid(true)
      }
    })
  }, [code, navigate])

  if (!invalid) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <BackButton fallback="/turnaje" />
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('tvCode.invalidTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-status-danger text-sm">{t('tvCode.invalidNotice')}</p>
          <Link to="/turnaje" className="text-primary hover:text-primary-gold text-sm underline w-fit inline-block">
            {t('tvCode.backToTournaments')}
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
