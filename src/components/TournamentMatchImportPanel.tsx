import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createTournamentMatch, createTournamentTeam, fetchTournamentTeams, setTeamGroups, DuplicateTeamNameError } from '@/lib/tournaments'
import { downloadTournamentMatchImportTemplate, parseTournamentMatchesWorkbook } from '@/lib/excel'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface TournamentMatchImportPanelProps {
  tournamentId: string
  clubId: string
  createdBy: string
  onImported: () => void
}

/**
 * Bulk match-schedule import for a tournament run entirely at another
 * venue (`location: 'other'`) — e.g. a club's own team travels to a
 * multi-team tournament organized by someone else, arriving as a printed
 * schedule with dozens of matches at fixed times. Typing each one
 * through the one-at-a-time "Add match" form below doesn't scale, so
 * this reads a whole workbook (see lib/excel.ts's
 * parseTournamentMatchesWorkbook) in one pass. Deliberately doesn't
 * cover `location: 'rink'` — an on-ice tournament already has the
 * round-robin/knockout/groups generators plus a rink/zone-aware manual
 * form, which this isn't meant to replace.
 *
 * A row with a Group value gets its teams created (if new) in
 * `tournamentTeams` and assigned that group, and the match is tagged
 * `schema: 'groups'` so it feeds the live standings table on /turnaje.
 * A row with a blank Group is a placement/play-off slot scheduled before
 * the group stage finishes — its "teams" are just rank placeholders
 * (e.g. "A5"/"B5"), so they're written as plain display text only, never
 * touching the team roster or a standings table.
 */
export default function TournamentMatchImportPanel({ tournamentId, clubId, createdBy, onImported }: TournamentMatchImportPanelProps) {
  const { t } = useTranslation()
  const [venueName, setVenueName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!venueName.trim()) {
      setImportErrors([t('tournaments.matchImportNeedsVenue')])
      setImportedCount(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setImporting(true)
    setImportErrors([])
    setImportedCount(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, errors } = parseTournamentMatchesWorkbook(buffer)
      const messages = errors.map((err) => `${t('tournaments.importRow', { row: err.rowNumber })}: ${err.message}`)

      const existingTeams = await fetchTournamentTeams(tournamentId)
      const teamIdByName = new Map(existingTeams.map((tm) => [tm.name.toLowerCase(), tm.id]))
      const resolveTeam = async (name: string, groupId: string): Promise<string> => {
        const key = name.toLowerCase()
        const existingId = teamIdByName.get(key)
        if (existingId) return existingId
        try {
          const id = await createTournamentTeam({ tournamentId, clubId, name })
          teamIdByName.set(key, id)
          await setTeamGroups([{ id, groupId }])
          return id
        } catch (err) {
          if (err instanceof DuplicateTeamNameError) {
            const refreshed = await fetchTournamentTeams(tournamentId)
            const match = refreshed.find((tm) => tm.name.toLowerCase() === key)
            if (match) {
              teamIdByName.set(key, match.id)
              return match.id
            }
          }
          throw err
        }
      }

      let created = 0
      for (const row of rows) {
        try {
          let teamAId: string | undefined
          let teamBId: string | undefined
          if (row.groupId) {
            teamAId = await resolveTeam(row.teamA, row.groupId)
            teamBId = await resolveTeam(row.teamB, row.groupId)
          }
          await createTournamentMatch({
            tournamentId,
            clubId,
            date: row.date,
            startTime: row.startTime,
            durationMinutes: row.durationMinutes,
            teamA: row.teamA,
            teamB: row.teamB,
            teamAId,
            teamBId,
            schema: row.groupId ? 'groups' : undefined,
            groupId: row.groupId,
            teamAPlaceholder: row.teamAPlaceholder,
            teamBPlaceholder: row.teamBPlaceholder,
            label: row.label,
            format: 'full',
            location: 'other',
            venueName: venueName.trim(),
            blocksIce: false,
            createdBy
          })
          created++
        } catch {
          messages.push(`${row.teamA} vs ${row.teamB} (${row.date} ${row.startTime}): ${t('common.error')}`)
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
        <CardTitle className="text-white text-lg">{t('tournaments.matchImportTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-text-secondary text-sm">{t('tournaments.matchImportHint')}</p>
        <div className="max-w-sm">
          <Label className="text-white">{t('tournaments.venueName')}</Label>
          <Input
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            placeholder={t('tournaments.venuePlaceholder')}
            className="bg-background-dark border-border text-white"
          />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Button type="button" variant="outline" size="sm" onClick={() => downloadTournamentMatchImportTemplate()}>
            {t('tournaments.downloadMatchTemplate')}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleImport} disabled={importing} className="text-text-secondary text-sm" />
        </div>
        {importedCount != null && <p className="text-status-success text-sm">{t('tournaments.matchImportSuccess', { count: importedCount })}</p>}
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
