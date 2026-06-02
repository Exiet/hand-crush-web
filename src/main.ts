import './style.css'
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import * as THREE from 'three'
import { createThreeFruitScene, type FruitVisual } from './three-scene'

type GestureState = 'OPEN' | 'CLOSING' | 'FIST_HOLD'
type PerformanceTier = 'high' | 'medium' | 'low'
type RuntimeState = 'idle' | 'starting' | 'running' | 'error' | 'ended'
type CameraFacingMode = 'environment' | 'user'

type Crushable = {
  id: number
  spriteIndex: number
  x: number
  y: number
  z: number
  radius: number
  crushed: boolean
  respawnAt: number
  pulse: number
  driftAngle: number
  driftSpeed: number
  driftRadius: number
  baseX: number
  baseY: number
  baseZ: number
  roll: number
  rollSpeed: number
  yaw: number
  yawSpeed: number
  tilt: number
  tiltSpeed: number
  screenX: number
  screenY: number
  screenRadius: number
  worldRadius: number
  splitProgress: number
  splitDirX: number
  splitDirY: number
  visual: FruitVisual | null
}

// 全新汁液飞溅粒子：圆形液滴，从命中点放射散开，不再聚成一块。
type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  gravity: number
}

type AppRefs = {
  video: HTMLVideoElement
  cameraCanvas: HTMLCanvasElement
  gameCanvas: HTMLCanvasElement
  overlayCanvas: HTMLCanvasElement
  statusText: HTMLDivElement
  hintText: HTMLDivElement
  startButton: HTMLButtonElement
  installButton: HTMLButtonElement
  fullscreenButton: HTMLButtonElement
  switchCameraButton: HTMLButtonElement
  panelTitle: HTMLHeadingElement
  panelAction: HTMLButtonElement
  panel: HTMLDivElement
  scoreText: HTMLSpanElement
  comboText: HTMLSpanElement
  timerText: HTMLSpanElement
  resultScore: HTMLParagraphElement
  resultCombo: HTMLParagraphElement
  gameHud: HTMLDivElement
}

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const COMBO_WINDOW_MS = 1800
const ROUND_DURATION_MS = 60000
const LOCK_CHARGE_MAX = 1
const MAX_OBJECTS = 5
const CRUSH_COOLDOWN_MS = 1000
const BACKGROUND_SRC = '/assets/background.png'
const FRUIT_SOURCES = [
  '/assets/fruit-1.png',
  '/assets/fruit-2.png',
  '/assets/fruit-3.png',
  '/assets/fruit-4.png',
  '/assets/fruit-5.png',
]
const JUICE_COLORS = [0xf15b4a, 0xe94560, 0xffd166, 0x79c753, 0xff8c42]

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app root')

app.innerHTML = `
  <div class="shell" id="shellRoot">
    <div class="game-bg"></div>
    <video id="camera" playsinline muted></video>
    <canvas id="cameraCanvas"></canvas>
    <canvas id="gameCanvas"></canvas>
    <canvas id="overlayCanvas"></canvas>

    <div class="intro-panel" id="panel">
      <h1 id="panelTitle">抓爆水果</h1>
      <div class="rule-list">
        <div class="rule-item">把手移到水果上方</div>
        <div class="rule-item">重新握拳一次就能抓爆</div>
        <div class="rule-item">60 秒内尽量拿高分</div>
      </div>
      <p id="resultScore" class="result-line hidden"></p>
      <p id="resultCombo" class="result-line hidden"></p>
      <div class="intro-actions">
        <button id="panelAction" class="start-button">开始游戏</button>
      </div>
    </div>

    <div id="gameHud" class="hidden">
      <div class="hud top-bar-row">
        <div class="score-card compact-top-card">
          <span class="score-label">击碎</span>
          <strong id="scoreText">0</strong>
        </div>
        <div class="score-card timer-card compact-top-card">
          <span class="score-label">剩余</span>
          <strong id="timerText">60.0</strong>
        </div>
        <div class="score-card combo compact-top-card">
          <span class="score-label">连击</span>
          <strong id="comboText">x0</strong>
        </div>
      </div>

      <div class="hud top-left below-top-bar">
        <div id="statusText" class="status">把整只手放进画面里</div>
        <div id="hintText" class="hint">移动到水果上，再重新握拳</div>
      </div>

      <div class="hud top-right mobile-stack below-top-bar controls-offset">
        <button id="switchCameraButton" class="secondary-button">切后置</button>
        <button id="fullscreenButton" class="secondary-button">全屏</button>
        <button id="installButton" class="secondary-button hidden">安装</button>
        <button id="startButton" class="start-button hidden">开始</button>
      </div>
    </div>
  </div>
`

