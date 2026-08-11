import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import { buildGoogleCalendarUrl, buildIcsContent, downloadIcsFile, IcsEventInput } from '@/lib/ics'

interface AddToCalendarButtonsProps {
  events: IcsEventInput[]
  filename: string
}

/**
 * "Add to calendar" actions for a booking (or a whole recurring series).
 * A single event gets a one-tap Google Calendar link plus a .ics download
 * (Apple/Outlook/anything else); a series only offers the .ics download
 * since Google's quick-add link only supports one event at a time — the
 * downloaded file still contains every occurrence as its own VEVENT, so
 * it imports all of them at once.
 */
export default function AddToCalendarButtons({ events, filename }: AddToCalendarButtonsProps) {
  const { t } = useTranslation()
  if (events.length === 0) return null

  const handleDownload = () => downloadIcsFile(buildIcsContent(events), filename)

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {events.length === 1 && (
        <Button asChild variant="outline" size="sm">
          <a href={buildGoogleCalendarUrl(events[0])} target="_blank" rel="noopener noreferrer">
            {t('calendar.addToGoogle')}
          </a>
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={handleDownload}>
        {events.length > 1 ? t('calendar.downloadIcsMultiple', { count: events.length }) : t('calendar.downloadIcs')}
      </Button>
    </div>
  )
}
