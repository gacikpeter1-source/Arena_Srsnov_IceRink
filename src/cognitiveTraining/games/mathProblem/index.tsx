import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CognitiveGameModule } from '@/cognitiveTraining/types'

// A real arithmetic drill ("3 + 5 = ?") — `id` MUST match
// MATH_PROBLEM_GAME_ID in functions/src/cognitiveGames/mathProblem.ts
// exactly, since that string is the only thing linking this frontend
// module to its server-side generator.
//
// Configured in "rounds" (intervals), not a flat task count — matches how
// a trainer actually plans this during physical exercise: N rounds of M
// seconds each (e.g. 8 rounds of 1 minute), tasks shown back-to-back
// within a round (no pause/countdown interrupting it) for the chosen
// per-task duration, with one rest only between rounds.
export type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide'

export interface MathProblemConfig {
  intervalDurationSeconds: number
  intervalCount: number
  taskDurationSeconds: number
  restDurationSeconds: number
  min: number
  max: number
  operations: MathOperation[]
}

export interface MathProblemContent {
  a: number
  b: number
  operation: MathOperation
}

export const MATH_PROBLEM_GAME_ID = 'mathProblem'

const defaultConfig: MathProblemConfig = {
  intervalDurationSeconds: 60,
  intervalCount: 8,
  taskDurationSeconds: 3,
  restDurationSeconds: 15,
  min: 1,
  max: 10,
  operations: ['add']
}

// Same presets/behavior as randomNumber's own duration fields — see that
// module's doc comment for why these are a <select>, not a free-typed
// number.
const INTERVAL_DURATION_PRESETS_SECONDS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 600]
const TASK_DURATION_PRESETS_SECONDS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30]
const REST_DURATION_PRESETS_SECONDS = [0, 5, 10, 15, 20, 30, 45, 60]

// Same "keep local text while editing, only commit a valid parsed number"
// behavior as randomNumber's own NumberField — see that module's own doc
// comment for why a plain controlled number input can't just mirror
// value/onChange directly.
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
function OperationsField({
  value,
  onChange
}: {
  value: MathOperation[]
  onChange: (v: MathOperation[]) => void
}) {
  const { t } = useTranslation()

  const toggle = (op: MathOperation) => {
    if (value.includes(op)) {
      // Never let the trainer uncheck every operation — the generator
      // falls back to addition for an empty array, which would silently
      // ignore the trainer's own intent (e.g. "only division").
      if (value.length === 1) return
      onChange(value.filter((v) => v !== op))
    } else {
      onChange([...value, op])
    }
  }

  const options: { op: MathOperation; labelKey: string }[] = [
    { op: 'add', labelKey: 'cognitiveTraining.games.mathProblem.operationAdd' },
    { op: 'subtract', labelKey: 'cognitiveTraining.games.mathProblem.operationSubtract' },
    { op: 'multiply', labelKey: 'cognitiveTraining.games.mathProblem.operationMultiply' },
    { op: 'divide', labelKey: 'cognitiveTraining.games.mathProblem.operationDivide' }
  ]

  return (
    <div className="space-y-1 col-span-2">
      <Label>{t('cognitiveTraining.games.mathProblem.operations')}</Label>
      <div className="flex flex-wrap gap-4">
        {options.map(({ op, labelKey }) => (
          <label key={op} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(op)} onChange={() => toggle(op)} />
            {t(labelKey)}
          </label>
        ))}
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ConfigForm({ value, onChange }: { value: MathProblemConfig; onChange: (v: MathProblemConfig) => void }) {
  const { t } = useTranslation()

  const numberField = (key: 'intervalCount' | 'min' | 'max', labelKey: string, min = 1) => (
    <NumberField
      id={`mp-${key}`}
      label={t(labelKey)}
      value={value[key]}
      min={min}
      onCommit={(n) => onChange({ ...value, [key]: n })}
    />
  )

  return (
    <div className="grid grid-cols-2 gap-3">
      <DurationSelectField
        id="mp-intervalDurationSeconds"
        label={t('cognitiveTraining.interval.intervalDurationSeconds')}
        value={value.intervalDurationSeconds}
        presets={INTERVAL_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, intervalDurationSeconds: n })}
      />
      {numberField('intervalCount', 'cognitiveTraining.interval.intervalCount')}
      <DurationSelectField
        id="mp-taskDurationSeconds"
        label={t('cognitiveTraining.interval.taskDurationSeconds')}
        value={value.taskDurationSeconds}
        presets={TASK_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, taskDurationSeconds: n })}
      />
      <DurationSelectField
        id="mp-restDurationSeconds"
        label={t('cognitiveTraining.interval.restDurationSeconds')}
        value={value.restDurationSeconds}
        presets={REST_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, restDurationSeconds: n })}
      />
      <div className="space-y-1">
        {numberField('min', 'cognitiveTraining.games.mathProblem.min')}
        <p className="text-xs text-text-muted">{t('cognitiveTraining.games.mathProblem.minHint')}</p>
      </div>
      <div className="space-y-1">
        {numberField('max', 'cognitiveTraining.games.mathProblem.max')}
        <p className="text-xs text-text-muted">{t('cognitiveTraining.games.mathProblem.maxHint')}</p>
      </div>
      <OperationsField value={value.operations} onChange={(operations) => onChange({ ...value, operations })} />
    </div>
  )
}

const OPERATION_SYMBOL: Record<MathOperation, string> = { add: '+', subtract: '−', multiply: '×', divide: ':' }

// eslint-disable-next-line react-refresh/only-export-components
function ProblemDisplay({ a, b, operation }: MathProblemContent) {
  return (
    <div className="text-[clamp(3rem,13vw,10rem)] font-bold leading-none tabular-nums">
      {a} {OPERATION_SYMBOL[operation]} {b} = ?
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TvRenderer({ content }: { content: unknown }) {
  const problem = content as MathProblemContent
  return (
    <div className="h-full w-full flex items-center justify-center text-primary">
      <ProblemDisplay {...problem} />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TrainerRenderer({ content, correctAnswer }: { content: unknown; correctAnswer: unknown }) {
  const { t } = useTranslation()
  const { a, b, operation } = content as MathProblemContent
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-5xl font-bold tabular-nums">
        {a} {OPERATION_SYMBOL[operation]} {b} = ?
      </div>
      <div className="text-text-muted text-sm">
        {t('cognitiveTraining.correctAnswer')}: <span className="font-semibold text-white">{String(correctAnswer)}</span>
      </div>
    </div>
  )
}

export const mathProblemModule: CognitiveGameModule<MathProblemConfig> = {
  id: MATH_PROBLEM_GAME_ID,
  displayName: 'cognitiveTraining.games.mathProblem.displayName',
  defaultConfig,
  ConfigForm,
  TvRenderer,
  TrainerRenderer
}
