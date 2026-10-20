import * as React from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const baseClassName =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

// Keeps only digits, capped at 4 (HHMM) — anything the user types or
// pastes that isn't a digit (including the colon we insert ourselves) is
// simply dropped.
function extractDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4)
}

// Clamps each 2-digit group in place once it's actually complete (hour to
// 0-23, minute to 0-59) rather than on every keystroke — a lone "9" is
// still a valid prefix of "09"/"19", so only clamp once there's a real
// two-digit value to judge.
function clampDigits(digits: string): string {
  let hh = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  if (hh.length === 2) hh = String(Math.min(23, parseInt(hh, 10))).padStart(2, '0')
  return hh + mm
}

// Re-inserts the "HH:MM" colon once there are more than 2 digits, so
// typing flows as 2 → 20 → 20:3 → 20:30 without the user ever typing the
// colon themselves.
function formatDigits(digits: string): string {
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}` : digits
}

// Native <input type="time"> renders its displayed text (AM/PM vs 24h)
// from whichever locale the VISITOR'S OWN browser/OS happens to be
// configured in — not from this page's language, and (confirmed: neither
// an element-level `lang` attribute nor the browser's own context locale
// reliably changes it) not from anything this app's code can control. A
// club running this on staff's own mixed devices can't guarantee every
// one of them is set to a 24h-formatting locale, so every Input with
// type="time" is rendered as a small masked "HH:MM" text field instead
// of the native control — guarantees 24h everywhere regardless of the
// device's own settings, and as a side effect needs no native-picker
// dark-mode styling either (unlike type="date", which stays native —
// see src/index.css's color-scheme rule for that one).
const TimeInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      e.target.value = formatDigits(clampDigits(extractDigits(e.target.value)))
      onChange?.(e)
    }
    return (
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:MM"
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        maxLength={5}
        onChange={handleChange}
        className={cn(baseClassName, 'mono', className)}
        ref={ref}
        {...props}
      />
    )
  }
)
TimeInput.displayName = 'TimeInput'

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    if (type === 'time') {
      return <TimeInput className={className} ref={ref} {...props} />
    }
    return (
      <input
        type={type}
        className={cn(baseClassName, className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
