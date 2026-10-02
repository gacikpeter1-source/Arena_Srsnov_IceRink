import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFreeIceSlot } from '@/lib/freeIceSlots'
import { downloadFreeIceImportTemplate, parseFreeIceWorkbook } from '@/lib/excel'
import { Rink, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'

interface FreeIceImportPanelProps {
  clubId: string
  rinks: Rink[]
  zones: Zone[]
  createdBy: string
  createdByName: string
  onImported: () => void
}

// Accent-folds and lowercases so "krajná"/"krajna" (typed with or without
// the diacritic) both match — same technique RinkScheduleBoardPage.tsx's
// isRentalLabel already uses for "prenájom".
function foldAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Bulk import for the free-ice-for-rent listing (see CLAUDE.md's "Free ice
 * import becomes the public booking source" note) — mirrors
 * RinkScheduleImportPanel.tsx's pattern closely: "Hala" is a 1-based
 * position among the club's rinks, and the "Zona" column is resolved here
 * (not in the pure parser) against a real Zone — matching a zone's own
 * name/translation/A-B-C letter exactly like "Ihrisko" already does, PLUS
 * two extra synonyms specific to this spreadsheet's vocabulary: "krajná
 * tretina" (an edge third — ambiguous between the two edges, so this
 * deterministically picks the first non-middle third) and "stredná
 * tretina" (the middle third). Blank resolves to the rink's whole-rink
 * zone, same as "Ihrisko" left blank.
 */
export default function FreeIceImportPanel({ clubId, rinks, zones, createdBy, createdByName, onImported }: FreeIceImportPanelProps) {
  const { t } = useTranslation()
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resolveZone = (rinkZones: Zone[], zonePart?: string): Zone | undefined => {
    if (!zonePart) return rinkZones.find((z) => z.mode === 'full')
    const part = foldAccents(zonePart)
    if (part.includes('krajna')) return rinkZones.find((z) => z.mode === 'third' && z.slotIndex !== 1)
    if (part.includes('stredna')) return rinkZones.find((z) => z.mode === 'third' && z.slotIndex === 1)
    return rinkZones.find(
      (z) =>
        foldAccents(z.name) === part ||
        (z.translations?.sk && foldAccents(z.translations.sk) === part) ||
        (z.mode !== 'full' && String.fromCharCode(65 + z.slotIndex).toLowerCase() === part)
    )
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportErrors([])
    setImportedCount(null)
    try {
      const isPlainText = /\.(csv|txt)$/i.test(file.name)
      const input = isPlainText ? await file.text() : await file.arrayBuffer()
      const { rows, errors } = parseFreeIceWorkbook(input)
      const messages = errors.map((err) => `${t('rinkSchedule.importRow', { row: err.rowNumber })}: ${err.message}`)

      const sortedRinks = [...rinks].sort((a, b) => a.sortOrder - b.sortOrder)

      let created = 0
      for (const row of rows) {
        const rink = sortedRinks[row.rinkNumber - 1]
        if (!rink) {
          messages.push(`${row.date} ${row.startTime}: ${t('rinkSchedule.unknownRinkNumber', { number: row.rinkNumber })}`)
          continue
        }
        const rinkZones = zones.filter((z) => z.rinkId === rink.id)
        const zone = resolveZone(rinkZones, row.zonePart)
        if (!zone) {
          messages.push(`${row.date} ${row.startTime}: ${t('rinkSchedule.unknownZone', { zone: row.zonePart ?? '' })}`)
          continue
        }
        try {
          await createFreeIceSlot({
            clubId,
            rinkId: rink.id,
            zoneId: zone.id,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
            note: row.note,
            createdBy,
            createdByName
          })
          created++
        } catch {
          messages.push(`${row.date} ${row.startTime}: ${t('common.error')}`)
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
        <CardTitle className="text-white text-lg">{t('freeIce.importTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-text-secondary text-sm">{t('freeIce.importHint')}</p>
        <div className="flex gap-2 items-center flex-wrap">
          <Button type="button" variant="outline" size="sm" onClick={() => downloadFreeIceImportTemplate()}>
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
