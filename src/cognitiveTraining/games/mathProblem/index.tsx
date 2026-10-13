import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CognitiveGameModule } from '@/cognitiveTraining/types'

// A real arithmetic drill ("3 + 5 = ?") — `id` MUST match
// MATH_PROBLEM_GAME_ID in functions/src/cognitiveGames/mathProblem.ts
// exactly, since that string is the only thing linking this frontend
// module to its server-side generator.
export type MathOperation = 'add' | 'subtract'

export interface MathProblemConfig {
  taskCount: number
  taskDurationSeconds: number
  pauseDurationSeconds: number
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
  taskCount: 10,
  taskDurationSeconds: 6,
  pauseDurationSeconds: 5,
  min: 1,
  max: 10,
  operations: ['add']
}

// Same presets/behavior as randomNumber's own duration fields — see that
// module's doc comment for why these are a <select>, not a free-typed
// number.
const TASK_DURATION_PRESETS_SECONDS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 45, 60]
const PAUSE_DURATION_PRESETS_SECONDS = [0, 2, 3, 5, 10, 15, 20, 30, 45, 60]

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
      // Never let the trainer uncheck both — the generator falls back to
      // addition for an empty array, which would silently ignore the
      // trainer's own "only subtraction" intent.
      if (value.length === 1) return
      onChange(value.filter((v) => v !== op))
    } else {
      onChange([...value, op])
    }
  }

  return (
    <div className="space-y-1 col-span-2">
      <Label>{t('cognitiveTraining.games.mathProblem.operations')}</Label>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes('add')} onChange={() => toggle('add')} />
          {t('cognitiveTraining.games.mathProblem.operationAdd')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes('subtract')} onChange={() => toggle('subtract')} />
          {t('cognitiveTraining.games.mathProblem.operationSubtract')}
        </label>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ConfigForm({ value, onChange }: { value: MathProblemConfig; onChange: (v: MathProblemConfig) => void }) {
  const { t } = useTranslation()

  const numberField = (key: 'taskCount' | 'min' | 'max', labelKey: string, min = 1) => (
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
      {numberField('taskCount', 'cognitiveTraining.games.mathProblem.taskCount')}
      <DurationSelectField
        id="mp-taskDurationSeconds"
        label={t('cognitiveTraining.games.mathProblem.taskDurationSeconds')}
        value={value.taskDurationSeconds}
        presets={TASK_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, taskDurationSeconds: n })}
      />
      <DurationSelectField
        id="mp-pauseDurationSeconds"
        label={t('cognitiveTraining.games.mathProblem.pauseDurationSeconds')}
        value={value.pauseDurationSeconds}
        presets={PAUSE_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, pauseDurationSeconds: n })}
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

const OPERATION_SYMBOL: Record<MathOperation, string> = { add: '+', subtract: '−' }

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
