import type { OrbitRing } from '../domain/planners/orbit'

/**
 * Side view of an orbit. From above, every ring sits on the same circle, so this is the only
 * place you can see that rings are stacked at different heights and where each one aims.
 */
export function OrbitProfile({ rings, radiusM, subjectHeightM }: { rings: OrbitRing[]; radiusM: number; subjectHeightM: number }) {
  const W = 300
  const H = 150
  const pad = { l: 14, r: 14, t: 14, b: 22 }
  const rOf = (r: OrbitRing) => r.radiusM ?? radiusM
  const maxR = Math.max(...rings.map(rOf), 1)
  const maxH = Math.max(subjectHeightM, ...rings.map((r) => r.altitudeM)) * 1.12
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  // Same scale on both axes so camera angles look true.
  const scale = Math.min(plotW / (2 * maxR * 1.15), plotH / maxH)
  const cx = W / 2
  const ground = H - pad.b
  const x = (m: number) => cx + m * scale
  const y = (m: number) => ground - m * scale
  const aimY = y(subjectHeightM / 2)
  const subjW = Math.max(10, maxR * 0.25 * scale)

  return (
    <figure className="profile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Side view of orbit rings and camera angles">
        <line x1={0} x2={W} y1={ground} y2={ground} className="pf-ground" />
        <rect x={cx - subjW / 2} y={y(subjectHeightM)} width={subjW} height={subjectHeightM * scale} className="pf-subject" />
        {rings.map((r, i) =>
          [-1, 1].map((side) => (
            <g key={`${i}${side}`}>
              <line x1={x(side * rOf(r))} y1={y(r.altitudeM)} x2={cx} y2={aimY} className="pf-sight" />
              <circle cx={x(side * rOf(r))} cy={y(r.altitudeM)} r={5} className="pf-drone" />
              {side === 1 && (
                <text x={x(rOf(r)) - 9} y={y(r.altitudeM) + 4} textAnchor="end" className="pf-label">
                  {r.altitudeM} m
                </text>
              )}
            </g>
          )),
        )}
      </svg>
      <figcaption>Side view. Each ring flies a full circle at its own height and distance, aimed at the middle of the subject.</figcaption>
    </figure>
  )
}
