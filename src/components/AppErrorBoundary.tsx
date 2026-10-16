import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * This app had NO error boundary anywhere before this — any uncaught error
 * thrown during render, anywhere in the tree, unmounts the whole React app
 * with nothing left on screen and no way to recover short of a manual
 * reload. That's tolerable for a staff member at a desk, but catastrophic
 * for an unattended kiosk screen (e.g. RinkScheduleAlternatingBoardPage.tsx
 * at the players' bench, or /rozvrh?display=tv in the hallway) — nobody is
 * there to notice a blank/frozen screen and refresh it, so it can stay dead
 * for hours. This wraps the whole app once, at the root, and auto-reloads
 * a few seconds after catching any render error, so a kiosk silently heals
 * itself instead of needing someone to physically go press refresh.
 *
 * This doesn't fix whatever actually threw — it's a safety net, not a
 * diagnosis. See CLAUDE.md/git history for specific crash causes found and
 * fixed (e.g. RinkScheduleTvGrid.tsx's measure-and-shrink convergence
 * guard) — this exists so any OTHER future one, known or not, degrades to
 * "reloads itself in a few seconds" instead of "dead until someone notices".
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('AppErrorBoundary caught a render error — reloading shortly:', error, info.componentStack)
    setTimeout(() => window.location.reload(), 3000)
  }

  render() {
    if (this.state.hasError) {
      // Deliberately minimal and not translated — i18n itself routes
      // through the same React tree that just crashed, so this must not
      // depend on anything that could also be broken.
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
            color: '#fff',
            fontFamily: 'sans-serif'
          }}
        >
          Obnovujem...
        </div>
      )
    }
    return this.props.children
  }
}
