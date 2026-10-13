import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CognitiveGameModule } from '@/cognitiveTraining/types'

// Shows a geometry formula (e.g. "π × r²") on the TV; the player says
// what it is out loud (e.g. "Obsah kruhu"), the trainer's own phone shows
// the correct name so they can judge the answer — same "no player
// interaction, trainer judges by ear" model every other game here uses.
// `id` MUST match MATH_FORMULAS_GAME_ID in
// functions/src/cognitiveGames/mathFormulas.ts exactly. The formula bank
// itself is fixed/built-in (see that file) — this module only needs to
// translate each formula's own name for the trainer's screen, keyed by
// the same `key` string the generator already stamps onto each task.
export interface MathFormulasConfig {
  intervalDurationSeconds: number
  intervalCount: number
  taskDurationSeconds: number
  restDurationSeconds: number
}

export interface MathFormulasContent {
  key: string
  formula: string
}

export const MATH_FORMULAS_GAME_ID = 'mathFormulas'

const defaultConfig: MathFormulasConfig = {
  intervalDurationSeconds: 60,
  intervalCount: 8,
  taskDurationSeconds: 5,
  restDurationSeconds: 15
}

// Same presets/behavior as mathProblem's own duration fields.
const INTERVAL_DURATION_PRESETS_SECONDS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 600]
const TASK_DURATION_PRESETS_SECONDS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30]
const REST_DURATION_PRESETS_SECONDS = [0, 5, 10, 15, 20, 30, 45, 60]

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
function ConfigForm({ value, onChange }: { value: MathFormulasConfig; onChange: (v: MathFormulasConfig) => void }) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-3">
      <DurationSelectField
        id="mf-intervalDurationSeconds"
        label={t('cognitiveTraining.interval.intervalDurationSeconds')}
        value={value.intervalDurationSeconds}
        presets={INTERVAL_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, intervalDurationSeconds: n })}
      />
      <NumberField
        id="mf-intervalCount"
        label={t('cognitiveTraining.interval.intervalCount')}
        value={value.intervalCount}
        min={1}
        onCommit={(n) => onChange({ ...value, intervalCount: n })}
      />
      <DurationSelectField
        id="mf-taskDurationSeconds"
        label={t('cognitiveTraining.interval.taskDurationSeconds')}
        value={value.taskDurationSeconds}
        presets={TASK_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, taskDurationSeconds: n })}
      />
      <DurationSelectField
        id="mf-restDurationSeconds"
        label={t('cognitiveTraining.interval.restDurationSeconds')}
        value={value.restDurationSeconds}
        presets={REST_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, restDurationSeconds: n })}
      />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TvRenderer({ content }: { content: unknown }) {
  const { formula } = content as MathFormulasContent
  return (
    <div className="h-full w-full flex items-center justify-center text-primary">
      <div className="text-[clamp(2.5rem,11vw,8rem)] font-bold leading-none">{formula}</div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TrainerRenderer({ content, correctAnswer }: { content: unknown; correctAnswer: unknown }) {
  const { t } = useTranslation()
  const { formula } = content as MathFormulasContent
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-4xl font-bold">{formula}</div>
      <div className="text-text-muted text-sm">
        {t('cognitiveTraining.correctAnswer')}:{' '}
        <span className="font-semibold text-white">{t(`cognitiveTraining.games.mathFormulas.answers.${String(correctAnswer)}`)}</span>
      </div>
    </div>
  )
}

export const mathFormulasModule: CognitiveGameModule<MathFormulasConfig> = {
  id: MATH_FORMULAS_GAME_ID,
  displayName: 'cognitiveTraining.games.mathFormulas.displayName',
  defaultConfig,
  ConfigForm,
  TvRenderer,
  TrainerRenderer
}
