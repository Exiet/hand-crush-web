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
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  camera.position.set(0, 0, 28)

  scene.add(new THREE.AmbientLight(0xffffff, 1.55))

  const keyLight = new THREE.DirectionalLight(0xfff4da, 1.8)
  keyLight.position.set(-4, 6, 10)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0xb9d8ff, 1.2)
  fillLight.position.set(5, -2, 8)
  scene.add(fillLight)

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

    const geometry = new THREE.PlaneGeometry(28, 20)
    const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false })
    backgroundMesh = new THREE.Mesh(geometry, material)
    backgroundMesh.position.set(0, 0, -16)
    scene.add(backgroundMesh)
  }

  function getFruitScale(_variant: number) {
    // 等比缩放：直接使用贴图原始比例，避免把草莓/西红柿压扁或拉伸
    return { w: 1, h: 1 }
  }

  function createTexturedCard(texture: THREE.Texture, radius: number, variant: number) {
    const { w, h } = getFruitScale(variant)
    const geometry = new THREE.PlaneGeometry(radius * 2 * w, radius * 2 * h)
    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      roughness: 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    return new THREE.Mesh(geometry, material)
  }

  function createFruit(texture: THREE.Texture, radius: number, juiceColor: number, variant: number): FruitVisual {
    texture.colorSpace = THREE.SRGBColorSpace

    const group = new THREE.Group()
    const body = createTexturedCard(texture, radius, variant)
    group.add(body)

    const shell = createTexturedCard(texture, radius * 1.04, variant)
    const shellMaterial = shell.material as THREE.MeshPhysicalMaterial
    shellMaterial.opacity = 0.12
    shellMaterial.clearcoat = 1
    shellMaterial.clearcoatRoughness = 0.18
    shellMaterial.color = new THREE.Color(0xffffff)
    shell.position.z = -0.02
    group.add(shell)

    const leftHalf = createTexturedCard(texture, radius, variant)
    leftHalf.visible = false
    group.add(leftHalf)

    const rightHalf = createTexturedCard(texture, radius, variant)
    rightHalf.visible = false
    group.add(rightHalf)

    const { w, h } = getFruitScale(variant)
    const cutColor = new THREE.Color(juiceColor).lerp(new THREE.Color(0xffffff), 0.42)
    const cutGeometry = new THREE.PlaneGeometry(radius * 0.78 * h, radius * 1.6 * h)
    const cutMaterial = new THREE.MeshStandardMaterial({
      color: cutColor,
      roughness: 0.82,
      metalness: 0,
      emissive: new THREE.Color(juiceColor).multiplyScalar(0.08),
      side: THREE.DoubleSide,
    })

    const leftCut = new THREE.Mesh(cutGeometry, cutMaterial)
    leftCut.visible = false
    leftCut.position.x = -radius * 0.08 * w
    group.add(leftCut)

    const rightCut = new THREE.Mesh(cutGeometry.clone(), cutMaterial.clone())
    rightCut.visible = false
    rightCut.position.x = radius * 0.08 * w
    group.add(rightCut)

    const glowGeometry = new THREE.RingGeometry(radius * 1.1, radius * 1.18, 40)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd86b,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const glow = new THREE.Mesh(glowGeometry, glowMaterial)
    glow.rotation.x = -Math.PI / 2
    glow.position.y = -radius * 0.9
    group.add(glow)

    let stem: THREE.Mesh | undefined
    let leaf: THREE.Mesh | undefined
    if (variant !== 3) {
      stem = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.035, radius * 0.05, radius * 0.22, 8),
        new THREE.MeshStandardMaterial({ color: variant === 2 ? 0x7a5236 : 0x6b8f3e, roughness: 0.86 }),
      )
      stem.position.y = radius * h * 0.94
      stem.position.z = 0.02
      stem.rotation.z = variant === 2 ? 0.5 : 0.18
      group.add(stem)

      leaf = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 0.42, radius * 0.22),
        new THREE.MeshStandardMaterial({ color: 0x5ca347, roughness: 0.84, side: THREE.DoubleSide }),
      )
      leaf.position.set(radius * 0.12, radius * h * 0.98, 0.03)
      leaf.rotation.z = -0.48
      group.add(leaf)
    } else {
      stem = new THREE.Mesh(
        new THREE.ConeGeometry(radius * 0.12, radius * 0.24, 10),
        new THREE.MeshStandardMaterial({ color: 0x3c8a3f, roughness: 0.9 }),
      )
      stem.position.y = radius * h * 1.03
      stem.position.z = 0.03
      stem.rotation.z = 0.16
      group.add(stem)
    }

    scene.add(group)
    return { group, body, shell, glow, leftHalf, rightHalf, leftCut, rightCut, stem, leaf, juiceColor }
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
