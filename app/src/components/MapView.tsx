import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
// MapLibre 6 locates its worker relative to its own module URL, which Vite's bundling breaks.
// `?worker&url` makes Vite bundle the worker (with its shared chunk) and hand us a stable URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { usePlanner } from '../store'
import type { LngLat, Mission } from '../domain/types'
import { localFrame } from '../domain/geo'
import { PlaceSearch } from './PlaceSearch'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

export type Basemap = 'satellite' | 'streets'

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
    { id: 'labels', type: 'raster', source: 'labels' },
    { id: 'streets', type: 'raster', source: 'streets', layout: { visibility: 'none' } },
  ],
}

function handleEl(className: string, title: string) {
  const el = document.createElement('div')
  el.className = `map-handle ${className}`
  el.title = title
  return el
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function missionGeoJSON(mission: Mission | null) {
  if (!mission || mission.waypoints.length === 0) return { path: EMPTY, photos: EMPTY, ends: EMPTY }
  const coords = mission.waypoints.map((w) => w.position)
  return {
    path: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }],
    } as GeoJSON.FeatureCollection,
    photos: {
      type: 'FeatureCollection',
      features: mission.photoPoints.map((p) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: p },
      })),
    } as GeoJSON.FeatureCollection,
    ends: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coords[0] } },
        { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: coords.at(-1)! } },
      ],
    } as GeoJSON.FeatureCollection,
  }
}

