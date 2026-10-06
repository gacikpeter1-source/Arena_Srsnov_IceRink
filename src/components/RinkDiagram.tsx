import { cn } from '@/lib/utils'
import { DivisionMode } from '@/types'

// Boundaries for each division mode, plus which axis they cut along.
// 'vertical' segments run left-to-right (percent of image width) and span
// the image's full height — this is how 'full'/'half'/'third' already work,
// measured from the painted lines in public/rink-diagram.jpg: the two blue
// lines (thirds) sit at ~37.21% / ~62.65%, the center red line (half) at
// ~49.93%. 'horizontal' segments instead run top-to-bottom (percent of
// image height) and span the full width — used by 'halfLengthwise', which
// has no painted line to measure (no real rink marks the ice this way), so
// it's just an even 50/50 split rather than a calibrated percentage.
//
// Segments are explicit {start, end} pairs rather than a single monotonic
// `stops` list specifically so a mode's segments can overlap —
// 'thirdsCombined' needs exactly that (its two zones share the middle
// third), which a shared-boundary partition can't express.
const BOUNDS: Record<DivisionMode, { axis: 'vertical' | 'horizontal'; segments: { start: number; end: number }[] }> = {
  full: { axis: 'vertical', segments: [{ start: 0, end: 100 }] },
  half: { axis: 'vertical', segments: [{ start: 0, end: 49.93 }, { start: 49.93, end: 100 }] },
  third: { axis: 'vertical', segments: [{ start: 0, end: 37.21 }, { start: 37.21, end: 62.65 }, { start: 62.65, end: 100 }] },
  halfLengthwise: { axis: 'horizontal', segments: [{ start: 0, end: 50 }, { start: 50, end: 100 }] },
  thirdsCombined: { axis: 'vertical', segments: [{ start: 0, end: 62.65 }, { start: 37.21, end: 100 }] }
}

const RINK_ASPECT_RATIO = '960 / 536'

interface RinkDiagramProps {
  mode: DivisionMode
  // Zone slotIndex to highlight (keep bright); every other segment is
  // greyed out. null/undefined shows the whole rink at full brightness.
  highlightedSlotIndex?: number | null
  className?: string
}

export default function RinkDiagram({ mode, highlightedSlotIndex, className }: RinkDiagramProps) {
  const { axis, segments: bounds } = BOUNDS[mode]
  const segments = bounds.map((seg, i) => ({ slotIndex: i, ...seg }))

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-lg bg-background-dark', className)}
      style={{ aspectRatio: RINK_ASPECT_RATIO }}
    >
      <img src="/rink-diagram.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      {segments.map((seg) => (
        <div
          key={seg.slotIndex}
          className={cn('absolute bg-black/65 transition-opacity duration-300 ease-out', axis === 'vertical' ? 'inset-y-0' : 'inset-x-0')}
          style={
            axis === 'vertical'
              ? { left: `${seg.start}%`, width: `${seg.end - seg.start}%`, opacity: highlightedSlotIndex != null && seg.slotIndex !== highlightedSlotIndex ? 1 : 0 }
              : { top: `${seg.start}%`, height: `${seg.end - seg.start}%`, opacity: highlightedSlotIndex != null && seg.slotIndex !== highlightedSlotIndex ? 1 : 0 }
          }
        />
      ))}
    </div>
  )
}
