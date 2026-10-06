import { useEffect, useRef, useState } from 'react'

export interface ViewerModel {
  title: string
  kind: 'mesh' | 'splat' | 'points'
  /** Local file path of a .glb / .obj (mesh), or a .ply (splat or point cloud). */
  path: string
}

/**
 * Full-window 3D viewer for results: textured photogrammetry meshes (GLB, or OBJ + MTL + PNG
 * textures as OpenDroneMap writes them) and Gaussian splats (PLY, rendered with Spark).
 * three.js and Spark load on first use so they don't slow down the planner.
 */
export function ModelViewer({ model, onClose }: { model: ViewerModel; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Loading…')
  const resetView = useRef<() => void>(() => {})
  const pointSize = useRef<(f: number) => void>(() => {})

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    ;(async () => {
      const THREE = await import('three')
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      if (disposed) return
      const el = host.current!
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
      renderer.setSize(el.clientWidth, el.clientHeight)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      el.appendChild(renderer.domElement)
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x1b2230)
      scene.add(new THREE.AmbientLight(0xffffff, 2.2))
      const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.05, 100000)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true

      const url = convertFileSrc(model.path)
      const dir = model.path.replace(/[\\/][^\\/]+$/, '')
      const dirUrl = convertFileSrc(dir) + '/'
      let object: import('three').Object3D

      try {
        if (model.kind === 'splat') {
          const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark')
          // Spark draws every splat in the scene through one SparkRenderer.
          scene.add(new SparkRenderer({ renderer }))
          const splat = new SplatMesh({ url })
          await splat.initialized
          // COLMAP's camera frame is y-down; turn it the right way up.
          splat.quaternion.set(1, 0, 0, 0)
          splat.updateMatrixWorld(true)
          object = splat
          scene.add(splat)
          // Frame the core of the scene: stray background splats would push the camera far out.
          const xs: number[] = [], ys: number[] = [], zs: number[] = []
          let i = 0
          splat.forEachSplat((_n, c) => {
            if (i++ % 7 === 0) {
              const w = c.clone().applyMatrix4(splat.matrixWorld)
              xs.push(w.x)
              ys.push(w.y)
              zs.push(w.z)
            }
          })
          const pct = (v: number[], q: number) => v.sort((a, b) => a - b)[Math.floor(q * (v.length - 1))] ?? 0
          frame(
            xs.length > 50
              ? new THREE.Box3(new THREE.Vector3(pct(xs, 0.05), pct(ys, 0.05), pct(zs, 0.05)), new THREE.Vector3(pct(xs, 0.95), pct(ys, 0.95), pct(zs, 0.95)))
              : splat.getBoundingBox(true).applyMatrix4(splat.matrixWorld),
          )
        } else if (model.kind === 'points') {
          const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
          const geometry = await new PLYLoader().loadAsync(url, onProgress)
          const material = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: geometry.hasAttribute('color') })
          pointSize.current = (f) => {
            material.size = Math.min(12, Math.max(1, material.size * f))
          }
          object = new THREE.Points(geometry, material)
          // Same z-up site frame as the 3D model.
          object.rotation.x = -Math.PI / 2
          object.updateMatrixWorld(true)
          controls.maxPolarAngle = Math.PI / 2 - 0.02
          scene.add(object)
          frame(new THREE.Box3().setFromObject(object))
        } else {
          if (/\.glb$/i.test(model.path)) {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
            object = (await new GLTFLoader().loadAsync(url, onProgress)).scene
          } else {
            const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js')
            const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
            const mtlFile = model.path.replace(/\.obj$/i, '.mtl').replace(/^.*[\\/]/, '')
            setStatus('Loading textures…')
            const materials = await new MTLLoader().setResourcePath(dirUrl).loadAsync(dirUrl + mtlFile)
            materials.preload()
            object = await new OBJLoader().setMaterials(materials).loadAsync(url, onProgress)
          }
          // OpenDroneMap models are z-up; stand them up for three.js's y-up camera controls,
          // and keep the camera above ground: a site is looked at from the air.
          // Anisotropic filtering: keeps fine repeating detail (corrugated roofs, car parks) from
          // turning into moiré stripes when seen at a glancing angle.
          const aniso = renderer.capabilities.getMaxAnisotropy()
          object.traverse((o) => {
            const mats = (o as import('three').Mesh).material
            for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
              const map = (m as import('three').MeshBasicMaterial).map
              if (map) {
                map.anisotropy = aniso
                map.needsUpdate = true
              }
            }
          })
          object.rotation.x = -Math.PI / 2
          object.updateMatrixWorld(true)
          controls.maxPolarAngle = Math.PI / 2 - 0.02
          scene.add(object)
          frame(new THREE.Box3().setFromObject(object))
        }
        if (!disposed) setStatus('')
      } catch (e) {
        if (!disposed) setStatus(`Couldn't open the model: ${e instanceof Error ? e.message : String(e)}`)
      }

      function onProgress(e: ProgressEvent) {
        if (!disposed && e.total) setStatus(`Loading… ${Math.round((100 * e.loaded) / e.total)}%`)
      }
      function frame(box: import('three').Box3) {
        const centre = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3()).length() || 10
        controls.target.copy(centre)
        // Look in from the south and above, like a drone's view of the site.
        const offset = model.kind === 'splat' ? new THREE.Vector3(0, 0.3, 1) : new THREE.Vector3(0.35, 0.75, 0.8)
        camera.position.copy(centre).add(offset.normalize().multiplyScalar(size * 0.9))
        camera.near = size / 1000
        camera.far = size * 20
        camera.updateProjectionMatrix()
        controls.update()
        controls.saveState()
      }
      resetView.current = () => controls.reset()

      let raf = 0
      const loop = () => {
        controls.update()
        renderer.render(scene, camera)
        raf = requestAnimationFrame(loop)
      }
      loop()
      const resize = () => {
        camera.aspect = el.clientWidth / el.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(el.clientWidth, el.clientHeight)
      }
      window.addEventListener('resize', resize)
      cleanup = () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
        controls.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    })()
    return () => {
      disposed = true
      cleanup()
    }
  }, [model])


  // A native modal <dialog>: it stacks above the processing window (also modal) without
  // closing it, so nothing chosen there is lost.
  const dlg = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = dlg.current!
    if (!d.open) d.showModal()
  }, [])

  return (
    <dialog ref={dlg} className="viewer" aria-label={`3D view: ${model.title}`} onClose={onClose}>
      <div className="viewer-canvas" ref={host} />
      <header className="viewer-bar">
        <b>{model.title}</b>
        <span className="fine">Drag to turn · right-drag or Shift-drag to move · scroll to zoom</span>
        <span className="spacer" />
        {model.kind === 'points' && (
          <>
            <button className="btn" onClick={() => pointSize.current(1 / 1.5)} aria-label="Smaller points" title="Smaller points">
              −
            </button>
            <button className="btn" onClick={() => pointSize.current(1.5)} aria-label="Larger points" title="Larger points">
              +
            </button>
          </>
        )}
        <button className="btn" onClick={() => resetView.current()}>
          Reset view
        </button>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </header>
      {status && <p className="viewer-status">{status}</p>}
    </dialog>
  )
}
