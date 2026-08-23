import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createTournamentTeam, deleteTournamentTeam, fetchTournamentTeams, DuplicateTeamNameError } from '@/lib/tournaments'
import { downloadTeamImportTemplate, parseTeamsWorkbook } from '@/lib/excel'
import { TournamentTeam } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface TournamentTeamsPanelProps {
  tournamentId: string
  clubId: string
}

/**
 * Team roster for one tournament — added manually or via Excel import.
 * Names must be unique within the tournament (case-insensitive); a
 * duplicate is reported back rather than silently creating a second team
 * with the same name, since a later phase auto-generates schedules by
 * team identity (see TournamentTeam in types/index.ts).
 */
export default function TournamentTeamsPanel({ tournamentId, clubId }: TournamentTeamsPanelProps) {
  const { t } = useTranslation()
  const [teams, setTeams] = useState<(TournamentTeam & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    setLoading(true)
    fetchTournamentTeams(tournamentId).then(setTeams).finally(() => setLoading(false))
  }

  useEffect(refresh, [tournamentId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    setAddError(null)
    try {
      await createTournamentTeam({ tournamentId, clubId, name })
      setNewName('')
      refresh()
    } catch (err) {
      setAddError(err instanceof DuplicateTeamNameError ? t('tournaments.duplicateTeamName', { name }) : t('common.error'))
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('tournaments.confirmDeleteTeam'))) return
    setBusyId(id)
    try {
      await deleteTournamentTeam(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportErrors([])
    try {
      const buffer = await file.arrayBuffer()
      const { rows, errors } = parseTeamsWorkbook(buffer)
      const messages = errors.map((err) => `${t('tournaments.importRow', { row: err.rowNumber })}: ${err.message}`)
      for (const row of rows) {
        try {
          await createTournamentTeam({ tournamentId, clubId, name: row.name })
        } catch (err) {
          messages.push(err instanceof DuplicateTeamNameError ? t('tournaments.duplicateTeamName', { name: row.name }) : `${row.name}: ${t('common.error')}`)
        }
      }
      setImportErrors(messages)
      refresh()
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white text-lg">{t('tournaments.teams')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[180px]">
            <Input
              placeholder={t('tournaments.teamNamePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-background-dark border-border text-white"
            />
          </div>
          <Button type="submit" disabled={adding || !newName.trim()} className="bg-primary hover:bg-primary-gold text-primary-foreground">
            {adding ? t('common.saving') : t('tournaments.addTeam')}
          </Button>
        </form>
        {addError && <p className="text-status-danger text-sm">{addError}</p>}

        <div className="flex gap-2 items-center flex-wrap border-t border-border pt-3">
          <Button type="button" variant="outline" size="sm" onClick={() => downloadTeamImportTemplate()}>
            {t('tournaments.downloadTeamTemplate')}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleImport} disabled={importing} className="text-text-secondary text-sm" />
        </div>
        {importErrors.length > 0 && (
          <div className="text-status-danger text-sm space-y-1">
            {importErrors.map((msg, i) => (
              <p key={i}>{msg}</p>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-text-muted">{t('common.loading')}</p>
        ) : teams.length === 0 ? (
          <p className="text-text-muted text-sm">{t('tournaments.noTeams')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center gap-1 bg-background-dark border border-border rounded-md px-2 py-1">
                <span className="text-white text-sm">{team.name}</span>
                <Button size="sm" variant="destructive" disabled={busyId === team.id} onClick={() => handleDelete(team.id)}>
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
