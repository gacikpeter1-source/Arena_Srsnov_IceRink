import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, ChevronDown } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabelKey } from '@/lib/staff'
import { Club } from '@/types'
import ContactUsButton from './ContactUsButton'

interface HeaderMenuProps {
  club: Club | null
}

/**
 * Consolidates the header's nav links (Trainings, Manage my booking,
 * Contact us) plus the signed-in identity into one dropdown, so the
 * header itself only ever holds the logo/brand, the language switcher,
 * and this single trigger — regardless of how many nav items get added
 * later. The trigger shows the staff member's name when signed in (so
 * identity stays glanceable without opening the menu — see CLAUDE.md's
 * "signed-in identity is always visible" requirement), or a plain menu
 * icon for a signed-out visitor.
 */
export default function HeaderMenu({ club }: HeaderMenuProps) {
  const { t } = useTranslation()
  const { staff } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const roleLabel = staff
    ? staff.isTrainer && staff.role !== 'pending'
      ? `${t(roleLabelKey(staff.role))} + ${t('admin.roleTrainer')}`
      : staff.isTrainer
        ? t('admin.roleTrainer')
        : t(roleLabelKey(staff.role))
    : ''

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary py-1.5 px-2 rounded-md"
        aria-label={t('nav.menu')}
        aria-expanded={open}
      >
        {staff ? (
          <span className="max-w-[8rem] truncate">{staff.name}</span>
        ) : (
          <Menu className="h-5 w-5" />
        )}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-lg border border-border bg-background-card shadow-lg py-2 z-50">
          {staff && (
            <div className="px-4 py-2 border-b border-border mb-1">
              <p className="text-white text-sm font-medium truncate">{staff.name}</p>
              <p className="text-text-muted text-xs">{roleLabel}</p>
            </div>
          )}
          <Link
            to="/treningy"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-text-secondary hover:text-primary hover:bg-background-dark"
          >
            {t('nav.trainings')}
          </Link>
          <Link
            to="/my-booking"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-text-secondary hover:text-primary hover:bg-background-dark"
          >
            {t('nav.manageBooking')}
          </Link>
          {club && (
            <div className="px-4 py-2">
              <ContactUsButton club={club} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