export function MapView({ mission }: { mission: Mission | null }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const [ready, setReady] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('satellite')

  const drawTool = usePlanner((s) => s.drawTool)
  const area = usePlanner((s) => s.area)
  const orbitCenter = usePlanner((s) => s.orbitCenter)
  const radiusM = usePlanner((s) => s.orbit.radiusM)
  const missionType = usePlanner((s) => s.missionType)
  const orbitHandles = useRef<{ centre: maplibregl.Marker; edge: maplibregl.Marker } | null>(null)
  const handlesOnMap = useRef(false)
  const edgeBearing = useRef(0) // radians from east; remembers where the user left the resize handle

  // ---- Map + Terra Draw lifecycle -------------------------------------------------------
  useEffect(() => {
    const { area: initialArea, orbitCenter: initialCenter } = usePlanner.getState()
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE,
      center: initialCenter ?? initialArea?.[0] ?? [115.8575, -31.9523], // Perth
      zoom: initialArea || initialCenter ? 16 : 12,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right',
    )
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      // Mission layers go in first so Terra Draw's editing handles render above them.
      map.addSource('mission-path', { type: 'geojson', data: EMPTY })
      map.addSource('mission-photos', { type: 'geojson', data: EMPTY })
      map.addSource('mission-ends', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'mission-path-casing',
        type: 'line',
        source: 'mission-path',
        paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.4 },
      })
      map.addLayer({
        id: 'mission-path',
        type: 'line',
        source: 'mission-path',
        paint: { 'line-color': '#ffd400', 'line-width': 2.5 },
      })
      map.addLayer({
        id: 'mission-photos',
        type: 'circle',
        source: 'mission-photos',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 19, 4],
          'circle-color': '#fff',
          'circle-stroke-color': '#000',
          'circle-stroke-width': 0.5,
        },
      })
      map.addLayer({
        id: 'mission-ends',
        type: 'circle',
        source: 'mission-ends',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'kind'], 'start', '#22c55e', '#ef4444'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      })

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode(),
          new TerraDrawRectangleMode(),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } },
              },
            },
          }),
        ],
      })
      draw.start()
      drawRef.current = draw

      if (initialArea) {
        draw.addFeatures([
          {
            id: crypto.randomUUID(),
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [initialArea] },
            properties: { mode: 'polygon' },
          },
        ])
      }

      // Terra Draw is the source of truth while editing an area; push its geometry into the store.
      const sync = (keepId?: string | number) => {
        const polys = draw.getSnapshot().filter((f) => f.geometry.type === 'Polygon')
        // Only one area at a time – a newly finished shape replaces the old one.
        if (polys.length > 1 && keepId !== undefined) {
          draw.removeFeatures(polys.filter((f) => f.id !== keepId).map((f) => f.id!))
        }
        const poly = draw.getSnapshot().find((f) => f.geometry.type === 'Polygon')
        usePlanner.getState().setArea(poly ? ((poly.geometry as GeoJSON.Polygon).coordinates[0] as LngLat[]) : null)
      }

      draw.on('finish', (id, ctx) => {
        sync(id)
        // Straight into edit mode (the tool effect selects the shape) so corners can be nudged immediately.
        if (ctx.action === 'draw') usePlanner.getState().setDrawTool('select')
      })
      draw.on('change', (_ids, type) => {
        if (type === 'update' || type === 'delete') sync()
      })

      // Orbit subject placement is a plain map tap – no Terra Draw involvement.
      map.on('click', (e) => {
        const s = usePlanner.getState()
        if (s.drawTool !== 'point') return
        s.setOrbitCenter([e.lngLat.lng, e.lngLat.lat])
        s.setDrawTool(null)
      })

      setReady(true)
    })

    return () => {
      drawRef.current?.stop()
      map.remove()
    }
  }, [])

  // ---- Tool selection --------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const draw = drawRef.current!
    const mode = drawTool === 'point' || drawTool === null ? 'static' : drawTool
    // Re-setting the current mode would reset it and drop the selection, so only switch on change.
    if (draw.getMode() !== mode) draw.setMode(mode)
    if (mode === 'select') {
      // Pre-select the area so its corners are draggable with no extra tap.
      const poly = draw.getSnapshot().find((f) => f.geometry.type === 'Polygon')
      if (poly) draw.selectFeature(poly.id!)
    }
    mapRef.current!.getCanvas().style.cursor = drawTool === 'point' ? 'crosshair' : ''
  }, [drawTool, ready])

  // ---- External clears (Clear button) remove the area from the drawing ------------------
  useEffect(() => {
    if (!ready || area !== null) return
    const draw = drawRef.current!
    const stale = draw.getSnapshot().filter((f) => f.geometry.type === 'Polygon')
    if (stale.length) draw.removeFeatures(stale.map((f) => f.id!))
  }, [area, ready])

  // ---- Orbit handles: drag the centre to move, drag the edge handle to resize -------------
  useEffect(() => {
    if (!ready) return
    const centre = new maplibregl.Marker({ element: handleEl('orbit-centre', 'Drag to move orbit'), draggable: true })
    const edge = new maplibregl.Marker({ element: handleEl('orbit-edge', 'Drag to resize orbit'), draggable: true })
    orbitHandles.current = { centre, edge }

    centre.on('drag', () => {
      const p = centre.getLngLat()
      usePlanner.getState().setOrbitCenter([p.lng, p.lat])
    })
    edge.on('drag', () => {
      const s = usePlanner.getState()
      if (!s.orbitCenter) return
      const p = edge.getLngLat()
      const [x, y] = localFrame(s.orbitCenter).toXY([p.lng, p.lat])
      edgeBearing.current = Math.atan2(y, x)
      s.updateOrbit({ radiusM: Math.max(5, Math.min(500, Math.round(Math.hypot(x, y)))) })
    })
    return () => {
      centre.remove()
      edge.remove()
      handlesOnMap.current = false
    }
  }, [ready])

  useEffect(() => {
    const h = orbitHandles.current
    if (!ready || !h) return
    const map = mapRef.current!
    if (missionType !== 'orbit' || !orbitCenter) {
      h.centre.remove()
      h.edge.remove()
      handlesOnMap.current = false
      return
    }
    const a = edgeBearing.current
    h.centre.setLngLat(orbitCenter)
    h.edge.setLngLat(localFrame(orbitCenter).toLngLat([Math.cos(a) * radiusM, Math.sin(a) * radiusM]))
    // addTo() removes and re-adds the marker, which would cancel a drag in progress – add once only.
    if (!handlesOnMap.current) {
      h.centre.addTo(map)
      h.edge.addTo(map)
      handlesOnMap.current = true
    }
  }, [orbitCenter, radiusM, missionType, ready])

  // ---- Mission overlay --------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const g = missionGeoJSON(mission)
    ;(map.getSource('mission-path') as GeoJSONSource).setData(g.path)
    ;(map.getSource('mission-photos') as GeoJSONSource).setData(g.photos)
    ;(map.getSource('mission-ends') as GeoJSONSource).setData(g.ends)
  }, [mission, ready])

  // ---- Basemap -----------------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const sat = basemap === 'satellite' ? 'visible' : 'none'
    map.setLayoutProperty('satellite', 'visibility', sat)
    map.setLayoutProperty('labels', 'visibility', sat)
    map.setLayoutProperty('streets', 'visibility', basemap === 'streets' ? 'visible' : 'none')
  }, [basemap, ready])

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <div className="map-overlay-top">
        <PlaceSearch onPick={(c) => mapRef.current?.flyTo({ center: c, zoom: 17 })} />
        <div className="seg">
          <button className={basemap === 'satellite' ? 'on' : ''} onClick={() => setBasemap('satellite')}>
            Satellite
          </button>
          <button className={basemap === 'streets' ? 'on' : ''} onClick={() => setBasemap('streets')}>
            Streets
          </button>
        </div>
      </div>
    </div>
  )
}
