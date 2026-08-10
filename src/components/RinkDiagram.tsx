import { cn } from '@/lib/utils'
import { DivisionMode } from '@/types'

// Boundaries (percent of image width) for each division mode, measured from
// the painted lines in public/rink-diagram.jpg: the two blue lines (thirds)
// sit at ~37.21% / ~62.65%, the center red line (halves) at ~49.93%.
const BOUNDS: Record<DivisionMode, number[]> = {
  full: [0, 100],
  half: [0, 49.93, 100],
  third: [0, 37.21, 62.65, 100]
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
  const bounds = BOUNDS[mode]
  const segments = bounds.slice(0, -1).map((start, i) => ({
    slotIndex: i,
    start,
    end: bounds[i + 1]
  }))

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-lg bg-background-dark', className)}
      style={{ aspectRatio: RINK_ASPECT_RATIO }}
    >
      <img src="/rink-diagram.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      {highlightedSlotIndex != null &&
        segments.map(
          (seg) =>
            seg.slotIndex !== highlightedSlotIndex && (
              <div
                key={seg.slotIndex}
                className="absolute inset-y-0 bg-black/65 transition-opacity"
                style={{ left: `${seg.start}%`, width: `${seg.end - seg.start}%` }}
              />
            )
        )}
    </div>
  )
}
