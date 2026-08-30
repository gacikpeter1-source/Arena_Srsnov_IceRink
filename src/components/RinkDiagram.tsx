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
const BOUNDS: Record<DivisionMode, { axis: 'vertical' | 'horizontal'; stops: number[] }> = {
  full: { axis: 'vertical', stops: [0, 100] },
  half: { axis: 'vertical', stops: [0, 49.93, 100] },
  third: { axis: 'vertical', stops: [0, 37.21, 62.65, 100] },
  halfLengthwise: { axis: 'horizontal', stops: [0, 50, 100] }
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
  const { axis, stops } = BOUNDS[mode]
  const segments = stops.slice(0, -1).map((start, i) => ({
    slotIndex: i,
    start,
    end: stops[i + 1]
  }))

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
