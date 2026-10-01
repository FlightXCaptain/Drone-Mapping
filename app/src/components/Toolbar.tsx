import { usePlanner, type DrawTool } from '../store'

const ICONS: Record<string, string> = {
  polygon: 'M5 19l-1-9 8-6 8 6-2 9z',
  rectangle: 'M4 6h16v12H4z',
  point: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3',
  clear: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** One sentence telling the user what they can do right now. */
function hint(s: ReturnType<typeof usePlanner.getState>): string {
  if (s.drawTool === 'polygon') return 'Tap each corner. Tap the first corner again to finish.'
  if (s.drawTool === 'rectangle') return 'Tap one corner, then the opposite corner.'
  if (s.drawTool === 'point') return 'Tap the subject you want to orbit.'
  if (s.missionType === 'grid') {
    return s.area
      ? 'Drag to move or reshape. Use ⟳ to rotate the lines, and drag Start to change the entry.'
      : 'Outline the site to plan a mapping flight.'
  }
  return s.orbitCenter
    ? 'Drag inside to move, drag the ring to resize.'
    : 'Place the subject to plan an orbit.'
}

export function Toolbar() {
  const s = usePlanner()
  const tools: [Exclude<DrawTool, null>, string][] =
    s.missionType === 'grid'
      ? [
          ['polygon', s.area ? 'Redraw' : 'Draw area'],
          ['rectangle', 'Rectangle'],
        ]
      : [['point', s.orbitCenter ? 'Move subject' : 'Place subject']]
  const hasShape = s.missionType === 'grid' ? !!s.area : !!s.orbitCenter

  return (
    <div className="toolbar-wrap">
      <p className="hint" role="status">{hint(s)}</p>
      <div className="toolbar" role="toolbar" aria-label="Drawing tools">
        {s.drawTool ? (
          <button className="tool" onClick={() => s.setDrawTool(null)}>
            Cancel
          </button>
        ) : (
          <>
            {tools.map(([tool, label]) => (
              <button key={tool} className="tool" onClick={() => s.setDrawTool(tool)}>
                <Icon name={tool} />
                {label}
              </button>
            ))}
            {hasShape && (
              <button
                className="tool tool-quiet"
                aria-label="Clear"
                title="Clear"
                onClick={() => (s.missionType === 'grid' ? s.setArea(null) : s.setOrbitCenter(null))}
              >
                <Icon name="clear" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