const refs: AppRefs = {
  video: document.querySelector('#camera')!,
  cameraCanvas: document.querySelector('#cameraCanvas')!,
  gameCanvas: document.querySelector('#gameCanvas')!,
  overlayCanvas: document.querySelector('#overlayCanvas')!,
  statusText: document.querySelector('#statusText')!,
  hintText: document.querySelector('#hintText')!,
  startButton: document.querySelector('#startButton')!,
  installButton: document.querySelector('#installButton')!,
  fullscreenButton: document.querySelector('#fullscreenButton')!,
  switchCameraButton: document.querySelector('#switchCameraButton')!,
  panelTitle: document.querySelector('#panelTitle')!,
  panelAction: document.querySelector('#panelAction')!,
  panel: document.querySelector('#panel')!,
  scoreText: document.querySelector('#scoreText')!,
  comboText: document.querySelector('#comboText')!,
  timerText: document.querySelector('#timerText')!,
  resultScore: document.querySelector('#resultScore')!,
  resultCombo: document.querySelector('#resultCombo')!,
  gameHud: document.querySelector('#gameHud')!,
}

const cameraCtx = refs.cameraCanvas.getContext('2d')!
const overlayCtx = refs.overlayCanvas.getContext('2d')!
const threeScene = createThreeFruitScene(refs.gameCanvas)
const textureLoader = new THREE.TextureLoader()

const FINGER_TIPS = [4, 8, 12, 16, 20]
const FINGER_BASES = [2, 5, 9, 13, 17]
const backgroundTexture = textureLoader.load(BACKGROUND_SRC)
const fruitTextures = FRUIT_SOURCES.map((src) => textureLoader.load(src))

let handLandmarker: HandLandmarker | null = null
let lastVideoTime = -1
let detectIntervalMs = 26
let lastDetectTs = 0
let fistScoreSmoothed = 0
let enterFrames = 0
let exitFrames = 0
let gestureState: GestureState = 'OPEN'
let justStartedFist = false
let grabPoint = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5, visible: false }
let stream: MediaStream | null = null
let currentFacingMode: CameraFacingMode = 'environment'
let audioCtx: AudioContext | null = null
let masterCompression: DynamicsCompressorNode | null = null
let flashTimer = 0
let shakeTimer = 0
let comboTimer = 0
let roundTimeLeftMs = ROUND_DURATION_MS
let lastFrameTs = performance.now()
let crushCount = 0
let comboCount = 0
let bestCombo = 0
let nextObjectId = 1
let performanceTier: PerformanceTier = 'medium'
let deferredInstallPrompt: DeferredInstallPrompt | null = null
let frameSamples = 0
let frameTimeSum = 0
let runtimeState: RuntimeState = 'idle'
let lockedTargetId: number | null = null
let lockCharge = 0
let lastCrushAt = -CRUSH_COOLDOWN_MS
let fistReleasedSinceLastCrush = true
let lastFistStartAt = -9999
let pointerMode = !('ontouchstart' in window)

const objects: Crushable[] = []
const particles: Particle[] = []
const projectionScratch = new THREE.Vector3()

const config = {
  smoothingAlpha: 0.8,
  enterThreshold: 0.38,
  holdThreshold: 0.34,
  exitThreshold: 0.2,
  minEnterFrames: 1,
  minExitFrames: 5,
  particleBurst: 50,
  hitPadding: 120,
  lockRadius: 188,
  easyCrushBoost: 52,
  chargeRate: 1.25,
  chargeBoostRate: 2.1,
  chargeDecay: 1.4,
  fistIntentBufferMs: 340,
}

function resizeCanvases() {
  const width = window.innerWidth
  const height = window.innerHeight
  refs.cameraCanvas.width = width
  refs.cameraCanvas.height = height
  refs.overlayCanvas.width = width
  refs.overlayCanvas.height = height
  refs.gameCanvas.width = width
  refs.gameCanvas.height = height
  threeScene.resize(width, height)
}

function logDebug(event: string, payload?: Record<string, unknown>) {
  console.log('[fruit-crush]', event, payload ?? {})
}

function updateStatus(text: string) {
  refs.statusText.textContent = text
}

function updateHint(text: string) {
  refs.hintText.textContent = text
}

function showPanel(show: boolean) {
  refs.panel.classList.toggle('hidden', !show)
  refs.gameHud.classList.toggle('hidden', show)
}

function setRuntimeState(state: RuntimeState) {
  runtimeState = state
  showPanel(state !== 'running')
}

function updateScoreBoard() {
  refs.scoreText.textContent = String(crushCount)
  refs.comboText.textContent = `x${comboCount}`
  refs.timerText.textContent = (roundTimeLeftMs / 1000).toFixed(1)
}

function updateFullscreenLabel() {
  refs.fullscreenButton.textContent = document.fullscreenElement ? '退出全屏' : '全屏'
}

