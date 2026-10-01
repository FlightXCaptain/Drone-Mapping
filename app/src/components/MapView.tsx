import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
// MapLibre 6 locates its worker relative to its own module URL, which Vite's bundling breaks.
// `?worker&url` makes Vite bundle the worker (with its shared chunk) and hand us a stable URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  TerraDraw,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { usePlanner } from '../store'
import type { LngLat, Mission } from '../domain/types'
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
          new TerraDrawPointMode(),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } },
              },
              point: { feature: { draggable: true } },
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
      if (initialCenter) {
        draw.addFeatures([
          {
            id: crypto.randomUUID(),
            type: 'Feature',
            geometry: { type: 'Point', coordinates: initialCenter },
            properties: { mode: 'point' },
          },
        ])
      }

      // Terra Draw is the source of truth while editing; push its geometry into the store.
      const sync = (keepId?: string | number) => {
        const features = draw.getSnapshot()
        const polys = features.filter((f) => f.geometry.type === 'Polygon')
        const points = features.filter((f) => f.geometry.type === 'Point' && f.properties.mode === 'point')
        // Only one area and one orbit centre at a time – a newly finished shape replaces the old.
        for (const group of [polys, points]) {
          if (group.length > 1 && keepId !== undefined) {
            draw.removeFeatures(group.filter((f) => f.id !== keepId).map((f) => f.id!))
          }
        }
        const poly = draw.getSnapshot().find((f) => f.geometry.type === 'Polygon')
        const point = draw.getSnapshot().find((f) => f.geometry.type === 'Point' && f.properties.mode === 'point')
        const s = usePlanner.getState()
        s.setArea(poly ? ((poly.geometry as GeoJSON.Polygon).coordinates[0] as LngLat[]) : null)
        s.setOrbitCenter(point ? ((point.geometry as GeoJSON.Point).coordinates as LngLat) : null)
      }

      draw.on('finish', (id, ctx) => {
        sync(id)
        if (ctx.action === 'draw') {
          // Straight into edit mode so vertices can be nudged immediately.
          usePlanner.getState().setDrawTool('select')
          draw.setMode('select')
          draw.selectFeature(id)
        }
      })
      draw.on('change', (_ids, type) => {
        if (type === 'update' || type === 'delete') sync()
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
    drawRef.current!.setMode(drawTool ?? 'static')
  }, [drawTool, ready])

  // ---- External clears (Clear button) remove shapes from the drawing ---------------------
  useEffect(() => {
    if (!ready) return
    const draw = drawRef.current!
    const snap = draw.getSnapshot()
    const stale = snap.filter(
      (f) =>
        (area === null && f.geometry.type === 'Polygon') ||
        (orbitCenter === null && f.geometry.type === 'Point' && f.properties.mode === 'point'),
    )
    if (stale.length) draw.removeFeatures(stale.map((f) => f.id!))
  }, [area, orbitCenter, ready])

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
