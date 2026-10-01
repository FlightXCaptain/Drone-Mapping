import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 locates its worker relative to its own module URL, which Vite's bundling breaks.
// `?worker&url` makes Vite bundle the worker (with its shared chunk) and hand us a stable URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { usePlanner } from '../store'
import { bearingDeg, centroid, distanceM, localFrame } from '../domain/geo'
import type { LngLat, Mission } from '../domain/types'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

export type Basemap = 'satellite' | 'clarity' | 'streets'

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    // Esri's sharper, less-compressed mosaic; sometimes older imagery than World Imagery.
    clarity: {
      type: 'raster',
      tiles: ['https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
    streets: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'clarity', type: 'raster', source: 'clarity', layout: { visibility: 'none' } },
    { id: 'labels', type: 'raster', source: 'labels' },
    { id: 'streets', type: 'raster', source: 'streets', layout: { visibility: 'none' } },
  ],
}

const ROUTE = '#FFC629'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const feat = (geometry: GeoJSON.Geometry): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry })

/** Layers that can be grabbed, highest priority first. */
const GRAB_LAYERS = ['ring-hit', 'path-hit', 'orbit-disc', 'area-fill'] as const
type Grab = (typeof GRAB_LAYERS)[number]
const CURSOR: Record<Grab, string> = { 'ring-hit': 'ew-resize', 'path-hit': 'move', 'orbit-disc': 'move', 'area-fill': 'move' }

function circle(center: LngLat, radiusM: number, steps = 96): LngLat[] {
  const f = localFrame(center)
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / steps
    return f.toLngLat([Math.cos(a) * radiusM, Math.sin(a) * radiusM])
  })
}

/** Point `distance` metres from `origin` along `bearing` (degrees clockwise from north). */
function offset(origin: LngLat, bearing: number, distance: number): LngLat {
  const a = ((90 - bearing) * Math.PI) / 180
  return localFrame(origin).toLngLat([Math.cos(a) * distance, Math.sin(a) * distance])
}

function el(className: string, title: string, html = ''): HTMLDivElement {
  const d = document.createElement('div')
  d.className = className
  d.title = title
  d.innerHTML = html
  return d
}

const openRing = (ring: LngLat[]) => ring.slice(0, -1)
const closeRing = (pts: LngLat[]) => [...pts, pts[0]]

