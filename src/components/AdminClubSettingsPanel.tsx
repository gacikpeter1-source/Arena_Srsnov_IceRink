import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateClubInfo } from '@/lib/club'
import { Club } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface AdminClubSettingsPanelProps {
  club: Club
}

// Owner/superadmin self-service for the club's public name and "contact
// us" details (email/phone/address/website) — the same fields the app
// header and its contact bar read from src/App.tsx. Previously these
// could only be changed by editing the Firestore doc directly.
export default function AdminClubSettingsPanel({ club }: AdminClubSettingsPanelProps) {
  const { t } = useTranslation()
  const [formData, setFormData] = useState({
    name: club.name,
    email: club.contact.email,
    phone: club.contact.phone ?? '',
    address: club.contact.address ?? '',
    website: club.contact.website ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name || !formData.email) {
      setError(t('booking.fillAllFields'))
      return
    }

    setSaving(true)
    try {
      await updateClubInfo(club.id, formData)

      // Club data isn't shared/live across the app — the header, booking
      // page, and this dashboard each fetch their own copy on mount — so
      // reload to make every screen pick up the new values immediately.
      window.location.reload()
    } catch (err) {
      console.error('Error updating club settings:', err)
      setError(t('common.error'))
      setSaving(false)
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white">{t('admin.clubSettingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          {error && <div className="text-status-danger text-sm">{error}</div>}

          <div>
            <Label htmlFor="club-name" className="text-white">{t('admin.clubName')}</Label>
            <Input
              id="club-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="club-email" className="text-white">{t('common.email')}</Label>
            <Input
              id="club-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="club-phone" className="text-white">{t('common.phone')}</Label>
            <Input
              id="club-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="bg-background-dark border-border text-white"
            />
          </div>

          <div>
            <Label htmlFor="club-address" className="text-white">{t('admin.clubAddress')}</Label>
            <Input
              id="club-address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="bg-background-dark border-border text-white"
            />
          </div>

          <div>
            <Label htmlFor="club-website" className="text-white">{t('nav.website')}</Label>
            <Input
              id="club-website"
              type="url"
              placeholder="https://..."
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="bg-background-dark border-border text-white"
            />
          </div>

          <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
