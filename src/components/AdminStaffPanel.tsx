import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchStaffRoster, updateStaffRole } from '@/lib/staff'
import { StaffRole, StaffUser } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'

interface AdminStaffPanelProps {
  clubId: string
  viewerUid: string
  viewerRole: StaffRole
}

function roleLabelKey(role: StaffRole) {
  switch (role) {
    case 'superadmin': return 'admin.roleSuperadmin'
    case 'owner': return 'admin.roleOwner'
    case 'assistant': return 'admin.roleAssistant'
    default: return 'admin.rolePending'
  }
}

export default function AdminStaffPanel({ clubId, viewerUid, viewerRole }: AdminStaffPanelProps) {
  const { t } = useTranslation()
  const [roster, setRoster] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUid, setBusyUid] = useState<string | null>(null)

  const refresh = () => {
    setLoading(true)
    fetchStaffRoster(clubId).then(setRoster).finally(() => setLoading(false))
  }

  useEffect(refresh, [clubId])

  const handleSetRole = async (uid: string, role: StaffRole) => {
    setBusyUid(uid)
    try {
      await updateStaffRole(uid, role)
      refresh()
    } catch (err) {
      console.error('Error updating staff role:', err)
      alert(t('common.error'))
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white">{t('admin.staffTab')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-text-muted">{t('common.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border">
                  <th className="py-2 pr-3">{t('common.name')}</th>
                  <th className="py-2 pr-3">{t('common.email')}</th>
                  <th className="py-2 pr-3">{t('admin.role')}</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => {
                  const isSelf = s.uid === viewerUid
                  const busy = busyUid === s.uid
                  const canGrantOwner = viewerRole === 'superadmin' && !isSelf && (s.role === 'pending' || s.role === 'assistant')
                  const canGrantAssistant = (viewerRole === 'superadmin' || viewerRole === 'owner') && !isSelf && s.role === 'pending'
                  const canRevoke = !isSelf && (
                    (viewerRole === 'superadmin' && (s.role === 'owner' || s.role === 'assistant')) ||
                    (viewerRole === 'owner' && s.role === 'assistant')
                  )

                  return (
                    <tr key={s.uid} className="border-b border-border">
                      <td className="py-2 pr-3 text-white">{s.name}{isSelf ? ` (${t('admin.you')})` : ''}</td>
                      <td className="py-2 pr-3 text-text-secondary">{s.email}</td>
                      <td className="py-2 pr-3 text-text-secondary">{t(roleLabelKey(s.role))}</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2 flex-wrap">
                          {canGrantOwner && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSetRole(s.uid, 'owner')}>
                              {t('admin.grantOwner')}
                            </Button>
                          )}
                          {canGrantAssistant && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSetRole(s.uid, 'assistant')}>
                              {t('admin.grantAssistant')}
                            </Button>
                          )}
                          {canRevoke && (
                            <Button size="sm" variant="destructive" disabled={busy} onClick={() => handleSetRole(s.uid, 'pending')}>
                              {t('admin.revoke')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
