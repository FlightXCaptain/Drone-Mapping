import { useState } from 'react'
import type { LngLat } from '../domain/types'

interface Result {
  display_name: string
  lon: string
  lat: string
}

/** Free-text place search via OpenStreetMap Nominatim (no API key; light use only). */
export function PlaceSearch({ onPick }: { onPick: (c: LngLat) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    // Accept raw "lat, lng" coordinates too – common when a client sends a pin.
    const m = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (m) {
      onPick([Number(m[2]), Number(m[1])])
      return
    }
    setBusy(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      setResults(res.ok ? await res.json() : [])
    } catch {
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="search">
      <form onSubmit={search}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search place or paste lat, lng"
          aria-label="Search location"
        />
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Go'}
        </button>
      </form>
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button
                onClick={() => {
                  onPick([Number(r.lon), Number(r.lat)])
                  setResults([])
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
