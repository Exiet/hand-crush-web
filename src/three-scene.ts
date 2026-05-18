import * as THREE from 'three'

export type FruitVisual = {
  group: THREE.Group
  body: THREE.Mesh
  shell: THREE.Mesh
  glow: THREE.Mesh
  leftHalf: THREE.Mesh
  rightHalf: THREE.Mesh
  leftCut: THREE.Mesh
  rightCut: THREE.Mesh
  stem?: THREE.Mesh
  leaf?: THREE.Mesh
  juiceColor: number
}

export type ThreeFruitScene = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  resize: (width: number, height: number) => void
  render: () => void
  createFruit: (texture: THREE.Texture, radius: number, juiceColor: number, variant: number) => FruitVisual
  removeFruit: (fruit: FruitVisual) => void
  projectToScreen: (position: THREE.Vector3) => { x: number; y: number; visible: boolean }
  setBackground: (texture: THREE.Texture | null) => void
}

export function createThreeFruitScene(canvas: HTMLCanvasElement): ThreeFruitScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.set(0, 0, 18)

  const ambient = new THREE.AmbientLight(0xffffff, 1.45)
  scene.add(ambient)

  const keyLight = new THREE.DirectionalLight(0xfff4da, 1.8)
  keyLight.position.set(-4, 6, 10)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0xb9d8ff, 1.1)
  fillLight.position.set(5, -2, 8)
  scene.add(fillLight)

  const rimLight = new THREE.PointLight(0xffffff, 1.2, 40)
  rimLight.position.set(0, 8, 10)
  scene.add(rimLight)

  let backgroundMesh: THREE.Mesh | null = null

  function setBackground(texture: THREE.Texture | null) {
    if (backgroundMesh) {
      scene.remove(backgroundMesh)
      backgroundMesh.geometry.dispose()
      ;(backgroundMesh.material as THREE.Material).dispose()
      backgroundMesh = null
    }
    if (!texture) return
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true

    const geometry = new THREE.PlaneGeometry(28, 20)
    const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false })
    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, -16)
    scene.add(plane)
    backgroundMesh = plane
  }

  function createFruit(texture: THREE.Texture, radius: number, juiceColor: number, variant: number): FruitVisual {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true

    const group = new THREE.Group()

    const bodyGeometry = new THREE.SphereGeometry(radius, 48, 48)
    if (variant === 0) bodyGeometry.scale(1.02, 0.92, 0.98)
    else if (variant === 1) bodyGeometry.scale(0.9, 1.02, 0.9)
    else if (variant === 2) bodyGeometry.scale(1.12, 0.78, 0.88)
    else if (variant === 3) bodyGeometry.scale(0.7, 1.28, 0.72)
    else bodyGeometry.scale(1.18, 0.84, 1.02)
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.62,
      metalness: 0.04,
      clearcoat: 0.28,
      clearcoatRoughness: 0.52,
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    group.add(body)

    const halfMaterial = bodyMaterial.clone()
    const leftHalf = new THREE.Mesh(bodyGeometry.clone(), halfMaterial)
    leftHalf.visible = false
    group.add(leftHalf)

    const rightHalf = new THREE.Mesh(bodyGeometry.clone(), halfMaterial.clone())
    rightHalf.visible = false
    group.add(rightHalf)

    const cutColor = new THREE.Color(juiceColor).lerp(new THREE.Color(0xffffff), 0.42)
    const cutGeometry = new THREE.CircleGeometry(radius * 0.82, 40)
    const cutMaterial = new THREE.MeshStandardMaterial({
      color: cutColor,
      roughness: 0.86,
      metalness: 0,
      emissive: new THREE.Color(juiceColor).multiplyScalar(0.08),
    })
    const leftCut = new THREE.Mesh(cutGeometry, cutMaterial)
    leftCut.position.x = radius * 0.02
    leftCut.rotation.y = Math.PI / 2
    leftCut.visible = false
    group.add(leftCut)

    const rightCut = new THREE.Mesh(cutGeometry.clone(), cutMaterial.clone())
    rightCut.position.x = -radius * 0.02
    rightCut.rotation.y = -Math.PI / 2
    rightCut.visible = false
    group.add(rightCut)

    const shellGeometry = new THREE.SphereGeometry(radius * 1.03, 48, 48)
    if (variant === 0) shellGeometry.scale(1.05, 0.95, 1)
    else if (variant === 1) shellGeometry.scale(0.95, 1.05, 0.95)
    else if (variant === 2) shellGeometry.scale(1.14, 0.82, 0.92)
    else if (variant === 3) shellGeometry.scale(0.74, 1.34, 0.76)
    else shellGeometry.scale(1.22, 0.88, 1.06)
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      side: THREE.DoubleSide,
    })
    const shell = new THREE.Mesh(shellGeometry, shellMaterial)
    group.add(shell)

    const glowGeometry = new THREE.RingGeometry(radius * 1.18, radius * 1.28, 48)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd86b,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const glow = new THREE.Mesh(glowGeometry, glowMaterial)
    glow.rotation.x = -Math.PI / 2
    glow.position.y = -radius * 0.92
    group.add(glow)

    if (variant !== 3) {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.06, radius * 0.08, radius * 0.34, 10),
        new THREE.MeshPhysicalMaterial({ color: variant === 2 ? 0x6d4c41 : 0x6b8f3e, roughness: 0.8 }),
      )
      stem.position.y = radius * 0.9
      stem.rotation.z = variant === 2 ? 0.5 : 0.2
      group.add(stem)

      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.2, 16, 16),
        new THREE.MeshPhysicalMaterial({ color: 0x5ca347, roughness: 0.84 }),
      )
      leaf.scale.set(1.3, 0.35, 0.75)
      leaf.position.set(radius * 0.12, radius * 0.96, 0)
      leaf.rotation.z = -0.5
      group.add(leaf)
      ;(group.userData as { stem?: THREE.Mesh; leaf?: THREE.Mesh }).stem = stem
      ;(group.userData as { stem?: THREE.Mesh; leaf?: THREE.Mesh }).leaf = leaf
    } else {
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(radius * 0.18, radius * 0.38, 12),
        new THREE.MeshPhysicalMaterial({ color: 0x3c8a3f, roughness: 0.9 }),
      )
      cap.position.y = radius * 1.12
      cap.rotation.z = 0.18
      group.add(cap)
      ;(group.userData as { stem?: THREE.Mesh; leaf?: THREE.Mesh }).stem = cap
    }

    scene.add(group)
    const extras = group.userData as { stem?: THREE.Mesh; leaf?: THREE.Mesh }
    return {
      group,
      body,
      shell,
      glow,
      leftHalf,
      rightHalf,
      leftCut,
      rightCut,
      stem: extras.stem,
      leaf: extras.leaf,
      juiceColor,
    }
  }

  function removeFruit(fruit: FruitVisual) {
    scene.remove(fruit.group)
  }

  function resize(width: number, height: number) {
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()

    if (backgroundMesh) {
      const distance = Math.abs(camera.position.z - backgroundMesh.position.z)
      const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance
      const visibleWidth = visibleHeight * camera.aspect
      backgroundMesh.scale.set(visibleWidth / 28, visibleHeight / 20, 1)
    }
  }

  function render() {
    renderer.render(scene, camera)
  }

  function projectToScreen(position: THREE.Vector3) {
    const projected = position.clone().project(camera)
    return {
      x: ((projected.x + 1) / 2) * canvas.width,
      y: ((-projected.y + 1) / 2) * canvas.height,
      visible: projected.z >= -1 && projected.z <= 1,
    }
  }

  return {
    renderer,
    scene,
    camera,
    resize,
    render,
    createFruit,
    removeFruit,
    projectToScreen,
    setBackground,
  }
}