function updateCameraButtonLabel() {
  refs.switchCameraButton.textContent = currentFacingMode === 'environment' ? '切前置' : '切后置'
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isDesktopMode() {
  return pointerMode
}

function choosePerformanceTier(): PerformanceTier {
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  if (cores >= 8 && memory >= 6) return 'high'
  if (cores <= 4 || memory <= 3) return 'low'
  return 'medium'
}

function applyPerformanceTier(tier: PerformanceTier) {
  performanceTier = tier
  if (tier === 'high') detectIntervalMs = 22
  else if (tier === 'medium') detectIntervalMs = 26
  else detectIntervalMs = 34
}

function resetRoundStats() {
  crushCount = 0
  comboCount = 0
  bestCombo = 0
  comboTimer = 0
  roundTimeLeftMs = ROUND_DURATION_MS
  lockedTargetId = null
  lockCharge = 0
  lastCrushAt = -CRUSH_COOLDOWN_MS
  fistReleasedSinceLastCrush = true
  lastFistStartAt = -9999
  updateScoreBoard()
  refs.resultScore.classList.add('hidden')
  refs.resultCombo.classList.add('hidden')
}

function finishRound() {
  runtimeState = 'ended'
  lockedTargetId = null
  lockCharge = 0
  refs.resultScore.textContent = `本局击碎：${crushCount}`
  refs.resultCombo.textContent = `最高连击：x${bestCombo}`
  refs.resultScore.classList.remove('hidden')
  refs.resultCombo.classList.remove('hidden')
  refs.panelTitle.textContent = '再来一局？'
  refs.panelAction.textContent = '开始游戏'
  updateStatus('挑战结束')
  updateHint('点击开始游戏继续')
  showPanel(true)
}

function getDeviceFruitScale() {
  const shortSide = Math.min(window.innerWidth, window.innerHeight)
  if (shortSide <= 430) return 0.62
  if (shortSide <= 540) return 0.72
  if (shortSide <= 768) return 0.82
  return 0.9
}

function getWorldFromScreen(baseX: number, baseY: number, baseZ: number) {
  const x = ((baseX / window.innerWidth) * 2 - 1) * 5.4
  const y = (1 - (baseY / window.innerHeight) * 2) * 3.2
  return { x, y, z: baseZ }
}

function isValidSpawn(baseX: number, baseY: number, radius: number) {
  return objects.every((item) => {
    if (item.crushed) return true
    const dist = Math.hypot(item.baseX - baseX, item.baseY - baseY)
    return dist >= item.radius + radius + 40
  })
}

// 水果世界半径（用于创建与命中投影）。较之前缩小一倍。
function getFruitWorldRadius(radius: number) {
  const scale = getDeviceFruitScale()
  return Math.max(0.28, radius * 0.04 * scale)
}

function createFruitVisual(spriteIndex: number, radius: number) {
  return threeScene.createFruit(
    fruitTextures[spriteIndex],
    getFruitWorldRadius(radius),
    JUICE_COLORS[spriteIndex % JUICE_COLORS.length],
    spriteIndex,
  )
}

function spawnObject(): Crushable {
  const deviceScale = getDeviceFruitScale()
  const margin = 54
  const hudTop = Math.min(window.innerHeight * 0.16, 122)
  const hudRight = Math.min(window.innerWidth * 0.14, 84)
  let attempts = 0
  let radius = randomBetween(30, 38) * deviceScale
  let baseX = 0
  let baseY = 0
  do {
    radius = randomBetween(30, 38) * deviceScale
    baseX = randomBetween(margin, window.innerWidth - margin - hudRight)
    baseY = randomBetween(hudTop, window.innerHeight - margin - 94)
    attempts += 1
  } while (attempts < 120 && !isValidSpawn(baseX, baseY, radius))

  const spriteIndex = Math.floor(Math.random() * fruitTextures.length)
  const visual = createFruitVisual(spriteIndex, radius)
  const baseZ = randomBetween(-1.2, 0.8)

  return {
    id: nextObjectId++,
    spriteIndex,
    x: baseX,
    y: baseY,
    z: baseZ,
    radius,
    crushed: false,
    respawnAt: 0,
    pulse: 0,
    driftAngle: randomBetween(0, Math.PI * 2),
    driftSpeed: randomBetween(0.18, 0.34),
    driftRadius: randomBetween(8, 14),
    baseX,
    baseY,
    baseZ,
    roll: randomBetween(0, Math.PI * 2),
    rollSpeed: randomBetween(0.28, 0.46),
    yaw: randomBetween(-0.8, 0.8),
    yawSpeed: randomBetween(0.2, 0.4),
    tilt: randomBetween(-0.45, 0.45),
    tiltSpeed: randomBetween(0.16, 0.3),
    screenX: baseX,
    screenY: baseY,
    screenRadius: Math.max(34, radius),
    worldRadius: getFruitWorldRadius(radius),
    splitProgress: 0,
    splitDirX: 1,
    splitDirY: 1,
    visual,
  }
}

function ensureObjects(count = MAX_OBJECTS) {
  while (objects.length < count) objects.push(spawnObject())
}

function clearObjects() {
  for (const item of objects) {
    if (item.visual) threeScene.removeFruit(item.visual)
  }
  objects.length = 0
}

function resetObjects() {
  clearObjects()
  ensureObjects(MAX_OBJECTS)
}

function respawnObject(target: Crushable) {
  if (target.visual) threeScene.removeFruit(target.visual)
  const replacement = spawnObject()
  Object.assign(target, replacement)
}

function syncObjectVisual(item: Crushable, now: number) {
  if (!item.visual) return
  const world = getWorldFromScreen(item.x, item.y, item.z)
  item.visual.group.position.set(world.x, world.y, world.z)
  item.visual.group.rotation.set(item.tilt * 0.2, item.yaw * 0.15, item.roll * 0.14)
  // 等比缩放：只用单一 burst 因子同时作用于 x/y，避免压扁
  const burst = item.crushed ? 1 + item.splitProgress * 0.12 : 1 + item.pulse * 0.08
  item.visual.group.scale.set(burst, burst, 1)
  item.visual.body.visible = true
  item.visual.shell.visible = true
  item.visual.leftHalf.visible = false
  item.visual.rightHalf.visible = false
  item.visual.leftCut.visible = false
  item.visual.rightCut.visible = false
  if (item.visual.stem) item.visual.stem.visible = !item.crushed
  if (item.visual.leaf) item.visual.leaf.visible = !item.crushed
  ;(item.visual.glow.material as THREE.MeshBasicMaterial).opacity = item.id === lockedTargetId ? 0.28 + Math.sin(now / 140) * 0.08 : 0

  item.visual.body.position.set(0, item.crushed ? item.splitProgress * 0.08 : 0, 0.04)
  item.visual.shell.position.set(0, item.crushed ? item.splitProgress * 0.08 : 0, -0.02)

  const center = item.visual.group.position
  const screen = threeScene.projectToScreen(center)
  item.screenX = screen.x
  item.screenY = screen.y
  // 命中半径：由真实世界半径投影到屏幕计算，与看到的大小一致
  const edge = projectionScratch.copy(center)
  edge.x += item.worldRadius * burst
  const edgeScreen = threeScene.projectToScreen(edge)
  const pixelRadius = Math.hypot(edgeScreen.x - screen.x, edgeScreen.y - screen.y)
  item.screenRadius = Number.isFinite(pixelRadius) && pixelRadius > 0 ? pixelRadius : 0
  if (!Number.isFinite(item.screenX) || !Number.isFinite(item.screenY) || !Number.isFinite(item.screenRadius)) {
    logDebug('invalid-screen-projection', {
      id: item.id,
      screenX: item.screenX,
      screenY: item.screenY,
      screenRadius: item.screenRadius,
      world,
    })
  }
}

function updateObjectMotion(dt: number) {
  const now = performance.now()
  for (const item of objects) {
    if (!item.crushed) {
      item.driftAngle += item.driftSpeed * dt
      item.roll += item.rollSpeed * dt
      item.yaw += Math.sin(item.roll * 0.8) * item.yawSpeed * dt * 0.2
      item.tilt += Math.cos(item.roll * 0.95) * item.tiltSpeed * dt * 0.18
      item.x = item.baseX + Math.cos(item.driftAngle) * item.driftRadius
      item.y = item.baseY + Math.sin(item.driftAngle * 0.8) * item.driftRadius * 0.7
    }
    syncObjectVisual(item, now)
  }
}

function getPalmCenter(landmarks: NormalizedLandmark[]) {
  const ids = [0, 5, 9, 13, 17]
  const sum = ids.reduce(
    (acc, idx) => {
      acc.x += landmarks[idx].x
      acc.y += landmarks[idx].y
      return acc
    },
    { x: 0, y: 0 },
  )
  return { x: sum.x / ids.length, y: sum.y / ids.length }
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function computeFistScore(landmarks: NormalizedLandmark[]) {
  const palm = getPalmCenter(landmarks)
  const palmPoint = { x: palm.x, y: palm.y } as NormalizedLandmark
  const values = FINGER_TIPS.map((tipIndex, i) => {
    const tip = landmarks[tipIndex]
    const base = landmarks[FINGER_BASES[i]]
    const extend = Math.max(distance(base, palmPoint), 0.0001)
    const fold = distance(tip, palmPoint)
    return 1 - Math.min(fold / (extend * 2.55), 1)
  })
  const thumbBoost = values[0] * 0.62
  const fingerAvg = (values[1] + values[2] + values[3] + values[4]) / 4
  return Math.max(0, Math.min(1, fingerAvg * 0.88 + thumbBoost * 0.12))
}

function updateGestureState(score: number) {
  justStartedFist = false
  if (gestureState === 'OPEN' || gestureState === 'CLOSING') {
    if (score > config.enterThreshold) {
      enterFrames += 1
      gestureState = 'CLOSING'
      if (enterFrames >= config.minEnterFrames) {
        gestureState = 'FIST_HOLD'
        exitFrames = 0
        justStartedFist = true
        lastFistStartAt = performance.now()
      }
    } else if (score > config.holdThreshold) {
      gestureState = 'CLOSING'
    } else {
      enterFrames = 0
      if (score < config.exitThreshold) {
        gestureState = 'OPEN'
        fistReleasedSinceLastCrush = true
      }
    }
  }
  if (gestureState === 'FIST_HOLD') {
    if (score < config.exitThreshold) {
      exitFrames += 1
      if (exitFrames >= config.minExitFrames) {
        gestureState = 'OPEN'
        enterFrames = 0
        exitFrames = 0
        fistReleasedSinceLastCrush = true
      }
    } else {
      exitFrames = 0
    }
  }
}

function ensureAudio() {
  if (!audioCtx || masterCompression) return
  masterCompression = audioCtx.createDynamicsCompressor()
  masterCompression.threshold.value = -26
  masterCompression.knee.value = 10
  masterCompression.ratio.value = 8
  masterCompression.attack.value = 0.003
  masterCompression.release.value = 0.18
  masterCompression.connect(audioCtx.destination)
}

function getAudioOutput() {
  ensureAudio()
  return masterCompression ?? audioCtx?.destination ?? null
}

function playOscLayer(now: number, type: OscillatorType, startFreq: number, endFreq: number, gainPeak: number, duration: number) {
  if (!audioCtx) return
  const output = getAudioOutput()
  if (!output) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(startFreq, now)
  osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), now + duration)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.connect(gain)
  gain.connect(output)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

function playNoiseBurst(now: number, duration: number, peak: number) {
  if (!audioCtx) return
  const output = getAudioOutput()
  if (!output) return
  const buffer = audioCtx.createBuffer(1, Math.max(1, Math.floor(audioCtx.sampleRate * duration)), audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const source = audioCtx.createBufferSource()
  const gain = audioCtx.createGain()
  source.buffer = buffer
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  source.connect(gain)
  gain.connect(output)
  source.start(now)
}

function playCrushSound() {
  if (!audioCtx) return
  const now = audioCtx.currentTime
  playOscLayer(now, 'triangle', 180, 62, 0.18, 0.2)
  playOscLayer(now + 0.02, 'square', 320, 120, 0.08, 0.1)
  playNoiseBurst(now + 0.01, 0.09, 0.06)
}

function triggerHaptics() {
  if (typeof navigator.vibrate !== 'function') return
  navigator.vibrate([14, 10, 18])
}

function getCanvasCssScale(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: rect.width > 0 ? canvas.width / rect.width : 1,
    y: rect.height > 0 ? canvas.height / rect.height : 1,
  }
}

function clientToOverlayPoint(clientX: number, clientY: number) {
  const rect = refs.overlayCanvas.getBoundingClientRect()
  const scale = getCanvasCssScale(refs.overlayCanvas)
  return {
    x: (clientX - rect.left) * scale.x,
    y: (clientY - rect.top) * scale.y,
  }
}

function hexToRgb(hex: number) {
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 }
}

