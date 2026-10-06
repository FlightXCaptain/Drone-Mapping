<div align="center">

<img src="app/public/icon.svg" width="88" alt="">

# Drone Mapping

**Plan photo flights for DJI drones on a live satellite map, load them onto the controller, then
turn the photos into maps, 3D models and Gaussian splats, all from one app.**

[![CI](https://github.com/FlightXCaptain/Drone-Mapping/actions/workflows/ci.yml/badge.svg)](https://github.com/FlightXCaptain/Drone-Mapping/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/FlightXCaptain/Drone-Mapping?label=Windows%20installer)](https://github.com/FlightXCaptain/Drone-Mapping/releases/latest)

<img src="docs/images/plan.png" alt="A mapping grid and an orbit planned over Elizabeth Quay, Perth, with live flight stats" width="900">

</div>

---

## What it does

| | |
|---|---|
| **1. Plan** | Draw an area to map or drop a subject to orbit, right on satellite imagery. The route, photo positions, flight time and battery count update as you drag. |
| **2. Send** | One click puts the mission on a DJI RC 2 / RC over USB, with backups and verification. Or export for DJI Pilot 2 or Litchi, or hand it to a phone with a QR code. |
| **3. Check** | Read the mission back off the controller and see every waypoint on the map, with coordinates, heights and a diff against your plan, before you fly. |
| **4. Process** | Point the app at the photos. It checks every planned shot was taken, then makes an orthophoto map, a textured 3D model or a Gaussian splat on your PC. |

## Download

**Windows:** get the MSI from the [latest release](https://github.com/FlightXCaptain/Drone-Mapping/releases/latest)
and run it. Each new version installs straight over the previous one.

> The installer isn't code-signed yet, so Windows SmartScreen may ask you to confirm
> (*More info → Run anyway*).

The planner also runs in any browser (phone, tablet, laptop) and works offline once loaded; see
[Develop](#develop). Sending over USB and processing photos need the Windows app.

## Planning

<img src="docs/images/orbit.png" alt="Three stacked orbit rings around a tower, with the side profile showing each ring's height and camera angle" width="900">

- **Mapping grids** for orthophotos and elevation models. Set the detail you want (cm per pixel),
  and the app works out altitude, line spacing and photo interval from your drone's camera.
  Includes overlap, line angle, crosshatch for 3D, and a draggable start point.
- **Orbits** for 3D models and splats. Stack rings at different distances and heights, each
  aimed at the subject with its own photo count and start bearing. The side profile shows exactly
  how the camera sees the subject.
- **Multi-part missions.** Chain grids and orbits into one flight. The drone climbs to the higher
  part's height before crossing between them.
- **Battery-aware.** Flight time and battery count always keep a 20 % reserve, and the app warns
  about over-long flights, low altitude, photo intervals the camera can't keep up with, and more.
- **Any drone.** Built-in profiles for DJI Mini 4/5 Pro, Air 3/3S, Mavic 3/4 Pro, Mavic 3
  Enterprise, Matrice 4E/4T, M30 and more. Add your own from the camera's specs.
- **Live maps that feel live.** Drag corners, the whole area, the route, ring radii or the start
  point; everything re-plans instantly. Satellite, sharper "Clarity" imagery or streets, plus
  place search and GPS location.

## Sending to the drone

<img src="docs/images/send.png" alt="The Send to drone dialog: one-click send to a DJI RC 2, KMZ/CSV downloads and a QR hand-off" width="900">

| Your drone runs | How the mission gets there |
|---|---|
| **DJI Fly** (Mini 4/5 Pro, Air 3/3S, Mavic 3/4) | **Send to DJI RC 2**: the desktop app writes the mission into a placeholder over USB. Or download a KMZ. |
| **DJI Pilot 2** (Enterprise / Matrice) | Download a WPML KMZ and use *Import Route*. |
| **Litchi** (older drones without waypoints) | Download a Litchi Mission Hub CSV. |
| **A phone or tablet in the field** | Scan the QR code. The plan opens in the app on the phone, even offline. |

**Controller safety.** The USB transfer only ever writes one file
(`waypoint/<mission>/<mission>.kmz`). It validates the mission first, refuses to change anything
without a verified backup, checks the result by hash, and restores the backup automatically if
anything doesn't match. Every action is logged to `Documents\Drone Mapping\send-log.txt`.

> DJI Fly keeps missions in memory and can write its old copy back. **Restart the controller
> after sending**, then open the mission.

## Check before you fly

<img src="docs/images/check.png" alt="A mission read back from the controller, drawn on the map with numbered waypoints and a table of coordinates" width="900">

**Check what's on the controller** reads the mission back over USB (or from any KMZ file). It
draws the route and numbered waypoints on the map, lists every waypoint's coordinates, height and
actions, and flags differences from your plan, such as wrong waypoint count, start position or
heights.

## Processing photos

<img src="docs/images/process.png" alt="The Process photos dialog: photo coverage check, PC suitability ratings, and a running map job" width="900">

1. Click **Process photos** in the bottom bar and choose the folder of photos (or paste a path,
   e.g. the SD card's `DCIM\100MEDIA`).
2. The app reads each photo's GPS position and checks it against the plan: taken shots show
   green on the map, **missed shots red**. That's ideal for a reshoot before you leave site.
3. It rates how well this PC will cope (memory and processor for maps, graphics card for
   splats), then you pick **Fast / Standard / High** and make:
   - **Map & 3D model** with [OpenDroneMap](https://opendronemap.org): a georeferenced
     orthophoto shown right on the live map, a textured 3D mesh (OBJ) and a point cloud (LAZ).
   - **Gaussian splat** with [COLMAP](https://colmap.github.io) and
     [Brush](https://github.com/ArthurBrussee/brush): camera positions, then a trained splat
     (PLY) that opens in Brush's viewer.

<img src="docs/images/result.png" alt="An orthophoto made by the app, overlaid on the satellite map" width="900">

<sub>Example result made from the [Aukerman Park](https://github.com/OpenDroneMap/odm_data_aukerman)
sample photos (CC0).</sub>

The engines aren't bundled in the installer. In **Process photos → Processing tools**, each
pack downloads once from the tool's official GitHub release, pinned to an exact version and
SHA-256 fingerprint:

| Pack | Engines | Download | On disk |
|---|---|---|---|
| Maps & 3D models | OpenDroneMap 3.6.2 | 245 MB | ~1 GB |
| Gaussian splats | COLMAP 4.2.1 + Brush 0.3.0 | 287 MB | ~580 MB |

Results are saved under `Documents\Drone Mapping\Processing`, one folder per job, with the full
engine log. A 25-photo Fast map takes around 10–15 minutes on a typical laptop. Splats train on
the graphics card, so an NVIDIA or AMD card with 8 GB or more is much faster than built-in
graphics.

## On a phone

<img src="docs/images/phone.png" alt="The planner on a phone" width="300" align="right">

The planner is a progressive web app: open it on a phone or tablet, add it to the home screen,
and it works without signal. Plans move between devices as a link or QR code; nothing is uploaded
anywhere.

<br clear="right">

## Develop

```bash
cd app
npm install
npm run dev            # planner in the browser: http://localhost:5173
npm test               # planners, exporters, coverage and hardware rules (vitest)
npm run desktop        # the Windows app in development (needs Rust)
npm run desktop:build  # MSI → app/src-tauri/target/release/bundle/msi/
```

| Part | Tech |
|---|---|
| UI | React 19, TypeScript, Vite, MapLibre GL, Terra Draw, zustand |
| Flight planning | Pure TypeScript in `app/src/domain`: grids, orbits, multi-part missions, stats |
| Mission formats | `app/src/export`: DJI WPML KMZ (Pilot 2 and DJI Fly dialects), Litchi CSV, KMZ reader |
| Desktop app | Tauri 2 (Rust): controller transfer, processing packs, job runner |
| Controller transfer | `tools/send-to-dji-fly.ps1`: Windows Shell over MTP, with backup and restore |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, and how missions reach each
class of DJI drone.

**Releasing:** bump the version in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`
and `app/package.json`, then push a `v*` tag. The *Desktop installer* workflow builds the MSI.
Keep the WiX `upgradeCode` in `tauri.conf.json` unchanged, so new versions upgrade old ones in
place.

## Safety

Always check a mission in the flight app before take-off: altitude, return-to-home height,
obstacles, and the airspace rules where you fly. You are responsible for every flight.

## Credits

Built on [OpenDroneMap](https://github.com/OpenDroneMap/ODM) (AGPL-3.0, run as a separate
program), [COLMAP](https://github.com/colmap/colmap) (BSD), [Brush](https://github.com/ArthurBrussee/brush)
(Apache-2.0), [MapLibre GL JS](https://maplibre.org), [Terra Draw](https://terradraw.io) and
[Tauri](https://tauri.app). Imagery © Esri, Maxar, Earthstar Geographics; map data ©
OpenStreetMap contributors.

Not affiliated with or endorsed by DJI. DJI, DJI Fly and DJI Pilot are trademarks of SZ DJI
Technology Co., Ltd.
