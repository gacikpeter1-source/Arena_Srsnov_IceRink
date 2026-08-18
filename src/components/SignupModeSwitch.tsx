import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface SignupModeSwitchProps {
  active: 'staff' | 'trainer'
}

/**
 * Two entry points create staff docs with very different shapes (plain
 * signup vs. invite-code-gated trainer signup) but look identical at a
 * glance — this tab switch lives in the header so the choice is obvious
 * before anyone starts filling in the form, instead of a single
 * easy-to-miss link at the bottom.
 */
export default function SignupModeSwitch({ active }: SignupModeSwitchProps) {
  const { t } = useTranslation()

  const tabClass = (isActive: boolean) =>
    `flex-1 text-center py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-text-secondary hover:text-white'
    }`

  return (
    <div className="flex gap-1 p-1 rounded-lg bg-background-dark mb-4">
      <Link to="/admin/signup" className={tabClass(active === 'staff')}>
        {t('admin.signupModeStaff')}
      </Link>
      <Link to="/admin/signup-trainer" className={tabClass(active === 'trainer')}>
        {t('admin.signupModeTrainer')}
      </Link>
    </div>
  )
}