function createJuiceBurst(target: Crushable) {
  // 从水果当前屏幕位置放射散开。颜色取该水果的果汁色。
  const cx = target.screenX
  const cy = target.screenY
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return
  const base = hexToRgb(JUICE_COLORS[target.spriteIndex % JUICE_COLORS.length])
  const sizeScale = clamp(target.screenRadius / 48, 0.6, 1.6)
  for (let i = 0; i < config.particleBurst; i += 1) {
    // 均匀分布在整个圆周上 + 随机抖动，避免集中在一侧
    const angle = (i / config.particleBurst) * Math.PI * 2 + randomBetween(-0.25, 0.25)
    const speed = randomBetween(120, 360) * sizeScale
    const life = randomBetween(0.45, 0.85)
    // 颜色轻微深浅抖动
    const shade = randomBetween(0.78, 1.12)
    const r = clamp(Math.round(base.r * shade), 0, 255)
    const g = clamp(Math.round(base.g * shade), 0, 255)
    const b = clamp(Math.round(base.b * shade), 0, 255)
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(40, 120),
      life,
      maxLife: life,
      size: randomBetween(3, 9) * sizeScale,
      color: `${r},${g},${b}`,
      gravity: randomBetween(700, 1050),
    })
  }
}

function emitCrush(target: Crushable) {
  if (runtimeState !== 'running') {
    logDebug('emit-crush-skip', { reason: 'runtime-not-running', runtimeState, targetId: target.id })
    return
  }
  logDebug('emit-crush', { targetId: target.id, scoreBefore: crushCount, comboBefore: comboCount })
  target.crushed = true
  target.respawnAt = performance.now() + 420
  target.pulse = 1.3
  target.splitProgress = 0.01
  target.y = -9999
  crushCount += 1
  comboCount = comboTimer > 0 ? comboCount + 1 : 1
  bestCombo = Math.max(bestCombo, comboCount)
  comboTimer = COMBO_WINDOW_MS
  lockedTargetId = null
  lockCharge = 0
  updateScoreBoard()
  flashTimer = pointerMode ? 0 : 140
  shakeTimer = 120
  playCrushSound()
  triggerHaptics()
  createJuiceBurst(target)
  logDebug('emit-crush-done', { targetId: target.id, scoreAfter: crushCount, comboAfter: comboCount })
}

