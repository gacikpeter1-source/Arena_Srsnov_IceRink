import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabelKey } from '@/lib/staff'

/**
 * Always shows the signed-in staff member's name and role — a standing
 * requirement (see CLAUDE.md), not a per-page concern, so it lives once
 * in the shared header (App.tsx) rather than being added to each admin
 * page individually. Renders nothing for a signed-out visitor (the vast
 * majority of traffic, since customers never log in).
 */
export default function StaffIdentityBadge() {
  const { t } = useTranslation()
  const { staff } = useAuth()

  if (!staff) return null

  const roleLabel = t(roleLabelKey(staff.role))
  const label = staff.isTrainer && staff.role !== 'pending'
    ? `${roleLabel} + ${t('admin.roleTrainer')}`
    : staff.isTrainer
      ? t('admin.roleTrainer')
      : roleLabel

  return (
    <span className="text-xs text-text-muted whitespace-nowrap">
      {staff.name} · {label}
    </span>
  )
}
