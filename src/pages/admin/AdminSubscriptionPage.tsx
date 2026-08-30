import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { activateEntitlement, deactivateEntitlement, isEntitlementActive, ENTITLEMENT_KEYS, EntitlementKey } from '@/lib/entitlements'
import { ClubEntitlement } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import BackButton from '@/components/BackButton'

// Firestore hands `expiresAt` back as a Timestamp at runtime even though
// the type says Date — same convention lib/entitlements.ts's own
// isEntitlementActive already follows.
function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

/**
 * "Cenník / Môj plán" — see CLAUDE.md's "Subscription / paid add-on
 * modules" section. Ice-rink booking itself is the always-on core
 * product and isn't listed here; only the add-on domains built on top
 * of it (training reservations, tournaments) are gate-able.
 *
 * Every signed-in owner/superadmin sees the same module list with its
 * current status — greyed out and inactive rather than hidden when off,
 * per an explicit request, so the owner always sees the app's full
 * capability even for modules they haven't activated. Only a
 * `superadmin` (the app operator, not the club's own owner — see
 * firestore.rules' `entitlements`-field restriction) sees the
 * activate/deactivate controls; an owner sees status only.
 */
export default function AdminSubscriptionPage() {
  const { t } = useTranslation()
  const { staff } = useAuth()
  const { club, loading } = useClubData()
  const [busyKey, setBusyKey] = useState<EntitlementKey | null>(null)
  const [daysByKey, setDaysByKey] = useState<Record<string, string>>({})

  const canView = staff?.role === 'owner' || staff?.role === 'superadmin'
  const canEdit = staff?.role === 'superadmin'

  const handleActivate = async (key: EntitlementKey, days?: number) => {
    if (!club) return
    setBusyKey(key)
    try {
      await activateEntitlement(club.id, key, days)
      window.location.reload()
    } finally {
      setBusyKey(null)
    }
  }

  const handleDeactivate = async (key: EntitlementKey) => {
    if (!club) return
    setBusyKey(key)
    try {
      await deactivateEntitlement(club.id, key)
      window.location.reload()
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  if (!canView) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/admin" />
        <h1 className="text-white text-xl font-bold">{t('subscription.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('subscription.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin" />
      <h1 className="text-2xl font-bold text-white">{t('subscription.title')}</h1>
      <p className="text-text-secondary text-sm">{t('subscription.intro')}</p>

      <div className="space-y-4">
        {ENTITLEMENT_KEYS.map((key) => {
          const entitlement: ClubEntitlement | undefined = club?.entitlements?.[key]
          const active = isEntitlementActive(entitlement)
          const expiresAt = toDate(entitlement?.expiresAt)
          const isUnlimited = active && !expiresAt
          const days = daysByKey[key] ?? '30'

          return (
            <Card key={key} className={`arena-card ${active ? '' : 'opacity-50'}`}>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-white">{t(`subscription.module.${key}.name`)}</CardTitle>
                <span
                  className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full ${
                    active ? 'bg-status-success/15 text-status-success' : 'bg-background-dark text-text-muted'
                  }`}
                >
                  {active
                    ? isUnlimited
                      ? t('subscription.statusActiveUnlimited')
                      : t('subscription.statusActiveUntil', { date: expiresAt?.toLocaleDateString() })
                    : t('subscription.statusInactive')}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-text-secondary text-sm">{t(`subscription.module.${key}.description`)}</p>
                <p className="text-text-muted text-sm">{t(`subscription.module.${key}.price`)}</p>

                {canEdit && (
                  <fieldset disabled={busyKey === key} className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleActivate(key)}
                      className="bg-primary hover:bg-primary-gold text-primary-foreground"
                    >
                      {t('subscription.activateUnlimited')}
                    </Button>
                    <Input
                      type="number"
                      min={1}
                      value={days}
                      onChange={(e) => setDaysByKey((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="bg-background-dark border-border text-white w-20 h-9"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => handleActivate(key, Math.max(1, parseInt(days, 10) || 30))}>
                      {t('subscription.activateForDays')}
                    </Button>
                    {active && (
                      <Button type="button" size="sm" variant="destructive" onClick={() => handleDeactivate(key)}>
                        {t('subscription.deactivate')}
                      </Button>
                    )}
                  </fieldset>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
