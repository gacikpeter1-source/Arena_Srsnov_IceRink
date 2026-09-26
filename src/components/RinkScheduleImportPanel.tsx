import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRinkScheduleEntry } from '@/lib/rinkSchedule'
import { downloadRinkScheduleImportTemplate, parseRinkScheduleWorkbook } from '@/lib/excel'
import { Rink, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'

interface RinkScheduleImportPanelProps {
  clubId: string
  rinks: Rink[]
  zones: Zone[]
  createdBy: string
  createdByName: string
  createdByEmail: string
  timezone: string
  onImported: () => void
}

/**
 * Bulk import for the rink team schedule (see CLAUDE.md's "Rink team
 * schedule" section) — mirrors TournamentMatchImportPanel.tsx's pattern,
 * scoped to non-recurring rows (recurring entries stay a manual-form-only
 * concept, same split the booking/tournament-match importers already
 * use). Rink+Zone are resolved by name here (not in the pure parser) —
 * same reason the booking import already does this in its own caller:
 * zone names are only unique within a rink.
 */
export default function RinkScheduleImportPanel({
  clubId,
  rinks,
  zones,
  createdBy,
  createdByName,
  createdByEmail,
  timezone,
  onImported
}: RinkScheduleImportPanelProps) {
  const { t } = useTranslation()
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportErrors([])
    setImportedCount(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, errors } = parseRinkScheduleWorkbook(buffer)
      const messages = errors.map((err) => `${t('rinkSchedule.importRow', { row: err.rowNumber })}: ${err.message}`)

      let created = 0
      for (const row of rows) {
        const rink = rinks.find((r) => r.name.toLowerCase() === row.rinkName.toLowerCase())
        if (!rink) {
          messages.push(`${row.teamName} (${row.date} ${row.startTime}): ${t('rinkSchedule.unknownRink', { rink: row.rinkName })}`)
          continue
        }
        const zone = zones.find((z) => z.rinkId === rink.id && z.name.toLowerCase() === row.zoneName.toLowerCase())
        if (!zone) {
          messages.push(`${row.teamName} (${row.date} ${row.startTime}): ${t('rinkSchedule.unknownZone', { zone: row.zoneName })}`)
          continue
        }
        try {
          await createRinkScheduleEntry({
            clubId,
            rinkId: rink.id,
            zoneId: zone.id,
            teamName: row.teamName,
            room: row.room,
            createdBy,
            createdByName,
            createdByEmail,
            date: row.date,
            startTime: row.startTime,
            durationMinutes: row.durationMinutes,
            timezone
          })
          created++
        } catch {
          messages.push(`${row.teamName} (${row.date} ${row.startTime}): ${t('rinkSchedule.slotUnavailable')}`)
        }
      }
      setImportErrors(messages)
      setImportedCount(created)
      if (created > 0) onImported()
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white text-lg">{t('rinkSchedule.importTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-text-secondary text-sm">{t('rinkSchedule.importHint')}</p>
        <div className="flex gap-2 items-center flex-wrap">
          <Button type="button" variant="outline" size="sm" onClick={() => downloadRinkScheduleImportTemplate()}>
            {t('rinkSchedule.downloadTemplate')}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleImport} disabled={importing} className="text-text-secondary text-sm" />
        </div>
        {importedCount != null && <p className="text-status-success text-sm">{t('rinkSchedule.importSuccess', { count: importedCount })}</p>}
        {importErrors.length > 0 && (
          <div className="text-status-danger text-sm space-y-1">
            {importErrors.map((msg, i) => (
              <p key={i}>{msg}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