function findLockedTarget(): Crushable | undefined {
  if (lockedTargetId == null) return undefined
  return objects.find((item) => item.id === lockedTargetId && !item.crushed)
}

function updateTargetLock() {
  if (!grabPoint.visible || runtimeState !== 'running') {
    lockedTargetId = null
    return
  }
  const current = findLockedTarget()
  if (current) {
    const currentDist = Math.hypot(current.screenX - grabPoint.x, current.screenY - grabPoint.y)
    if (currentDist <= current.screenRadius + 50) return
  }

  let best: Crushable | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const item of objects) {
    if (item.crushed) continue
    const dist = Math.hypot(item.screenX - grabPoint.x, item.screenY - grabPoint.y)
    if (dist < bestDist && dist <= item.screenRadius + config.lockRadius) {
      best = item
      bestDist = dist
    }
  }
  const nextId = best?.id ?? null
  if (nextId !== lockedTargetId) {
    lockedTargetId = nextId
    logDebug('lock-change', { lockedTargetId })
  }
}

function updateLockCharge(dt: number) {
  const locked = findLockedTarget()
  if (!locked || !grabPoint.visible || runtimeState !== 'running') {
    lockCharge = Math.max(0, lockCharge - dt * config.chargeDecay)
    return
  }
  const dist = Math.hypot(locked.screenX - grabPoint.x, locked.screenY - grabPoint.y)
  const nearRadius = locked.screenRadius + config.lockRadius
  if (dist <= nearRadius + 54) lockCharge = clamp(lockCharge + dt * 3.2, 0, LOCK_CHARGE_MAX)
  else lockCharge = Math.max(0, lockCharge - dt * 2.4)
}

