import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CognitiveGameModule } from '@/cognitiveTraining/types'

// The demo game this module ships with purely to verify TV/phone sync end
// to end (see CLAUDE.md) — `id` MUST match RANDOM_NUMBER_GAME_ID in
// functions/src/cognitiveGames/randomNumber.ts exactly, since that string
// is the only thing linking this frontend module to its server-side
// generator. `pauseDurationSeconds` isn't declared on the server-side
// RandomNumberConfig type (it's read generically off the raw config bag
// by startCognitiveSession, shared by every game's config by convention —
// see functions/src/index.ts) but still belongs on the form here, since
// it's part of what the trainer actually configures.
export interface RandomNumberConfig {
  taskCount: number
  taskDurationSeconds: number
  pauseDurationSeconds: number
  min: number
  max: number
}

export const RANDOM_NUMBER_GAME_ID = 'randomNumber'

const defaultConfig: RandomNumberConfig = {
  taskCount: 10,
  taskDurationSeconds: 4,
  pauseDurationSeconds: 5,
  min: 1,
  max: 20
}

// Preset choices (seconds) for the two duration fields, shown as a plain
// rolldown <select> rather than a free-typed number — per explicit
// product direction, unlike taskCount/min/max which stay free-typed
// (see NumberField above). The currently-stored value is always included
// even if it isn't one of these presets (e.g. a session created before
// this change), so the select never silently jumps to a different value
// just because it rendered.
const TASK_DURATION_PRESETS_SECONDS = [1, 2, 3, 4, 5, 10, 15, 20, 30, 45, 60]
const PAUSE_DURATION_PRESETS_SECONDS = [0, 2, 3, 5, 10, 15, 20, 30, 45, 60]

// Every component below is only ever referenced as a property of the
// `randomNumberModule` object at the bottom of this file, never exported
// directly — react-refresh's lint rule still flags each one, since the
// file's actual exports (that object, a type, a string constant) aren't
// "only components" overall. Same reasoning/precedent as the single
// disable comment AuthContext.tsx/button.tsx already use for a mixed
// component+non-component export, just one per component here since
// there are several.
// A plain controlled `<input type="number" value={n} onChange={...
// Number(e.target.value)}>` can never actually show an empty box while the
// trainer is retyping a value — clearing the field makes `e.target.value`
// `''`, `Number('')` is `0` (not NaN), so the box is immediately forced
// back to showing "0" on every keystroke instead of staying blank. This
// keeps its own local text while the trainer is actively editing (so
// clearing/retyping behaves like any normal text field) and only commits
// a real number upward once it parses to a valid one >= min; on blur, an
// empty or invalid box snaps back to the last valid value so the form
// never ends up holding something unusable.
// eslint-disable-next-line react-refresh/only-export-components
function NumberField({
  id,
  label,
  value,
  min,
  onCommit
}: {
  id: string
  label: string
  value: number
  min: number
  onCommit: (n: number) => void
}) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commitIfValid = (raw: string) => {
    const parsed = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= min) {
      onCommit(parsed)
    }
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          commitIfValid(e.target.value)
        }}
        onBlur={() => setText(String(value))}
      />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function DurationSelectField({
  id,
  label,
  value,
  presets,
  onCommit
}: {
  id: string
  label: string
  value: number
  presets: number[]
  onCommit: (n: number) => void
}) {
  const options = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b)
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
        className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
      >
        {options.map((seconds) => (
          <option key={seconds} value={seconds} className="bg-background-dark text-white">
            {seconds}
          </option>
        ))}
      </select>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ConfigForm({ value, onChange }: { value: RandomNumberConfig; onChange: (v: RandomNumberConfig) => void }) {
  const { t } = useTranslation()

  const numberField = (key: keyof RandomNumberConfig, labelKey: string, min = 1) => (
    <NumberField
      id={`rn-${key}`}
      label={t(labelKey)}
      value={value[key]}
      min={min}
      onCommit={(n) => onChange({ ...value, [key]: n })}
    />
  )

  return (
    <div className="grid grid-cols-2 gap-3">
      {numberField('taskCount', 'cognitiveTraining.games.randomNumber.taskCount')}
      <DurationSelectField
        id="rn-taskDurationSeconds"
        label={t('cognitiveTraining.games.randomNumber.taskDurationSeconds')}
        value={value.taskDurationSeconds}
        presets={TASK_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, taskDurationSeconds: n })}
      />
      <DurationSelectField
        id="rn-pauseDurationSeconds"
        label={t('cognitiveTraining.games.randomNumber.pauseDurationSeconds')}
        value={value.pauseDurationSeconds}
        presets={PAUSE_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, pauseDurationSeconds: n })}
      />
      <div className="space-y-1">
        {numberField('min', 'cognitiveTraining.games.randomNumber.min')}
        <p className="text-xs text-text-muted">{t('cognitiveTraining.games.randomNumber.minHint')}</p>
      </div>
      <div className="space-y-1">
        {numberField('max', 'cognitiveTraining.games.randomNumber.max')}
        <p className="text-xs text-text-muted">{t('cognitiveTraining.games.randomNumber.maxHint')}</p>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function NumberDisplay({ number }: { number: number }) {
  return <div className="text-[clamp(4rem,20vw,16rem)] font-bold leading-none tabular-nums">{number}</div>
}

// eslint-disable-next-line react-refresh/only-export-components
function TvRenderer({ content }: { content: unknown }) {
  const { number } = content as { number: number }
  return (
    <div className="h-full w-full flex items-center justify-center text-primary">
      <NumberDisplay number={number} />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TrainerRenderer({ content, correctAnswer }: { content: unknown; correctAnswer: unknown }) {
  const { t } = useTranslation()
  const { number } = content as { number: number }
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-6xl font-bold tabular-nums">{number}</div>
      <div className="text-text-muted text-sm">
        {t('cognitiveTraining.correctAnswer')}: <span className="font-semibold text-white">{String(correctAnswer)}</span>
      </div>
    </div>
  )
}

export const randomNumberModule: CognitiveGameModule<RandomNumberConfig> = {
  id: RANDOM_NUMBER_GAME_ID,
  displayName: 'cognitiveTraining.games.randomNumber.displayName',
  defaultConfig,
  ConfigForm,
  TvRenderer,
  TrainerRenderer
}
