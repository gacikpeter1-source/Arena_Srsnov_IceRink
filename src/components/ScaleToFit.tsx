import { useLayoutEffect, useRef, useState, ReactNode } from 'react'

interface ScaleToFitProps {
  children: ReactNode
  className?: string
  maxScale?: number
}

/**
 * Renders `children` at their natural size, then uniformly scales the
 * whole block (CSS transform, not layout) so it always fits inside this
 * component's own box — never overflowing, never needing scroll. Used by
 * the TV/spectator dashboard (TournamentSchedulePage's `display=tv` mode)
 * where "no scrolling, adaptive to screen size" is a hard requirement:
 * a tournament's group count/team count/bracket size varies per club, so
 * a purely CSS (clamp()/breakpoint) layout can't guarantee everything
 * fits — measuring the real rendered size and scaling to it can.
 *
 * Scales UP as well as down (capped at `maxScale`) — on a big TV, small
 * content (e.g. a 2-group tournament) should fill the available space
 * rather than sit tiny in a corner, same reasoning a broadcast scoreboard
 * graphic already follows.
 */
export default function ScaleToFit({ children, className, maxScale = 2.5 }: ScaleToFitProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const recompute = () => {
      const contentWidth = inner.scrollWidth
      const contentHeight = inner.scrollHeight
      if (contentWidth === 0 || contentHeight === 0) return
      const next = Math.min(outer.clientWidth / contentWidth, outer.clientHeight / contentHeight, maxScale)
      setScale(next > 0 ? next : 1)
    }

    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [maxScale])

  return (
    <div ref={outerRef} className={`relative overflow-hidden flex items-center justify-center ${className ?? ''}`}>
      <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }} className="inline-block">
        {children}
      </div>
    </div>
  )
}