function detectHit() {
  if (runtimeState !== 'running') return
  const locked = findLockedTarget()
  if (!locked) {
    logDebug('detect-hit-skip', { reason: 'no-locked-target' })
    return
  }
  const now = performance.now()
  const cooldownReady = now - lastCrushAt >= CRUSH_COOLDOWN_MS
  const fistIntentActive = justStartedFist || (now - lastFistStartAt <= config.fistIntentBufferMs)
  const canTriggerThisFist = fistIntentActive && fistReleasedSinceLastCrush && cooldownReady
  logDebug('detect-hit', {
    lockedTargetId: locked.id,
    cooldownReady,
    fistIntentActive,
    canTriggerThisFist,
    gestureState,
  })
  if (canTriggerThisFist) {
    lastCrushAt = now
    fistReleasedSinceLastCrush = false
    emitCrush(locked)
  }
}

function drawCameraLayer() {
  cameraCtx.clearRect(0, 0, refs.cameraCanvas.width, refs.cameraCanvas.height)
  if (refs.video.readyState < 2) return
  const w = refs.cameraCanvas.width
  const h = refs.cameraCanvas.height
  cameraCtx.save()
  cameraCtx.translate(w, 0)
  cameraCtx.scale(-1, 1)
  cameraCtx.drawImage(refs.video, 0, 0, w, h)
  cameraCtx.restore()
  cameraCtx.fillStyle = 'rgba(255,255,255,0.06)'
  cameraCtx.fillRect(0, 0, w, h)
}

function drawVirtualHand() {
  if (!grabPoint.visible) return
  overlayCtx.save()
  overlayCtx.translate(grabPoint.x, grabPoint.y)
  const grab = gestureState === 'FIST_HOLD'
  const scale = grab ? 0.94 : 1
  overlayCtx.scale(scale, scale)
  overlayCtx.shadowColor = 'rgba(78, 49, 20, 0.28)'
  overlayCtx.shadowBlur = 18
  overlayCtx.shadowOffsetY = 8
  const skin = '#f4c38c'
  const shade = '#dca66f'
  const line = '#8f6038'
  const nail = '#ffe0bf'
  if (!grab) {
    overlayCtx.fillStyle = skin
    overlayCtx.strokeStyle = line
    overlayCtx.lineWidth = 4
    overlayCtx.beginPath()
    overlayCtx.roundRect(-30, -12, 60, 94, 24)
    overlayCtx.fill()
    overlayCtx.stroke()
    const fingerXs = [-26, -10, 6, 22]
    const fingerHeights = [68, 84, 79, 62]
    fingerXs.forEach((x, index) => {
      overlayCtx.beginPath()
      overlayCtx.roundRect(x, -fingerHeights[index], 13, fingerHeights[index] + 28, 12)
      overlayCtx.fill()
      overlayCtx.stroke()
    })
    overlayCtx.save()
    overlayCtx.translate(-34, 14)
    overlayCtx.rotate(-0.85)
    overlayCtx.beginPath()
    overlayCtx.roundRect(-9, -28, 18, 48, 12)
    overlayCtx.fill()
    overlayCtx.stroke()
    overlayCtx.restore()
    overlayCtx.fillStyle = shade
    overlayCtx.beginPath()
    overlayCtx.roundRect(-24, 12, 48, 56, 18)
    overlayCtx.fill()
    overlayCtx.fillStyle = nail
    ;[-25, -9, 7, 23].forEach((x, index) => {
      overlayCtx.beginPath()
      overlayCtx.roundRect(x, -fingerHeights[index] + 2, 11, 11, 8)
      overlayCtx.fill()
    })
  } else {
    overlayCtx.fillStyle = skin
    overlayCtx.strokeStyle = line
    overlayCtx.lineWidth = 4
    overlayCtx.beginPath()
    overlayCtx.roundRect(-34, -2, 68, 74, 28)
    overlayCtx.fill()
    overlayCtx.stroke()
    ;[-25, -9, 7, 23].forEach((x) => {
      overlayCtx.beginPath()
      overlayCtx.roundRect(x, -20, 14, 30, 10)
      overlayCtx.fill()
      overlayCtx.stroke()
    })
    overlayCtx.save()
    overlayCtx.translate(-34, 22)
    overlayCtx.rotate(-0.72)
    overlayCtx.beginPath()
    overlayCtx.roundRect(-9, -18, 18, 34, 10)
    overlayCtx.fill()
    overlayCtx.stroke()
    overlayCtx.restore()
    overlayCtx.fillStyle = shade
    overlayCtx.beginPath()
    overlayCtx.roundRect(-24, 18, 48, 34, 16)
    overlayCtx.fill()
  }
  overlayCtx.restore()
}

