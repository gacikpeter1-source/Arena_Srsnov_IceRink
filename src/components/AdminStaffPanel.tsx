import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteStaffAccount, fetchStaffRoster, setTrainerAccess, updateStaffRole } from '@/lib/staff'
import { fetchTrainerInviteCodes, generateTrainerInviteCode, revokeTrainerInviteCode } from '@/lib/trainerInvites'
import { StaffRole, StaffUser, TrainerInviteCode } from '@/types'
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

  const [inviteCodes, setInviteCodes] = useState<(TrainerInviteCode & { id: string })[]>([])
  const [codesLoading, setCodesLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const inviteLink = (code: string) => `${window.location.origin}/admin/signup-trainer?code=${code}`

  const handleCopyLink = async (code: string) => {
    await navigator.clipboard.writeText(inviteLink(code))
    setCopiedCode(code)
    setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2000)
  }

  const refresh = () => {
    setLoading(true)
    fetchStaffRoster(clubId).then(setRoster).finally(() => setLoading(false))
  }

  const refreshCodes = () => {
    setCodesLoading(true)
    fetchTrainerInviteCodes(clubId).then(setInviteCodes).finally(() => setCodesLoading(false))
  }

  useEffect(refresh, [clubId])
  useEffect(refreshCodes, [clubId])

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

  const handleSetTrainerAccess = async (uid: string, isTrainer: boolean) => {
    setBusyUid(uid)
    try {
      await setTrainerAccess(uid, isTrainer)
      refresh()
    } catch (err) {
      console.error('Error updating trainer access:', err)
      alert(t('common.error'))
    } finally {
      setBusyUid(null)
    }
  }

  const handleDelete = async (uid: string, name: string) => {
    if (!confirm(t('admin.confirmDeleteStaff', { name }))) return
    setBusyUid(uid)
    try {
      await deleteStaffAccount(uid)
      refresh()
    } catch (err) {
      console.error('Error deleting staff account:', err)
      alert(t('common.error'))
    } finally {
      setBusyUid(null)
    }
  }

  const handleGenerateCode = async () => {
    setGenerating(true)
    try {
      await generateTrainerInviteCode(clubId, viewerUid)
      refreshCodes()
    } catch (err) {
      console.error('Error generating invite code:', err)
      alert(t('common.error'))
    } finally {
      setGenerating(false)
    }
  }

  const handleRevokeCode = async (code: string) => {
    setBusyCode(code)
    try {
      await revokeTrainerInviteCode(code)
      refreshCodes()
    } catch (err) {
      console.error('Error revoking invite code:', err)
      alert(t('common.error'))
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <>
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
                    <th className="py-2 pr-3">{t('admin.roleTrainer')}</th>
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
                    // Same boundary firestore.rules and deleteStaffAccount both
                    // enforce server-side: a superadmin can touch any row but
                    // its own, an owner only pending/assistant rows — used
                    // both for the isTrainer toggle (independent of `role`,
                    // see StaffUser) and the real account delete.
                    const canManageRow = !isSelf && (
                      viewerRole === 'superadmin' || (viewerRole === 'owner' && (s.role === 'pending' || s.role === 'assistant'))
                    )

                    return (
                      <tr key={s.uid} className="border-b border-border">
                        <td className="py-2 pr-3 text-white">{s.name}{isSelf ? ` (${t('admin.you')})` : ''}</td>
                        <td className="py-2 pr-3 text-text-secondary">{s.email}</td>
                        <td className="py-2 pr-3 text-text-secondary">{t(roleLabelKey(s.role))}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {s.isTrainer ? (
                              <>
                                <span className="text-primary">{t('admin.roleTrainer')}</span>
                                {canManageRow && (
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSetTrainerAccess(s.uid, false)}>
                                    {t('admin.revokeTrainer')}
                                  </Button>
                                )}
                              </>
                            ) : s.pendingRole === 'trainer' ? (
                              <>
                                <span className="text-xs text-primary">{t('admin.wantsToBeTrainer')}</span>
                                {canManageRow && (
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSetTrainerAccess(s.uid, true)}>
                                    {t('admin.grantTrainer')}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-text-muted">—</span>
                                {canManageRow && (
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSetTrainerAccess(s.uid, true)}>
                                    {t('admin.assignTrainer')}
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
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
                            {canManageRow && (
                              <Button size="sm" variant="destructive" disabled={busy} onClick={() => handleDelete(s.uid, s.name)}>
                                {t('admin.deleteAccount')}
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

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('admin.trainerInvitesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm mb-3">{t('admin.trainerInvitesHint')}</p>
          <Button size="sm" onClick={handleGenerateCode} disabled={generating} className="bg-primary hover:bg-primary-gold text-primary-foreground mb-4">
            {generating ? t('admin.generating') : t('admin.generateInviteCode')}
          </Button>
          {codesLoading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : inviteCodes.length === 0 ? (
            <p className="text-text-muted text-sm">{t('admin.noInviteCodes')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3">{t('admin.inviteCode')}</th>
                    <th className="py-2 pr-3">{t('admin.inviteLink')}</th>
                    <th className="py-2 pr-3">{t('admin.status')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {inviteCodes.map((c) => (
                    <tr key={c.id} className="border-b border-border">
                      <td className="py-2 pr-3 mono text-primary whitespace-nowrap">{c.id}</td>
                      <td className="py-2 pr-3">
                        {!c.used && (
                          <Button size="sm" variant="outline" onClick={() => handleCopyLink(c.id)}>
                            {copiedCode === c.id ? t('admin.linkCopied') : t('admin.copyLink')}
                          </Button>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-text-secondary whitespace-nowrap">
                        {c.used ? t('admin.inviteCodeUsed') : t('admin.inviteCodeUnused')}
                      </td>
                      <td className="py-2 pr-3">
                        {!c.used && (
                          <Button size="sm" variant="destructive" disabled={busyCode === c.id} onClick={() => handleRevokeCode(c.id)}>
                            {t('admin.revoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
