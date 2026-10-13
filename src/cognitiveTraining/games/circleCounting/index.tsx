import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CognitiveGameModule } from '@/cognitiveTraining/types'

// TV shows a cluster of randomly-scattered, randomly-colored circles; the
// player counts only the circles of one trainer-chosen color. `id` MUST
// match CIRCLE_COUNTING_GAME_ID in
// functions/src/cognitiveGames/circleCounting.ts exactly. The color ids
// (CIRCLE_COLOR_IDS there) are duplicated here on purpose — functions/ is
// a separate TS project from src/ and can't import across that boundary
// (same reason zonedTimeToUtc has a standalone copy, see CLAUDE.md) — only
// this frontend copy carries the actual hex values, since the server only
// ever needs the color id, never how it's drawn.
export type CircleColorId = 'red' | 'green' | 'blue' | 'yellow' | 'orange' | 'white'

export const CIRCLE_COLOR_IDS: CircleColorId[] = ['red', 'green', 'blue', 'yellow', 'orange', 'white']

const COLOR_HEX: Record<CircleColorId, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#eab308',
  orange: '#f97316',
  white: '#f8fafc'
}

export interface CircleCountingConfig {
  intervalDurationSeconds: number
  intervalCount: number
  taskDurationSeconds: number
  restDurationSeconds: number
  minCircles: number
  maxCircles: number
  colors: CircleColorId[]
  targetColor: CircleColorId
}

export interface CircleItem {
  x: number
  y: number
  size: number
  color: CircleColorId
}

export interface CircleCountingContent {
  circles: CircleItem[]
  targetColor: CircleColorId
}

export const CIRCLE_COUNTING_GAME_ID = 'circleCounting'

const defaultConfig: CircleCountingConfig = {
  intervalDurationSeconds: 60,
  intervalCount: 8,
  taskDurationSeconds: 5,
  restDurationSeconds: 15,
  minCircles: 10,
  maxCircles: 25,
  colors: ['red', 'green', 'blue'],
  targetColor: 'green'
}

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
function ColorSwatchDot({ color }: { color: CircleColorId }) {
  return <span className="inline-block w-4 h-4 rounded-full border border-border" style={{ backgroundColor: COLOR_HEX[color] }} />
}

// eslint-disable-next-line react-refresh/only-export-components
function ColorsField({
  value,
  onChange
}: {
  value: CircleCountingConfig
  onChange: (v: CircleCountingConfig) => void
}) {
  const { t } = useTranslation()

  const toggleColor = (color: CircleColorId) => {
    const selected = value.colors.includes(color)
    // Never let the trainer uncheck every color down to one — counting
    // needs at least one "other" color besides the target to be a real
    // task, not a board of a single uniform color.
    if (selected && value.colors.length <= 2) return
    const colors = selected ? value.colors.filter((c) => c !== color) : [...value.colors, color]
    // If the color being unchecked was the current target, fall back to
    // the first remaining selected color so targetColor never points at
    // something no longer offered.
    const targetColor = colors.includes(value.targetColor) ? value.targetColor : colors[0]
    onChange({ ...value, colors, targetColor })
  }

  return (
    <div className="space-y-2 col-span-2">
      <div className="space-y-1">
        <Label>{t('cognitiveTraining.games.circleCounting.colors')}</Label>
        <div className="flex flex-wrap gap-3">
          {CIRCLE_COLOR_IDS.map((color) => (
            <label key={color} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={value.colors.includes(color)} onChange={() => toggleColor(color)} />
              <ColorSwatchDot color={color} />
              {t(`cognitiveTraining.games.circleCounting.colorNames.${color}`)}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="cc-targetColor">{t('cognitiveTraining.games.circleCounting.targetColor')}</Label>
        <select
          id="cc-targetColor"
          value={value.targetColor}
          onChange={(e) => onChange({ ...value, targetColor: e.target.value as CircleColorId })}
          className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
        >
          {value.colors.map((color) => (
            <option key={color} value={color} className="bg-background-dark text-white">
              {t(`cognitiveTraining.games.circleCounting.colorNames.${color}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ConfigForm({ value, onChange }: { value: CircleCountingConfig; onChange: (v: CircleCountingConfig) => void }) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-3">
      <DurationSelectField
        id="cc-intervalDurationSeconds"
        label={t('cognitiveTraining.interval.intervalDurationSeconds')}
        value={value.intervalDurationSeconds}
        presets={INTERVAL_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, intervalDurationSeconds: n })}
      />
      <NumberField
        id="cc-intervalCount"
        label={t('cognitiveTraining.interval.intervalCount')}
        value={value.intervalCount}
        min={1}
        onCommit={(n) => onChange({ ...value, intervalCount: n })}
      />
      <DurationSelectField
        id="cc-taskDurationSeconds"
        label={t('cognitiveTraining.interval.taskDurationSeconds')}
        value={value.taskDurationSeconds}
        presets={TASK_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, taskDurationSeconds: n })}
      />
      <DurationSelectField
        id="cc-restDurationSeconds"
        label={t('cognitiveTraining.interval.restDurationSeconds')}
        value={value.restDurationSeconds}
        presets={REST_DURATION_PRESETS_SECONDS}
        onCommit={(n) => onChange({ ...value, restDurationSeconds: n })}
      />
      <NumberField
        id="cc-minCircles"
        label={t('cognitiveTraining.games.circleCounting.minCircles')}
        value={value.minCircles}
        min={1}
        onCommit={(n) => onChange({ ...value, minCircles: n, maxCircles: Math.max(n, value.maxCircles) })}
      />
      <NumberField
        id="cc-maxCircles"
        label={t('cognitiveTraining.games.circleCounting.maxCircles')}
        value={value.maxCircles}
        min={value.minCircles}
        onCommit={(n) => onChange({ ...value, maxCircles: n })}
      />
      <ColorsField value={value} onChange={onChange} />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function CircleBoard({ circles }: { circles: CircleItem[] }) {
  return (
    <div className="relative w-full h-full">
      {circles.map((c, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${c.x}%`,
            top: `${c.y}%`,
            width: `${c.size}vmin`,
            height: `${c.size}vmin`,
            backgroundColor: COLOR_HEX[c.color],
            transform: 'translate(-50%, -50%)'
          }}
        />
      ))}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TvRenderer({ content }: { content: unknown }) {
  const { circles } = content as CircleCountingContent
  return (
    <div className="h-full w-full">
      <CircleBoard circles={circles} />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function TrainerRenderer({ content, correctAnswer }: { content: unknown; correctAnswer: unknown }) {
  const { t } = useTranslation()
  const { circles, targetColor } = content as CircleCountingContent
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <ColorSwatchDot color={targetColor} />
        {t('cognitiveTraining.games.circleCounting.countPrompt', { color: t(`cognitiveTraining.games.circleCounting.colorNames.${targetColor}`) })}
      </div>
      <div className="relative w-full aspect-square max-w-xs rounded-md border border-border bg-background-dark">
        <CircleBoard circles={circles} />
      </div>
      <div className="text-text-muted text-sm">
        {t('cognitiveTraining.correctAnswer')}: <span className="font-semibold text-white">{String(correctAnswer)}</span>
      </div>
    </div>
  )
}

export const circleCountingModule: CognitiveGameModule<CircleCountingConfig> = {
  id: CIRCLE_COUNTING_GAME_ID,
  displayName: 'cognitiveTraining.games.circleCounting.displayName',
  defaultConfig,
  ConfigForm,
  TvRenderer,
  TrainerRenderer
}