function drawParticles(dt: number) {
  const maxParticles = performanceTier === 'high' ? 220 : performanceTier === 'medium' ? 160 : 90
  if (particles.length > maxParticles) particles.splice(0, particles.length - maxParticles)
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i]
    particle.life -= dt
    if (particle.life <= 0) {
      particles.splice(i, 1)
      continue
    }
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.vx *= 0.96
    particle.vy = particle.vy * 0.96 + particle.gravity * dt
    const t = particle.life / particle.maxLife
    const alpha = Math.min(1, t * 1.2)
    const radius = particle.size * (0.4 + 0.6 * t)
    overlayCtx.beginPath()
    overlayCtx.fillStyle = `rgba(${particle.color},${alpha.toFixed(3)})`
    overlayCtx.arc(particle.x, particle.y, radius, 0, Math.PI * 2)
    overlayCtx.fill()
  }
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)
  if (flashTimer > 0) {
    overlayCtx.fillStyle = `rgba(255,255,255,${Math.min(flashTimer / 140, 0.28)})`
    overlayCtx.fillRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)
  }
  drawParticles(Math.min((performance.now() - lastFrameTs) / 1000, 0.033))
  drawVirtualHand()
}

function normalizeToScreen(point: { x: number; y: number }) {
  return {
    x: (1 - point.x) * refs.overlayCanvas.width,
    y: point.y * refs.overlayCanvas.height,
  }
}

function processDetection(result: HandLandmarkerResult | null) {
  const landmarks = result?.landmarks?.[0]
  if (!landmarks) {
    grabPoint.visible = false
    lockedTargetId = null
    lockCharge = 0
    fistScoreSmoothed *= 0.82
    gestureState = 'OPEN'
    enterFrames = 0
    exitFrames = 0
    if (runtimeState === 'running') updateStatus('把整只手放进画面里')
    return
  }
  const palm = getPalmCenter(landmarks)
  const point = normalizeToScreen(palm)
  grabPoint.x = point.x
  grabPoint.y = point.y
  grabPoint.visible = true
  updateTargetLock()
  const rawScore = computeFistScore(landmarks)
  fistScoreSmoothed = fistScoreSmoothed * (1 - config.smoothingAlpha) + rawScore * config.smoothingAlpha
  updateGestureState(fistScoreSmoothed)
  if (lockedTargetId != null && justStartedFist) {
    detectHit()
  }
  if (runtimeState === 'running') {
    updateStatus(lockedTargetId != null ? '已锁定，握拳就爆！' : '移动到水果上')
    updateHint(lockedTargetId != null ? '重新握拳马上触发' : '把手移近水果一些')
  }
}

async function setupHandTracking() {
  updateStatus('加载中...')
  const resolver = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm')
  handLandmarker = await HandLandmarker.createFromOptions(resolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
  })
}

function stopCameraStream() {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  refs.video.srcObject = null
}

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持 getUserMedia')
  stopCameraStream()
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: currentFacingMode,
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    })
  } catch (error) {
    logDebug('camera-primary-failed', { error: error instanceof Error ? error.message : String(error), facingMode: currentFacingMode })
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    })
  }
  refs.video.srcObject = stream
  await refs.video.play()
}

async function toggleCameraFacingMode() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment'
  updateCameraButtonLabel()
  await setupCamera()
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
  else await document.exitFullscreen()
  updateFullscreenLabel()
}

function tryPointerCrush(clientX: number, clientY: number) {
  if (runtimeState !== 'running' || !pointerMode) {
    logDebug('pointer-crush-skip', { runtimeState, pointerMode })
    return
  }

  const point = clientToOverlayPoint(clientX, clientY)

  // 只取真正被点中（点击在水果命中半径内）的目标；若多个重叠，取最近中心。
  // 不再 fallback 到「最近的水果」，避免点空白区域也爆炸。
  const HIT_TOLERANCE = 6 // 像素，轻微容错，不能太大
  let bestHit: Crushable | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const item of objects) {
    if (item.crushed) continue
    if (!Number.isFinite(item.screenX) || !Number.isFinite(item.screenY) || !(item.screenRadius > 0)) continue
    const dist = Math.hypot(item.screenX - point.x, item.screenY - point.y)
    if (dist <= item.screenRadius + HIT_TOLERANCE && dist < bestDist) {
      bestHit = item
      bestDist = dist
    }
  }

  logDebug('pointer-crush-attempt', {
    clientX,
    clientY,
    x: point.x,
    y: point.y,
    hit: bestHit?.id ?? null,
    bestDist: Number.isFinite(bestDist) ? bestDist : null,
  })

  if (!bestHit) {
    logDebug('pointer-crush-miss', { x: point.x, y: point.y })
    return
  }

  emitCrush(bestHit)
  logDebug('pointer-crush-applied', {
    targetId: bestHit.id,
    crushed: bestHit.crushed,
    respawnAt: bestHit.respawnAt,
    score: crushCount,
  })
}

