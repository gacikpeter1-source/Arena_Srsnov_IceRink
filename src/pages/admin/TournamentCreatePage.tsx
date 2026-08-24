import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { createTournament } from '@/lib/tournaments'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BackButton from '@/components/BackButton'

/** Standalone creation step at /admin/turnaje/novy — on submit, jumps straight into the new tournament's own management page. */
export default function TournamentCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, staff } = useAuth()
  const { club } = useClubData()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !user || !staff || !name.trim()) return
    setCreating(true)
    try {
      const id = await createTournament({ clubId: club.id, name: name.trim(), createdBy: user.uid, createdByName: staff.name })
      navigate(`/admin/turnaje/${id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="content-container py-6 space-y-6 max-w-lg">
      <BackButton fallback="/admin/turnaje" />
      <h1 className="text-2xl font-bold text-white">{t('tournaments.createTournament')}</h1>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.newTournamentName')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-white">{t('tournaments.newTournamentName')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-background-dark border-border text-white" required autoFocus />
            </div>
            <Button type="submit" disabled={creating || !name.trim()} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {creating ? t('common.saving') : t('tournaments.createTournament')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