export function MapView({ mission, basemap, flyTo }: { mission: Mission | null; basemap: Basemap; flyTo: LngLat | null }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const [ready, setReady] = useState(false)

  const drawTool = usePlanner((s) => s.drawTool)
  const missionType = usePlanner((s) => s.missionType)
  const area = usePlanner((s) => s.area)
  const angleDeg = usePlanner((s) => s.grid.angleDeg)
  const orbitCenter = usePlanner((s) => s.orbitCenter)
  const radiusM = usePlanner((s) => s.orbit.radiusM)
  const rings = usePlanner((s) => s.orbit.rings)

  // Handle markers, created once per shape and repositioned on every change.
  const vertexMarkers = useRef<maplibregl.Marker[]>([])
  const midMarkers = useRef<maplibregl.Marker[]>([])
  const fixed = useRef<Record<string, maplibregl.Marker>>({})
  const onMap = useRef(new Set<string>())
  const startDragging = useRef(false)

  // ---- Map lifecycle -------------------------------------------------------------------
  useEffect(() => {
    const { area: initialArea, orbitCenter: initialCenter, missionType: t } = usePlanner.getState()
    const focus = t === 'orbit' ? initialCenter : initialArea?.[0]
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE,
      center: focus ?? [115.8575, -31.9523], // Perth
      zoom: focus ? 17 : 12,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right',
    )
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

    map.on('load', () => {
      for (const id of ['area', 'orbit-disc', 'orbit-ring', 'mission-path', 'mission-photos']) {
        map.addSource(id, { type: 'geojson', data: EMPTY })
      }
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#fff', 'fill-opacity': 0.14 } })
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'orbit-disc', type: 'fill', source: 'orbit-disc', paint: { 'fill-color': '#fff', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'path-casing', type: 'line', source: 'mission-path', paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.35 }, layout: { 'line-join': 'round' } })
      map.addLayer({ id: 'path', type: 'line', source: 'mission-path', paint: { 'line-color': ROUTE, 'line-width': 3 }, layout: { 'line-join': 'round' } })
      map.addLayer({
        id: 'photos',
        type: 'circle',
        source: 'mission-photos',
        minzoom: 15, // zoomed out they merge into a solid blob that hides the route
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 3.5],
          'circle-color': '#fff',
          'circle-stroke-color': '#000',
          'circle-stroke-width': 0.5,
        },
      })
      // Invisible, finger-wide hit areas over thin lines.
      map.addLayer({ id: 'path-hit', type: 'line', source: 'mission-path', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 } })
      map.addLayer({ id: 'ring-hit', type: 'line', source: 'orbit-ring', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 28 } })

      // Terra Draw only sketches new areas; once finished, the shape is handed to the store.
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawRectangleMode()],
      })
      draw.start()
      drawRef.current = draw
      draw.on('finish', (id) => {
        const f = draw.getSnapshot().find((x) => x.id === id)
        if (f?.geometry.type === 'Polygon') {
          const s = usePlanner.getState()
          s.setArea(f.geometry.coordinates[0] as LngLat[])
          s.setDrawTool(null)
        }
        draw.clear()
      })

      map.on('click', (e) => {
        const s = usePlanner.getState()
        if (s.drawTool !== 'point') return
        s.setOrbitCenter([e.lngLat.lng, e.lngLat.lat])
        s.setDrawTool(null)
      })

      installDragging(map)
      map.on('zoom', () => updateCompact.current())
      setReady(true)
    })

    return () => {
      drawRef.current?.stop()
      map.remove()
    }
  }, [])

  // ---- Drag shapes and routes directly ------------------------------------------------------
  function installDragging(map: maplibregl.Map) {
    const grabAt = (point: maplibregl.Point): Grab | null => {
      const layers = GRAB_LAYERS.filter((l) => map.getLayer(l))
      const hits = map.queryRenderedFeatures(point, { layers: [...layers] })
      return GRAB_LAYERS.find((l) => hits.some((h) => h.layer.id === l)) ?? null
    }

    map.on('mousemove', (e) => {
      if (dragging || usePlanner.getState().drawTool) return
      const g = grabAt(e.point)
      map.getCanvas().style.cursor = g ? CURSOR[g] : ''
    })

    let dragging = false
    const begin = (e: MapMouseEvent | MapTouchEvent) => {
      const s = usePlanner.getState()
      if (s.drawTool) return
      if ('points' in e && e.points.length > 1) return // pinch-zoom stays with the map
      // Handles (corners, rotate knob, Start pin…) are markers inside the map container, so their
      // presses bubble up here too. They have their own drag – don't also drag what's underneath.
      if ((e.originalEvent.target as Element | null)?.closest?.('.maplibregl-marker')) return
      const g = grabAt(e.point)
      if (!g) return
      e.preventDefault()
      map.dragPan.disable()
      dragging = true
      const start: LngLat = [e.lngLat.lng, e.lngLat.lat]
      const origArea = s.area
      const origStartNear = s.grid.startNear
      const origCenter = s.orbitCenter
      // Ring drags scale every ring by how far the grabbed ring moved.
      const origBase = s.orbit.radiusM
      const grabbedR = (() => {
        if (!origCenter) return origBase
        const d0 = distanceM(origCenter, start)
        const radii = s.orbit.rings.map((r) => r.radiusM ?? origBase)
        return radii.reduce((best, r) => (Math.abs(r - d0) < Math.abs(best - d0) ? r : best), radii[0] ?? origBase)
      })()

      const move = (ev: MapMouseEvent | MapTouchEvent) => {
        const st = usePlanner.getState()
        const p: LngLat = [ev.lngLat.lng, ev.lngLat.lat]
        const d: LngLat = [p[0] - start[0], p[1] - start[1]]
        const shift = (q: LngLat): LngLat => [q[0] + d[0], q[1] + d[1]]
        if ((g === 'area-fill' || g === 'path-hit') && origArea) {
          st.setArea(origArea.map(shift))
          if (origStartNear) st.updateGrid({ startNear: shift(origStartNear) })
        } else if (g === 'orbit-disc' && origCenter) {
          st.setOrbitCenter(shift(origCenter))
        } else if (g === 'ring-hit' && st.orbitCenter) {
          const k = distanceM(st.orbitCenter, p) / grabbedR
          st.updateOrbit({ radiusM: Math.max(5, Math.min(500, Math.round(origBase * k))) })
        }
      }
      const end = () => {
        dragging = false
        map.dragPan.enable()
        map.off('mousemove', move)
        map.off('touchmove', move)
      }
      map.on('mousemove', move)
      map.on('touchmove', move)
      map.once('mouseup', end)
      map.once('touchend', end)
    }
    map.on('mousedown', begin)
    map.on('touchstart', begin)
  }

  // ---- Sketch tool -----------------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const draw = drawRef.current!
    const mode = drawTool === 'polygon' || drawTool === 'rectangle' ? drawTool : 'static'
    if (draw.getMode() !== mode) draw.setMode(mode)
    mapRef.current!.getCanvas().style.cursor = drawTool ? 'crosshair' : ''
  }, [drawTool, ready])

  // ---- Shapes and route ----------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource).setData(data)
    const showArea = missionType === 'grid' && area
    const showOrbit = missionType === 'orbit' && orbitCenter
    set('area', showArea ? fc([feat({ type: 'Polygon', coordinates: [area] })]) : EMPTY)
    const radii = [...new Set(rings.map((r) => r.radiusM ?? radiusM))]
    const inner = Math.min(...radii)
    set('orbit-disc', showOrbit ? fc([feat({ type: 'Polygon', coordinates: [circle(orbitCenter, inner * 0.85)] })]) : EMPTY)
    set('orbit-ring', showOrbit ? fc(radii.map((r) => feat({ type: 'LineString', coordinates: circle(orbitCenter, r) }))) : EMPTY)
    const has = mission && mission.waypoints.length > 0
    set('mission-path', has ? fc([feat({ type: 'LineString', coordinates: mission.waypoints.map((w) => w.position) })]) : EMPTY)
    set('mission-photos', has ? fc(mission.photoPoints.map((p) => feat({ type: 'Point', coordinates: p }))) : EMPTY)
  }, [ready, missionType, area, orbitCenter, radiusM, rings, mission])

  // ---- Corner and midpoint handles (rebuilt only when the corner count changes) --------------
  const cornerCount = missionType === 'grid' && area ? area.length - 1 : 0
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    for (const m of [...vertexMarkers.current, ...midMarkers.current]) m.remove()
    vertexMarkers.current = []
    midMarkers.current = []
    if (!cornerCount) return

    for (let i = 0; i < cornerCount; i++) {
      const v = new maplibregl.Marker({ element: el('handle handle-corner', 'Drag to reshape. Double-tap to remove.'), draggable: true })
      v.on('drag', () => {
        const pts = openRing(usePlanner.getState().area!)
        const p = v.getLngLat()
        pts[i] = [p.lng, p.lat]
        usePlanner.getState().setArea(closeRing(pts))
      })
      v.getElement().addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const pts = openRing(usePlanner.getState().area!)
        if (pts.length <= 3) return
        pts.splice(i, 1)
        usePlanner.getState().setArea(closeRing(pts))
      })
      vertexMarkers.current.push(v.setLngLat([0, 0]).addTo(map))

      const mid = new maplibregl.Marker({ element: el('handle handle-mid', 'Drag to add a corner'), draggable: true })
      mid.on('dragend', () => {
        const pts = openRing(usePlanner.getState().area!)
        const p = mid.getLngLat()
        pts.splice(i + 1, 0, [p.lng, p.lat])
        usePlanner.getState().setArea(closeRing(pts))
      })
      midMarkers.current.push(mid.setLngLat([0, 0]).addTo(map))
    }
  }, [ready, cornerCount])

  useEffect(() => {
    if (!ready || !area || missionType !== 'grid') return
    const pts = openRing(area)
    vertexMarkers.current.forEach((m, i) => pts[i] && m.setLngLat(pts[i]))
    midMarkers.current.forEach((m, i) => {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (a && b) m.setLngLat([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
    })
  }, [ready, area, missionType])

  // ---- Fixed handles: rotate, start/end flags, orbit centre & edge ---------------------------
  useEffect(() => {
    if (!ready) return
    const make = (key: string, element: HTMLElement, draggable: boolean) => {
      const m = new maplibregl.Marker({ element, draggable })
      fixed.current[key] = m
      return m
    }

    make('rotate', el('handle handle-rotate', 'Drag to change flight-line direction', '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'), true).on('drag', () => {
      const s = usePlanner.getState()
      if (!s.area) return
      const p = fixed.current.rotate.getLngLat()
      s.updateGrid({ angleDeg: Math.round(bearingDeg(centroid(s.area), [p.lng, p.lat])) })
    })

    make('start', el('pin pin-start', 'Drag to choose where the flight starts', '<span class="pin-label">Start</span>'), true).on('drag', () => {
      const s = usePlanner.getState()
      const p = fixed.current.start.getLngLat()
      if (s.missionType === 'grid') s.updateGrid({ startNear: [p.lng, p.lat] })
      else if (s.orbitCenter) s.updateOrbit({ startBearingDeg: Math.round(bearingDeg(s.orbitCenter, [p.lng, p.lat])) })
    })
    // When released, the flag snaps to where the route really starts.
    fixed.current.start.on('dragstart', () => (startDragging.current = true))
    fixed.current.start.on('dragend', () => {
      startDragging.current = false
      snapStart.current()
    })

    make('end', el('pin pin-end', 'Where the flight finishes', '<span class="pin-label">End</span>'), false)

    make('centre', el('handle handle-centre', 'Drag to move the orbit'), true).on('drag', () => {
      const p = fixed.current.centre.getLngLat()
      usePlanner.getState().setOrbitCenter([p.lng, p.lat])
    })
    make('edge', el('handle handle-edge', 'Drag to resize the orbit', '<svg viewBox="0 0 24 24"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'), true).on('drag', () => {
      const s = usePlanner.getState()
      if (!s.orbitCenter) return
      const p = fixed.current.edge.getLngLat()
      const outer = Math.max(...s.orbit.rings.map((r) => r.radiusM ?? s.orbit.radiusM))
      const k = distanceM(s.orbitCenter, [p.lng, p.lat]) / outer
      s.updateOrbit({ radiusM: Math.max(5, Math.min(500, Math.round(s.orbit.radiusM * k))) })
    })

    return () => {
      Object.values(fixed.current).forEach((m) => m.remove())
      fixed.current = {}
      onMap.current.clear()
    }
  }, [ready])

  const snapStart = useRef(() => {})

  // Too small on screen to edit: hide the extra handles so they don't pile up on each other.
  const updateCompact = useRef(() => {})
  updateCompact.current = () => {
    const map = mapRef.current
    if (!map) return
    const s = usePlanner.getState()
    let extentPx = Infinity
    if (s.missionType === 'grid' && s.area) {
      const px = s.area.map((p) => map.project(p))
      const xs = px.map((p) => p.x)
      const ys = px.map((p) => p.y)
      extentPx = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    } else if (s.missionType === 'orbit' && s.orbitCenter) {
      const outer = Math.max(...s.orbit.rings.map((r) => r.radiusM ?? s.orbit.radiusM))
      extentPx = 2 * Math.abs(map.project(offset(s.orbitCenter, 90, outer)).x - map.project(s.orbitCenter).x)
    }
    map.getContainer().classList.toggle('compact', extentPx < 70)
  }
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const f = fixed.current
    const place = (key: string, at: LngLat | null) => {
      const m = f[key]
      if (!at) {
        m.remove()
        onMap.current.delete(key)
        return
      }
      m.setLngLat(at)
      // addTo() removes and re-adds the marker, which would cancel a drag in progress.
      if (!onMap.current.has(key)) {
        m.addTo(map)
        onMap.current.add(key)
      }
    }
    const wps = mission?.waypoints ?? []
    const first = wps[0]?.position ?? null
    const last = wps.at(-1)?.position ?? null
    snapStart.current = () => place('start', first)
    if (!startDragging.current) place('start', first)
    place('end', missionType === 'grid' ? last : null) // an orbit ends next to its start

    if (missionType === 'grid' && area) {
      const c = centroid(area)
      const reach = Math.max(...openRing(area).map((p) => distanceM(c, p))) + 25
      place('rotate', offset(c, angleDeg, reach))
    } else place('rotate', null)

    place('centre', missionType === 'orbit' ? orbitCenter : null)
    updateCompact.current()
    const outer = Math.max(...rings.map((r) => r.radiusM ?? radiusM))
    place('edge', missionType === 'orbit' && orbitCenter ? offset(orbitCenter, 90, outer) : null)
  }, [ready, mission, missionType, area, angleDeg, orbitCenter, radiusM, rings])

  // ---- Basemap & fly-to ------------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    map.setLayoutProperty('satellite', 'visibility', vis(basemap === 'satellite'))
    map.setLayoutProperty('clarity', 'visibility', vis(basemap === 'clarity'))
    map.setLayoutProperty('labels', 'visibility', vis(basemap !== 'streets'))
    map.setLayoutProperty('streets', 'visibility', vis(basemap === 'streets'))
  }, [basemap, ready])

  useEffect(() => {
    if (ready && flyTo) mapRef.current!.flyTo({ center: flyTo, zoom: 17 })
  }, [flyTo, ready])

  return <div ref={container} className="map" />
}
