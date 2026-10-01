import { useEffect, useState } from 'react'
import { decodePlan, planCodeFromLocation, type SharedPlan } from '../share'
import { usePlanner } from '../store'
import type { LngLat } from '../domain/types'
import { Dialog } from './Dialog'

function describe(plan: SharedPlan): string {
  const n = (t: 'grid' | 'orbit') => plan.parts.filter((p) => p.type === t).length
  const bits = [
    n('grid') && `${n('grid')} area map${n('grid') > 1 ? 's' : ''}`,
    n('orbit') && `${n('orbit')} orbit${n('orbit') > 1 ? 's' : ''}`,
  ].filter(Boolean)
  return bits.join(' and ')
}

/** When the app is opened from a mission link or QR code, offer to load that mission. */
export function SharedPlanPrompt({ onOpened }: { onOpened: (focus: LngLat | null) => void }) {
  const [plan, setPlan] = useState<SharedPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = planCodeFromLocation()
    if (!code) return
    decodePlan(code)
      .then(setPlan)
      .catch(() => setError('This mission link is damaged or incomplete. Ask for it to be sent again.'))
  }, [])

  const dismiss = () => {
    // Drop the code from the address bar so a reload doesn't ask again.
    history.replaceState(null, '', window.location.pathname + window.location.search)
    setPlan(null)
    setError(null)
  }

  if (error) {
    return (
      <Dialog title="Can't open mission" onClose={dismiss}>
        <p className="dialog-lede">{error}</p>
        <div className="dialog-actions">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={dismiss}>
            OK
          </button>
        </div>
      </Dialog>
    )
  }
  if (!plan) return null

  const hasPlan = (() => {
    const s = usePlanner.getState()
    return !!(s.area || s.orbitCenter)
  })()

  return (
    <Dialog title="Open shared mission" onClose={dismiss}>
      <p className="dialog-lede">
        <strong>{plan.name}</strong>: {describe(plan)}.
        {hasPlan && ' It replaces the mission currently on this device.'}
      </p>
      <div className="dialog-actions">
        <span className="spacer" />
        <button className="btn" onClick={dismiss}>
          Keep current
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            const s = usePlanner.getState()
            s.loadPlan(plan)
            dismiss()
            const first = plan.parts[0]
            onOpened(first.type === 'grid' ? (first.area?.[0] ?? null) : (first.center ?? null))
            // The point of a hand-off is getting it onto the drone, so go straight there.
            s.setSendOpen(true)
          }}
        >
          Open mission
        </button>
      </div>
    </Dialog>
  )
}
