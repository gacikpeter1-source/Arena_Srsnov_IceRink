import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRinkScheduleEntry } from '@/lib/rinkSchedule'
import { downloadRinkScheduleImportTemplate, parseRinkScheduleWorkbook, RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES } from '@/lib/excel'
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
 * use). Rink+zone are resolved here (not in the pure parser), same as the
 * other importers: "Hala" is a 1-based position among the club's rinks
 * (sorted by sortOrder), and "Ihrisko" — free text, optional — is matched
 * against a zone's name, its Slovak translation, or (for a split zone)
 * the same A/B/C letter the TV board shows; left blank, it resolves to
 * that rink's whole-rink zone. Also accepts a plain .csv/.txt file typed
 * by hand in the same column order as the .xlsx template, not just a
 * generated spreadsheet — see parseRinkScheduleWorkbook's own doc comment.
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
      const isPlainText = /\.(csv|txt)$/i.test(file.name)
      const input = isPlainText ? await file.text() : await file.arrayBuffer()
      const { rows, errors } = parseRinkScheduleWorkbook(input)
      const messages = errors.map((err) => `${t('rinkSchedule.importRow', { row: err.rowNumber })}: ${err.message}`)

      const sortedRinks = [...rinks].sort((a, b) => a.sortOrder - b.sortOrder)

      let created = 0
      for (const row of rows) {
        const rink = sortedRinks[row.rinkNumber - 1]
        if (!rink) {
          messages.push(`${row.teamName} (${row.date} ${row.startTime}): ${t('rinkSchedule.unknownRinkNumber', { number: row.rinkNumber })}`)
          continue
        }
        const rinkZones = zones.filter((z) => z.rinkId === rink.id)
        const part = row.zonePart?.toLowerCase()
        const zone = part
          ? rinkZones.find(
              (z) =>
                z.name.toLowerCase() === part ||
                z.translations?.sk?.toLowerCase() === part ||
                (z.mode !== 'full' && String.fromCharCode(65 + z.slotIndex).toLowerCase() === part)
            )
          : rinkZones.find((z) => z.mode === 'full')
        if (!zone) {
          messages.push(`${row.teamName} (${row.date} ${row.startTime}): ${t('rinkSchedule.unknownZone', { zone: row.zonePart ?? '' })}`)
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
            durationMinutes: RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES,
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
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.txt" onChange={handleImport} disabled={importing} className="text-text-secondary text-sm" />
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
