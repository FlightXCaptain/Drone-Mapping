import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 locates its worker relative to its own module URL, which Vite's bundling breaks.
// `?worker&url` makes Vite bundle the worker (with its shared chunk) and hand us a stable URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { partLabel, usePlanner, type Part } from '../store'
import { useProcessingView } from '../processing'
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
const GRAB_LAYERS = ['ring-hit', 'path-hit', 'orbit-disc', 'area-fill', 'others-hit', 'others-fill'] as const
type Grab = (typeof GRAB_LAYERS)[number]
const CURSOR: Record<Grab, string> = {
  'ring-hit': 'ew-resize',
  'path-hit': 'move',
  'orbit-disc': 'move',
  'area-fill': 'move',
  'others-hit': 'move',
  'others-fill': 'move',
}

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

interface MapViewProps {
  /** Whole mission, all parts joined. */
  mission: Mission | null
  /** The part being edited, on its own. */
  activeMission: Mission | null
  parts: Part[]
  basemap: Basemap
  flyTo: LngLat | null
}

export function MapView({ mission, activeMission, parts, basemap, flyTo }: MapViewProps) {
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
  const chips = useRef<maplibregl.Marker[]>([])
  const inspectMarkers = useRef<maplibregl.Marker[]>([])
  const inspected = usePlanner((s) => s.inspected)
  const activePartId = usePlanner((s) => s.activePartId)
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
      for (const id of ['others', 'area', 'orbit-disc', 'orbit-ring', 'mission-path', 'active-path', 'mission-photos', 'inspect', 'photos-taken', 'photos-missing']) {
        map.addSource(id, { type: 'geojson', data: EMPTY })
      }
      // Other parts of the mission: faint, and not draggable (tap their number chip to edit).
      map.addLayer({ id: 'others-fill', type: 'fill', source: 'others', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#fff', 'fill-opacity': 0.06 } })
      map.addLayer({ id: 'others-line', type: 'line', source: 'others', filter: ['!=', 'kind', 'disc'], paint: { 'line-color': '#fff', 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [1, 2] } })
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#fff', 'fill-opacity': 0.14 } })
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'orbit-disc', type: 'fill', source: 'orbit-disc', paint: { 'fill-color': '#fff', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'path-casing', type: 'line', source: 'mission-path', paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.35 }, layout: { 'line-join': 'round' } })
      // Whole route dimmed; the part being edited is redrawn bright on top.
      map.addLayer({ id: 'path', type: 'line', source: 'mission-path', paint: { 'line-color': ROUTE, 'line-width': 2.5, 'line-opacity': 0.45 }, layout: { 'line-join': 'round' } })
      map.addLayer({ id: 'path-active', type: 'line', source: 'active-path', paint: { 'line-color': ROUTE, 'line-width': 3 }, layout: { 'line-join': 'round' } })
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
      // Photos from a flight (green) and planned shots with no photo (red), for the coverage check.
      map.addLayer({
        id: 'photos-taken',
        type: 'circle',
        source: 'photos-taken',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 19, 6], 'circle-color': '#22c55e', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 },
      })
      map.addLayer({
        id: 'photos-missing',
        type: 'circle',
        source: 'photos-missing',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 19, 8], 'circle-color': '#ef4444', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      })
      // Mission read back from the controller/file: cyan, drawn over everything for checking.
      map.addLayer({ id: 'inspect-casing', type: 'line', source: 'inspect', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.5 } })
      map.addLayer({ id: 'inspect-line', type: 'line', source: 'inspect', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-dasharray': [2, 1] } })
      // Invisible, finger-wide hit areas over thin lines.
      map.addLayer({ id: 'others-hit', type: 'line', source: 'others', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 } })
      map.addLayer({ id: 'path-hit', type: 'line', source: 'active-path', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 } })
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
    const grabAt = (point: maplibregl.Point): { layer: Grab; partId?: string } | null => {
      const layers = GRAB_LAYERS.filter((l) => map.getLayer(l))
      const hits = map.queryRenderedFeatures(point, { layers: [...layers] })
      for (const layer of GRAB_LAYERS) {
        const hit = hits.find((h) => h.layer.id === layer)
        if (hit) return { layer, partId: hit.properties?.partId as string | undefined }
      }
      return null
    }

    map.on('mousemove', (e) => {
      if (dragging || usePlanner.getState().drawTool) return
      const g = grabAt(e.point)
      map.getCanvas().style.cursor = g ? CURSOR[g.layer] : ''
    })

    let dragging = false
    const begin = (e: MapMouseEvent | MapTouchEvent) => {
      let s = usePlanner.getState()
      if (s.drawTool) return
      if ('points' in e && e.points.length > 1) return // pinch-zoom stays with the map
      // Handles (corners, rotate knob, Start pin…) are markers inside the map container, so their
      // presses bubble up here too. They have their own drag – don't also drag what's underneath.
      if ((e.originalEvent.target as Element | null)?.closest?.('.maplibregl-marker')) return
      const hit = grabAt(e.point)
      if (!hit) return
      let g: Grab = hit.layer
      // Grabbing another part switches to it and moves it, all in one gesture.
      if ((g === 'others-hit' || g === 'others-fill') && hit.partId) {
        s.selectPart(hit.partId)
        s = usePlanner.getState()
        g = s.missionType === 'grid' ? 'area-fill' : 'orbit-disc'
      }
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
    const act = activeMission && activeMission.waypoints.length > 0
    set('active-path', act ? fc([feat({ type: 'LineString', coordinates: activeMission.waypoints.map((w) => w.position) })]) : EMPTY)
    const others: GeoJSON.Feature[] = []
    for (const p of parts) {
      if (p.id === activePartId) continue
      const tag = (f: GeoJSON.Feature, kind = 'shape') => ({ ...f, properties: { partId: p.id, kind } })
      if (p.missionType === 'grid' && p.area) others.push(tag(feat({ type: 'Polygon', coordinates: [p.area] })))
      if (p.missionType === 'orbit' && p.orbitCenter) {
        const radii = [...new Set(p.orbit.rings.map((x) => x.radiusM ?? p.orbit.radiusM))]
        others.push(tag(feat({ type: 'Polygon', coordinates: [circle(p.orbitCenter, Math.max(...radii))] }), 'disc'))
        for (const r of radii) others.push(tag(feat({ type: 'LineString', coordinates: circle(p.orbitCenter, r) })))
      }
    }
    set('others', fc(others))
  }, [ready, missionType, area, orbitCenter, radiusM, rings, mission, activeMission, parts, activePartId])

  // ---- Part number chips: show flight order, tap to edit that part ----------------------------
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    chips.current.forEach((m) => m.remove())
    chips.current = []
    if (parts.length < 2) return
    parts.forEach((p, i) => {
      const at = p.missionType === 'grid' ? (p.area ? centroid(p.area) : null) : p.orbitCenter
      if (!at) return
      const active = p.id === activePartId
      const chip = el(`part-chip${active ? ' active' : ''}`, active ? `Editing part ${i + 1}` : `Edit part ${i + 1}: ${partLabel(p)}`, String(i + 1))
      chip.addEventListener('click', (e) => {
        e.stopPropagation()
        usePlanner.getState().selectPart(p.id)
      })
      // Offset so it doesn't cover the orbit centre handle or the middle of an area.
      chips.current.push(new maplibregl.Marker({ element: chip, offset: [0, -34] }).setLngLat(at).addTo(map))
    })
  }, [ready, parts, activePartId])

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
      else if (s.orbitCenter) {
        const bearing = Math.round(bearingDeg(s.orbitCenter, [p.lng, p.lat]))
        s.updateOrbit({ startBearingDeg: bearing })
        // Keep the pin on the first ring so dragging it feels like turning a dial.
        const r0 = s.orbit.rings[0]?.radiusM ?? s.orbit.radiusM
        fixed.current.start.setLngLat(offset(s.orbitCenter, bearing, r0))
      }
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
    const first = activeMission?.waypoints[0]?.position ?? null
    const last = mission?.waypoints.at(-1)?.position ?? null
    const idx = parts.findIndex((p) => p.id === activePartId)
    const label = f.start.getElement().querySelector('.pin-label')
    if (label) label.textContent = idx > 0 ? `Part ${idx + 1} start` : 'Start'
    snapStart.current = () => place('start', first)
    if (!startDragging.current) place('start', first)
    const lastPartIsOrbit = parts.at(-1)?.missionType === 'orbit'
    place('end', lastPartIsOrbit ? null : last) // an orbit ends next to its own start

    if (missionType === 'grid' && area) {
      const c = centroid(area)
      const reach = Math.max(...openRing(area).map((p) => distanceM(c, p))) + 25
      place('rotate', offset(c, angleDeg, reach))
    } else place('rotate', null)

    place('centre', missionType === 'orbit' ? orbitCenter : null)
    updateCompact.current()
    const outer = Math.max(...rings.map((r) => r.radiusM ?? radiusM))
    place('edge', missionType === 'orbit' && orbitCenter ? offset(orbitCenter, 90, outer) : null)
  }, [ready, mission, activeMission, parts, activePartId, missionType, area, angleDeg, orbitCenter, radiusM, rings])

  // ---- Mission check overlay ------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    inspectMarkers.current.forEach((m) => m.remove())
    inspectMarkers.current = []
    const src = map.getSource('inspect') as GeoJSONSource
    if (!inspected) return void src.setData(EMPTY)
    const pts = inspected.read.waypoints
    src.setData(fc([feat({ type: 'LineString', coordinates: pts.map((w) => w.position) })]))
    pts.forEach((w, i) => {
      const m = new maplibregl.Marker({ element: el('wp-num', `Waypoint ${i + 1}: ${w.heightM} m${w.photo ? ', photo' : ''}`, String(i + 1)) })
      inspectMarkers.current.push(m.setLngLat(w.position).addTo(map))
    })
    const lngs = pts.map((w) => w.position[0])
    const lats = pts.map((w) => w.position[1])
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: { top: 80, bottom: 160, left: 380, right: 460 }, maxZoom: 19, duration: 600 },
    )
  }, [inspected, ready])

  // ---- Processing: photo coverage and finished maps -------------------------------------------
  const photos = useProcessingView((s) => s.photos)
  const overlay = useProcessingView((s) => s.overlay)
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const points = (pts: LngLat[] = []) => fc(pts.map((c) => feat({ type: 'Point', coordinates: c })))
    ;(map.getSource('photos-taken') as GeoJSONSource).setData(points(photos?.taken))
    ;(map.getSource('photos-missing') as GeoJSONSource).setData(points(photos?.missing))
  }, [photos, ready])

  useEffect(() => {
    if (!ready || !overlay) return
    const map = mapRef.current!
    // Above the imagery, under the plan, so the route stays visible on the new map.
    map.addSource('result', { type: 'raster', tiles: [overlay.tiles], scheme: 'tms', tileSize: 256, bounds: overlay.bounds, maxzoom: 23 })
    map.addLayer({ id: 'result', type: 'raster', source: 'result' }, 'others-fill')
    const [w, s, e, n] = overlay.bounds
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: { top: 80, bottom: 160, left: 380, right: 120 }, maxZoom: 20, duration: 600 },
    )
    return () => {
      if (map.getLayer('result')) map.removeLayer('result')
      if (map.getSource('result')) map.removeSource('result')
    }
  }, [overlay, ready])

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
