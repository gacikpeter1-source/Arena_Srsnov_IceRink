import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useClubData } from '@/hooks/useClubData'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface ServiceCardProps {
  title: string
  description: string
  href?: string
  external?: boolean
}

function ServiceCard({ title, description, href, external }: ServiceCardProps) {
  const { t } = useTranslation()
  const enabled = Boolean(href)

  const content = (
    <Card className={`arena-card h-full ${enabled ? '' : 'opacity-60'}`}>
      <CardHeader>
        <CardTitle className="text-white">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button disabled={!enabled} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
          {enabled ? title : t('hub.comingSoon')}
        </Button>
      </CardContent>
    </Card>
  )

  if (!enabled) return content
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        {content}
      </a>
    )
  }
  return (
    <Link to={href!} className="block h-full">
      {content}
    </Link>
  )
}

export default function HubHomePage() {
  const { t } = useTranslation()
  const { club, loading, error } = useClubData()

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  if (error || !club) {
    return (
      <div className="content-container py-12 text-center text-status-danger">
        {error ?? t('home.clubNotFound')}
      </div>
    )
  }

  return (
    <div className="content-container py-8 space-y-8">
      <div className="flex flex-col items-center text-center gap-4">
        <img
          src="/icon-512.png"
          alt={club.name}
          className="w-28 h-28 rounded-2xl shadow-lg"
        />
        <div>
          <h1>{club.name}</h1>
          <p className="text-text-secondary max-w-md mx-auto">{t('hub.tagline')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ServiceCard title={t('hub.reserveRink')} description={t('hub.reserveRinkDesc')} href="/book" />
        <ServiceCard
          title={t('hub.trainingReservations')}
          description={t('hub.trainingReservationsDesc')}
          href={club.integrations?.trainingReservationsUrl}
          external
        />
        <ServiceCard
          title={t('hub.tournaments')}
          description={t('hub.tournamentsDesc')}
          href={club.integrations?.tournamentsUrl}
          external
        />
      </div>
    </div>
  )
}
