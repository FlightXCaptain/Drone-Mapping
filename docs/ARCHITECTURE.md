# Drone Mapping – Architecture & Roadmap

## Goal

Make it easy for anyone (operator or client) to **draw a capture area on a live map, tune
the flight, send it to their DJI drone, and later turn the photos into a photogrammetry
model or a Gaussian splat**. The core of the product is flight planning and getting missions onto DJI drones.

## The hard constraint: getting missions onto DJI aircraft

DJI does not offer one universal path. Each class of aircraft needs its own:

| Aircraft class | App on the controller | How a mission gets in | Status |
|---|---|---|---|
| Enterprise (M3E/M3T/M3M, M30, M350/M300, M4E/M4T, Matrice 3D/4D) | DJI Pilot 2 | **Native WPML KMZ import**, also FlightHub 2 / Cloud API | ✅ `pilot2` export |
| Consumer with waypoints (Mini 4/5 Pro, Air 3/3S, Mavic 3 series, Mavic 4 Pro) | DJI Fly | WPML KMZ via the **file-replacement workaround** | ✅ `djifly` export |
| Older/no-waypoint consumer (Mini 2/3, Air 2S, Mavic 2…) | Litchi / third party | Litchi Mission Hub CSV | ✅ `litchi` export |
| Any MSDK v5-supported aircraft | **Our own Android app** (future) | Direct upload with `WaypointMissionManager` | 🔜 phase 3 |

DJI's **WPML** (Waypoint Markup Language: a KMZ containing `wpmz/template.kml` and
`wpmz/waylines.wpml`) is the common format. DJI Pilot 2, DJI Fly, FlightHub 2 and MSDK v5
all consume it, so our main exporter targets WPML and adjusts it per aircraft.

### Drone profiles

Every aircraft is a `DroneProfile`. That's how "any client can select or add their drone"
works:

- camera geometry: sensor size, real focal length, pixel dimensions. These drive GSD,
  footprint and spacing.
- performance: max speed, rated flight time, minimum photo interval, max waypoints.
- export targets and WPML enum IDs, which tell DJI apps which aircraft and payload the file is for.

Built-in profiles live in `app/src/domain/drones.ts`. Clients can copy or add their own in the UI
(stored locally for now, synced per-organisation later).

## Architecture

```
app/  (React + Vite + TypeScript, runs entirely in the browser, installable as a PWA later)
 └─ src/
    ├─ domain/          Pure TS, no UI. Unit tested. Portable to a future mobile app.
    │   ├─ photogrammetry.ts   GSD ⇄ altitude, footprint, overlap → spacing
    │   ├─ geo.ts              local metric frame, distance, bearing
    │   ├─ planners/grid.ts    lawnmower (+crosshatch) over any polygon
    │   ├─ planners/orbit.ts   multi-ring POI orbits for splats / objects
    │   ├─ stats.ts            time, distance, photos, batteries, warnings
    │   └─ drones.ts           built-in aircraft profiles
    ├─ export/          Mission → device formats
    │   ├─ wpml.ts             DJI KMZ (Pilot 2 / DJI Fly)
    │   └─ litchi.ts           Litchi CSV
    ├─ components/      MapLibre map, Terra Draw editing, controls
    └─ store.ts         zustand, persisted to localStorage
```

**Key design choice: one drone-agnostic `Mission` model.** Planners output waypoints plus
"shoot every N metres" interval segments. Exporters translate that into whatever the target
understands. When an app can't do distance-interval shooting, the planner's `waypoint`
trigger mode turns every photo into a waypoint instead.

**Map stack:** MapLibre GL (open source, no API key) with Esri World Imagery satellite tiles
and OSM streets. Terra Draw handles touch-friendly polygon drawing and editing. Every edit
re-plans the mission, which takes a few ms, so the route updates live while you drag a corner.

## Mission types

1. **Mapping grid**: nadir lawnmower for orthomosaics and DEMs. Presets: *2D map* (75/65 % overlap, nadir)
   and *3D model* (80/70 %, −65° oblique, crosshatch).
2. **Orbit / splat**: stacked rings around a subject, each aimed at the subject's
   mid-height. Gaussian splats need dense, varied viewpoints, so the defaults are 3 rings × 36 photos.

Planned next:
- **Terrain follow**: sample a DEM (e.g. Mapbox Terrain-RGB / AWS Terrain Tiles) along each
  line and emit per-waypoint heights. WPML supports `executeHeightMode=WGS84` for this.
- **Facade / vertical scan** for buildings and cliffs.
- **Corridor** (roads, powerlines) from a drawn line.
- **Mission splitting by battery**: break a large area into resumable chunks.
- **Obstacle and airspace overlays**: CASA/FAA no-fly zones, height limits.
- **Import KML/KMZ/GeoJSON boundaries** from a client.

## Processing pipeline (phase 2)

Photos → model, using the Docker hosts already on the LAN:

- **Photogrammetry**: [NodeODM / WebODM](https://github.com/OpenDroneMap/WebODM) container on
  DockerBox. The app uploads an image set (or points ODM at an SMB share) and polls task
  status. Outputs: orthophoto, DSM/DTM, textured mesh, point cloud.
- **Gaussian splats**: COLMAP for camera poses (or reuse ODM's SfM), then
  [gsplat / nerfstudio `splatfacto`](https://github.com/nerfstudio-project/gsplat). This needs
  an NVIDIA GPU, so it runs on DockerBox2 (Docker Desktop with WSL2 GPU). Output `.ply` / `.spz`,
  viewed in-browser with a WebGL splat viewer.
- A small job API (Node or Python) queues jobs, stores results, and serves
  viewer links back to the app.

## Phase plan

1. **Planner MVP** (this commit): draw area or point, grid or orbit, live stats, KMZ/CSV export,
   custom drones.
2. **Field polish**: PWA offline tiles, terrain follow, KML import, mission library, split by
   battery, airspace overlay.
3. **Android companion (DJI MSDK v5)**: runs on the RC Pro / RC Plus / phone, pulls missions from
   the web app by QR code or link, uploads them straight to the aircraft and shows live telemetry.
   This removes the DJI Fly file-swap step.
4. **Processing**: upload photos → ODM / splat jobs → in-browser 3D viewers.
5. **Multi-tenant**: organisations, client portals, shared drone fleets, auth.
