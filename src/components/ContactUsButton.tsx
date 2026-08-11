import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, Phone, MapPin, Globe } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Club } from '@/types'

interface ContactUsButtonProps {
  club: Club
}

// Header nav item, between "Manage my booking" and the language switcher
// — opens a popup with the club's contact details instead of cluttering
// the header itself with them.
export default function ContactUsButton({ club }: ContactUsButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { email, phone, address, website } = club.contact

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-text-secondary hover:text-primary"
      >
        {t('nav.contactUs')}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-background-card max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">{club.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            {email && (
              <a href={`mailto:${email}`} className="flex items-center gap-2 text-text-secondary hover:text-primary">
                <Mail className="h-4 w-4 flex-shrink-0" />
                {email}
              </a>
            )}
            {phone && (
              <a href={`tel:${phone}`} className="flex items-center gap-2 text-text-secondary hover:text-primary">
                <Phone className="h-4 w-4 flex-shrink-0" />
                {phone}
              </a>
            )}
            {address && (
              <div className="flex items-center gap-2 text-text-secondary">
                <MapPin className="h-4 w-4 flex-shrink-0" />
                {address}
              </div>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-text-secondary hover:text-primary"
              >
                <Globe className="h-4 w-4 flex-shrink-0" />
                {website}
              </a>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
