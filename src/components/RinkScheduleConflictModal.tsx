import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Booking, RinkScheduleEntry } from '@/types'

export interface RinkScheduleConflictItem {
  entry: RinkScheduleEntry & { id: string }
  occurrence: Booking & { id: string }
}

interface RinkScheduleConflictModalProps {
  conflicts: RinkScheduleConflictItem[]
  onResolve: (action: 'occurrence' | 'series' | 'skip') => void
  onCancel: () => void
}

/**
 * Shown when a new rink-schedule entry is about to land on the exact
 * rink/date/time of one or more already-existing live occurrences —
 * createRinkScheduleEntry itself never blocks on this (allowOverlap: true,
 * per explicit club request, see lib/rinkSchedule.ts's own top-of-file doc
 * comment), so this is a proactive heads-up/choice, not a hard stop. Per
 * explicit product request: staff decide whether the new event REPLACES
 * what's already there — just this one date ("occurrence"), or the whole
 * standing series/entry permanently ("series") — or simply stacks
 * alongside it unchanged, same as before this feature existed ("skip").
 */
export default function RinkScheduleConflictModal({ conflicts, onResolve, onCancel }: RinkScheduleConflictModalProps) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="bg-background-card max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('rinkSchedule.conflictTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-text-secondary text-sm">{t('rinkSchedule.conflictIntro')}</p>
          <ul className="space-y-1">
            {conflicts.map((c) => (
              <li key={c.occurrence.id} className="text-white text-sm bg-background-dark rounded-md px-3 py-2">
                {c.occurrence.name}
                {c.entry.repeatForever ? (
                  <span className="ml-2 text-primary text-xs">({t('rinkSchedule.recurrenceForever')})</span>
                ) : c.entry.seriesId ? (
                  <span className="ml-2 text-primary text-xs">({t('rinkSchedule.recurring')})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="flex-col sm:flex-col items-stretch gap-2 space-x-0">
          <Button type="button" onClick={() => onResolve('occurrence')} className="bg-primary hover:bg-primary-gold text-primary-foreground w-full">
            {t('rinkSchedule.conflictReplaceOccurrence')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => onResolve('series')} className="w-full">
            {t('rinkSchedule.conflictReplaceSeries')}
          </Button>
          <Button type="button" variant="outline" onClick={() => onResolve('skip')} className="w-full">
            {t('rinkSchedule.conflictKeepBoth')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} className="w-full">
            {t('rinkSchedule.conflictCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
