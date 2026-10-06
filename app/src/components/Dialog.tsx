import { useEffect, useRef, type ReactNode } from 'react'

/** Native <dialog>: focus trapping, Esc to close and backdrop come for free. */
export function Dialog({
  title,
  onClose,
  onMinimise,
  children,
}: {
  title: string
  onClose: () => void
  /** Shows a minimise button: for windows whose work carries on while you use the map. */
  onMinimise?: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Open once. No close() in cleanup: React dev mode re-runs effects, and close() would fire
  // the dialog's close event and dismiss it immediately. Unmounting removes it anyway.
  useEffect(() => {
    const d = ref.current!
    if (!d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="dialog"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
    >
      <div className="dialog-inner">
        <header>
          <h2>{title}</h2>
          <span className="spacer" />
          {onMinimise && (
            <button className="icon-btn" onClick={onMinimise} aria-label="Minimise" title="Minimise: keep working on the map">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M6 17h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
