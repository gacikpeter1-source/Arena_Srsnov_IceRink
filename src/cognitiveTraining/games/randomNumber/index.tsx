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

// Every component below is only ever referenced as a property of the
// `randomNumberModule` object at the bottom of this file, never exported
// directly — react-refresh's lint rule still flags each one, since the
// file's actual exports (that object, a type, a string constant) aren't
// "only components" overall. Same reasoning/precedent as the single
// disable comment AuthContext.tsx/button.tsx already use for a mixed
// component+non-component export, just one per component here since
// there are several.
// eslint-disable-next-line react-refresh/only-export-components
function ConfigForm({ value, onChange }: { value: RandomNumberConfig; onChange: (v: RandomNumberConfig) => void }) {
  const { t } = useTranslation()

  const field = (key: keyof RandomNumberConfig, labelKey: string, min = 1) => (
    <div className="space-y-1">
      <Label htmlFor={`rn-${key}`}>{t(labelKey)}</Label>
      <Input
        id={`rn-${key}`}
        type="number"
        min={min}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
      />
    </div>
  )

  return (
    <div className="grid grid-cols-2 gap-3">
      {field('taskCount', 'cognitiveTraining.games.randomNumber.taskCount')}
      {field('taskDurationSeconds', 'cognitiveTraining.games.randomNumber.taskDurationSeconds')}
      {field('pauseDurationSeconds', 'cognitiveTraining.games.randomNumber.pauseDurationSeconds', 0)}
      {field('min', 'cognitiveTraining.games.randomNumber.min')}
      {field('max', 'cognitiveTraining.games.randomNumber.max')}
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
