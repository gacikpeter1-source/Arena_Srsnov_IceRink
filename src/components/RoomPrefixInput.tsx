import { ChangeEvent } from 'react'

interface RoomPrefixInputProps {
  prefix: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

// A room/away-room field with its own label ("Šatňa"/"Šatňa hostí") baked
// permanently into the control as a fixed, non-editable prefix — staff
// only ever type the short suffix after it (a number or a word), never
// the label itself. The final stored value is assembled at submit time
// (withRoomPrefix in lib/utils.ts) as "<prefix> <suffix>", so every room
// created from here on reads consistently (e.g. "Šatňa 5") regardless of
// whether staff typed the word, typed it differently, or skipped it.
export default function RoomPrefixInput({ prefix, value, onChange, placeholder }: RoomPrefixInputProps) {
  return (
    <div className="flex h-10 w-full items-stretch overflow-hidden rounded-md border border-border bg-background-dark focus-within:ring-2 focus-within:ring-ring">
      <span className="flex shrink-0 items-center whitespace-nowrap border-r border-border bg-background-card px-3 text-sm font-medium text-text-muted">
        {prefix}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-text-muted"
      />
    </div>
  )
}
