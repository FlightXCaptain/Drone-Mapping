# Drone Mapping

Plan DJI drone photo missions on a live satellite map, then turn the photos into
photogrammetry models or Gaussian splats.

- **Draw** a capture area (polygon or rectangle) or drop a subject point, on satellite or street maps
  with place search and GPS location.
- **Tune** altitude or target GSD, overlap, line direction, speed, gimbal pitch and crosshatch,
  or multi-ring orbits for splats. The route, photo positions, flight time and battery count update live.
- **Pick any aircraft**: built-in DJI profiles, or add your own camera and aircraft specs.
- **Export** to DJI Pilot 2 (KMZ), DJI Fly (KMZ) or Litchi (CSV), with on-screen steps to load each one.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap.

## Develop

```bash
cd app
npm install
npm run dev     # http://localhost:5173
npm test        # planner + exporter unit tests
npm run build
```

> ⚠ Always check an imported mission in the flight app before flying: altitude, RC-lost
> behaviour, obstacles and local airspace rules. You are responsible for every flight.

## Loading missions into DJI Fly (RC 2 / RC / Android phone)

DJI Fly has no import, so a mission replaces a placeholder. With the controller **switched on**,
connected by USB, and **DJI Fly fully closed** (restart the controller; DJI Fly caches missions and
writes its old copy back if it is still running, so also restart it again after sending):

```powershell
.\tools\send-to-dji-fly.ps1            # newest .kmz in Downloads → pick the placeholder
.\tools\send-to-dji-fly.ps1 -WhatIf    # dry run: lists missions and backs up, changes nothing
```

The placeholder's thumbnail in DJI Fly keeps showing the old route; open the mission to see the new one.

**Safety:** the helper only ever writes `waypoint/<UUID>/<UUID>.kmz`, validates the mission first,
refuses to change anything without a verified backup (kept in `Documents\Drone Mapping\backups`),
verifies by hash afterwards and restores automatically on mismatch. Every action is logged to
`Documents\Drone Mapping\send-log.txt`. Put a backup back with
`.\tools\send-to-dji-fly.ps1 -Restore "<backup file>"`.

In the app, **Send to drone** shows *Send to DJI RC 2* when the app is opened on the PC the
controller is plugged into (served by `npm run dev` / `npm run preview`).

## Desktop app (Windows installer)

The planner also ships as a native Windows app (Tauri) with an MSI installer. In the desktop app,
"Send to DJI RC 2" talks to the controller through built-in commands. There's no local web
server, so nothing else on the PC or network can reach it.

```bash
cd app
npm run desktop          # run the desktop app in development
npm run desktop:build    # build → app/src-tauri/target/release/bundle/msi/Drone Mapping_<version>_x64_en-US.msi
```

Building needs Rust (rustup) and downloads the WiX toolset on first build. The installer adds a
Start-menu entry and installs Microsoft Edge WebView2 if it's missing (it's built into Windows 11).

Each new MSI installs straight over the previous version: the WiX upgrade code is pinned in
`tauri.conf.json` (don't change it), and every build removes any older copy before installing.
Bump the version in `tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json` together.

### Processing tools (optional, desktop only)

The **Processing** button (top right) installs the tools that turn flight photos into maps, 3D
models and Gaussian splats. They aren't in the MSI, which stays about 4 MB; each pack downloads
on request from the engine's official GitHub release, pinned to an exact version and SHA-256
in `src-tauri/src/engines.rs`:

| Pack | Engines | Download | On disk |
|---|---|---|---|
| Maps & 3D models | OpenDroneMap 3.6.2 (AGPL, run as a separate program) | 245 MB | ~1 GB |
| Gaussian splats | COLMAP 4.2.1 (BSD) + Brush 0.3.0 (Apache-2.0) | 287 MB | ~550 MB |

Packs install to `%LOCALAPPDATA%\com.flightxcaptain.dronemapping\engines\<pack>`, outside the
program folder, so app updates and reinstalls keep them. **Remove** runs ODM's own uninstaller,
then deletes the folder.
