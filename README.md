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
connected by USB, and **DJI Fly closed**:

```powershell
.\tools\send-to-dji-fly.ps1            # newest .kmz in Downloads → pick the placeholder
.\tools\send-to-dji-fly.ps1 -WhatIf    # dry run: lists missions and backs up, changes nothing
```

The placeholder's thumbnail in DJI Fly keeps showing the old route; open the mission to see the new one.
