import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'

interface BackButtonProps {
  // Where to go when there's no in-app history to return to (e.g. a
  // fresh visit via a shared/QR/emailed link) — each page picks its own
  // logical parent.
  fallback: string
}

/**
 * A small back arrow for every sub-page. Needed because this app is
 * PWA-installable (see CLAUDE.md) — once installed to a home screen,
 * standalone mode has no browser chrome at all, so there's no native
 * back button to fall back on.
 *
 * Prefers real browser-session history (react-router stamps a history
 * index on `window.history.state`) so, e.g., returning from just having
 * created a training lands back on the list you were already viewing,
 * not a fixed page — only falling back to the given route when there's
 * no in-app history to go back to.
 */
export default function BackButton({ fallback }: BackButtonProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const hasHistory = (window.history.state?.idx ?? 0) > 0

  return (
    <button
      type="button"
      onClick={() => (hasHistory ? navigate(-1) : navigate(fallback))}
      className="inline-flex items-center gap-1 text-text-secondary hover:text-primary text-sm mb-4"
    >
      <ChevronLeft className="h-4 w-4" />
      {t('common.back')}
    </button>
  )
}