async function startGame() {
  refs.panelAction.disabled = true
  refs.panelAction.textContent = '加载中...'
  setRuntimeState('starting')
  try {
    audioCtx = audioCtx ?? new AudioContext()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    applyPerformanceTier(choosePerformanceTier())
    resizeCanvases()
    resetRoundStats()
    resetObjects()

    if (isDesktopMode()) {
      logDebug('start-desktop-pointer-mode')
      setRuntimeState('running')
      updateStatus('点击水果就能抓爆')
      updateHint('电脑端可直接鼠标点击任意水果')
    } else {
      if (!stream) await setupCamera()
      if (!handLandmarker) await setupHandTracking()
      setRuntimeState('running')
      updateStatus('把整只手放进画面里')
      updateHint('移动到水果上，再重新握拳')
    }

    refs.panelAction.textContent = '开始游戏'
    refs.panelAction.disabled = false
  } catch (error) {
    console.error(error)
    logDebug('start-failed', { error: error instanceof Error ? error.message : String(error) })
    refs.panelTitle.textContent = '启动失败'
    refs.panelAction.textContent = '重试'
    refs.panelAction.disabled = false
    showPanel(true)
  }
}

function tick(ts: number) {
  const dt = Math.min((ts - lastFrameTs) / 1000, 0.033)
  lastFrameTs = ts
  frameSamples += 1
  frameTimeSum += dt

  if (frameSamples >= 120) {
    const avgFps = frameSamples / Math.max(frameTimeSum, 0.001)
    if (avgFps < 45 && performanceTier === 'high') applyPerformanceTier('medium')
    if (avgFps < 32 && performanceTier === 'medium') applyPerformanceTier('low')
    frameSamples = 0
    frameTimeSum = 0
  }

  if (runtimeState === 'running') {
    roundTimeLeftMs = Math.max(0, roundTimeLeftMs - dt * 1000)
    if (roundTimeLeftMs === 0) finishRound()
    updateLockCharge(dt)
    updateScoreBoard()
  }

  if (comboTimer > 0) {
    comboTimer = Math.max(0, comboTimer - dt * 1000)
    if (comboTimer === 0 && comboCount !== 0) {
      comboCount = 0
      updateScoreBoard()
    }
  }

  if (handLandmarker && refs.video.readyState >= 2) {
    const shouldDetect = ts - lastDetectTs >= detectIntervalMs && refs.video.currentTime !== lastVideoTime
    if (shouldDetect) {
      lastDetectTs = ts
      lastVideoTime = refs.video.currentTime
      const result = handLandmarker.detectForVideo(refs.video, ts)
      processDetection(result)
    }
  }

  flashTimer = Math.max(0, flashTimer - dt * 1000)
  shakeTimer = Math.max(0, shakeTimer - dt * 1000)

  drawCameraLayer()
  updateObjectMotion(dt)
  for (const item of objects) {
    if (item.crushed) {
      item.splitProgress = Math.min(1, item.splitProgress + dt * 4.6)
      if (ts >= item.respawnAt) {
        respawnObject(item)
        continue
      }
    } else {
      item.splitProgress = 0
    }
    item.pulse = Math.max(0, item.pulse - dt * 3.2)
  }

  threeScene.render()
  drawOverlay()
  requestAnimationFrame(tick)
}

window.addEventListener('resize', resizeCanvases)
window.addEventListener('fullscreenchange', updateFullscreenLabel)
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event as DeferredInstallPrompt
  refs.installButton.classList.remove('hidden')
})
refs.installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  await deferredInstallPrompt.prompt()
  deferredInstallPrompt = null
  refs.installButton.classList.add('hidden')
})
refs.fullscreenButton.addEventListener('click', () => {
  void toggleFullscreen()
})
refs.switchCameraButton.addEventListener('click', () => {
  void toggleCameraFacingMode()
})
refs.panelAction.addEventListener('click', () => {
  void startGame()
})

refs.overlayCanvas.addEventListener('pointerdown', (event) => {
  logDebug('overlay-pointerdown', { x: event.clientX, y: event.clientY })
  event.preventDefault()
  event.stopPropagation()
  tryPointerCrush(event.clientX, event.clientY)
})

window.addEventListener('pointerdown', (event) => {
  if (!pointerMode || runtimeState !== 'running') return
  logDebug('window-pointerdown', { x: event.clientX, y: event.clientY })
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

threeScene.setBackground(backgroundTexture)
applyPerformanceTier(choosePerformanceTier())
resizeCanvases()
ensureObjects(MAX_OBJECTS)
updateScoreBoard()
updateFullscreenLabel()
updateCameraButtonLabel()
showPanel(true)
requestAnimationFrame(tick)
