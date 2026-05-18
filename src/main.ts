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
type FeedbackIntensity = 'light' | 'medium' | 'heavy'
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
  splitProgress: number
  splitDirX: number
  splitDirY: number
  visual: FruitVisual | null
}

type ParticleKind = 'juice' | 'pulp' | 'screen'
type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: number
  alpha: number
  kind: ParticleKind
  stretch: number
  gravity: number
  spin: number
  rotation: number
}

type AppRefs = {
  video: HTMLVideoElement
  cameraCanvas: HTMLCanvasElement
  gameCanvas: HTMLCanvasElement
  overlayCanvas: HTMLCanvasElement
  statusText: HTMLDivElement
  hintText: HTMLDivElement
  startButton: HTMLButtonElement
  debugText: HTMLPreElement
  perfText: HTMLSpanElement
  feedbackText: HTMLSpanElement
  installButton: HTMLButtonElement
  fullscreenButton: HTMLButtonElement
  switchCameraButton: HTMLButtonElement
  panelTitle: HTMLHeadingElement
  panelDesc: HTMLParagraphElement
  panelMeta: HTMLParagraphElement
  panelAction: HTMLButtonElement
  panel: HTMLDivElement
  scoreText: HTMLSpanElement
  comboText: HTMLSpanElement
  timerText: HTMLSpanElement
  resultScore: HTMLParagraphElement
  resultCombo: HTMLParagraphElement
  miniStatsCard: HTMLDivElement
}

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const SHOW_DEBUG = import.meta.env.DEV
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
      <div class="intro-chip">Hand Crush Web · Three.js 3D 版</div>
      <h1 id="panelTitle">锁定 3D 水果，重新握拳再捏爆</h1>
      <p id="panelDesc">现在屏幕里会显示你的虚拟游戏手。先靠近目标完成锁定，再明确做抓握动作，才能触发爆裂。</p>
      <div class="step-list">
        <div class="step-item"><span>1</span><p>点击开始并允许相机权限</p></div>
        <div class="step-item"><span>2</span><p>把虚拟手移到 3D 翻滚水果附近</p></div>
        <div class="step-item"><span>3</span><p>看到锁定后，重新握拳一次捏爆它</p></div>
      </div>
      <p id="panelMeta" class="intro-meta">推荐：Android Chrome / iPhone Safari · 需要 HTTPS 才能正常调用相机</p>
      <p id="resultScore" class="result-line hidden"></p>
      <p id="resultCombo" class="result-line hidden"></p>
      <div class="intro-actions">
        <button id="panelAction" class="start-button">开始挑战</button>
      </div>
    </div>

    <div class="hud top-left compact-hud">
      <div class="badge">Virtual Hand + Three.js</div>
      <div id="statusText" class="status">等待启动</div>
      <div id="hintText" class="hint">先锁定目标，再重新握拳，才会捏爆水果。</div>
    </div>

    <div class="hud top-right controls mobile-stack">
      <button id="switchCameraButton" class="secondary-button">切后置</button>
      <button id="fullscreenButton" class="secondary-button">全屏</button>
      <button id="installButton" class="secondary-button hidden">安装</button>
      <button id="startButton" class="start-button">开始</button>
    </div>

    <div class="hud right-stats score-board mobile-stats">
      <div class="score-card timer-card">
        <span class="score-label">剩余</span>
        <strong id="timerText">60.0</strong>
      </div>
      <div class="score-card">
        <span class="score-label">击碎</span>
        <strong id="scoreText">0</strong>
      </div>
      <div class="score-card combo">
        <span class="score-label">连击</span>
        <strong id="comboText">x0</strong>
      </div>
      <div class="score-card mini-pill-row" id="miniStatsCard">
        <span class="mini-pill">性能 <strong id="perfText">auto</strong></span>
        <span class="mini-pill">反馈 <strong id="feedbackText">heavy</strong></span>
      </div>
    </div>

    <div class="hud bottom-left debug-panel ${SHOW_DEBUG ? '' : 'hidden'}">
      <pre id="debugText">初始化中...</pre>
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
  debugText: document.querySelector('#debugText')!,
  perfText: document.querySelector('#perfText')!,
  feedbackText: document.querySelector('#feedbackText')!,
  installButton: document.querySelector('#installButton')!,
  fullscreenButton: document.querySelector('#fullscreenButton')!,
  switchCameraButton: document.querySelector('#switchCameraButton')!,
  panelTitle: document.querySelector('#panelTitle')!,
  panelDesc: document.querySelector('#panelDesc')!,
  panelMeta: document.querySelector('#panelMeta')!,
  panelAction: document.querySelector('#panelAction')!,
  panel: document.querySelector('#panel')!,
  scoreText: document.querySelector('#scoreText')!,
  comboText: document.querySelector('#comboText')!,
  timerText: document.querySelector('#timerText')!,
  resultScore: document.querySelector('#resultScore')!,
  resultCombo: document.querySelector('#resultCombo')!,
  miniStatsCard: document.querySelector('#miniStatsCard')!,
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
let handPresent = false
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
let feedbackIntensity: FeedbackIntensity = 'heavy'
let deferredInstallPrompt: DeferredInstallPrompt | null = null
let frameSamples = 0
let frameTimeSum = 0
let runtimeState: RuntimeState = 'idle'
let lockedTargetId: number | null = null
let lockCharge = 0
let lastCrushAt = -CRUSH_COOLDOWN_MS
let fistReleasedSinceLastCrush = true
let lastFistStartAt = -9999

const objects: Crushable[] = []
const particles: Particle[] = []

const config = {
  smoothingAlpha: 0.74,
  enterThreshold: 0.44,
  holdThreshold: 0.4,
  exitThreshold: 0.24,
  minEnterFrames: 1,
  minExitFrames: 4,
  particleBurst: 50,
  hitPadding: 84,
  lockRadius: 126,
  easyCrushBoost: 20,
  chargeRate: 1.25,
  chargeBoostRate: 1.8,
  chargeDecay: 1.4,
  fistIntentBufferMs: 260,
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

function updateStatus(text: string) {
  refs.statusText.textContent = text
}

function updateHint(text: string) {
  refs.hintText.textContent = text
}

function updatePanel(title: string, desc: string, meta: string, actionText: string) {
  refs.panelTitle.textContent = title
  refs.panelDesc.textContent = desc
  refs.panelMeta.textContent = meta
  refs.panelAction.textContent = actionText
}

function showPanel(show: boolean) {
  refs.panel.classList.toggle('hidden', !show)
}

function setRuntimeState(state: RuntimeState) {
  runtimeState = state
  showPanel(state !== 'running')
  refs.miniStatsCard.classList.toggle('hidden', state === 'running')
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

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase()
  return {
    isiOS: /iphone|ipad|ipod/.test(ua),
    isAndroid: /android/.test(ua),
    isSafari: /safari/.test(ua) && !/chrome|android/.test(ua),
  }
}

function isSecureRuntime() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
}

function choosePerformanceTier(): PerformanceTier {
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const shortSide = Math.min(window.innerWidth, window.innerHeight)
  if (cores >= 8 && memory >= 6 && shortSide >= 430) return 'high'
  if (cores <= 4 || memory <= 3) return 'low'
  return 'medium'
}

function applyPerformanceTier(tier: PerformanceTier) {
  performanceTier = tier
  if (tier === 'high') {
    detectIntervalMs = 22
    config.particleBurst = 56
    config.hitPadding = 92
    config.lockRadius = 138
  } else if (tier === 'medium') {
    detectIntervalMs = 26
    config.particleBurst = 50
    config.hitPadding = 84
    config.lockRadius = 126
  } else {
    detectIntervalMs = 36
    config.particleBurst = 28
    config.hitPadding = 72
    config.lockRadius = 108
  }

  const { isiOS, isAndroid } = detectPlatform()
  if (isiOS || isAndroid) {
    config.smoothingAlpha = 0.8
    config.enterThreshold = 0.38
    config.holdThreshold = 0.34
    config.exitThreshold = 0.2
    config.minEnterFrames = 1
    config.minExitFrames = 5
    config.hitPadding += 18
    config.lockRadius += 12
    config.easyCrushBoost = 34
    config.chargeBoostRate = 2.1
    config.fistIntentBufferMs = 340
  }

  refs.perfText.textContent = tier
}

function chooseFeedbackIntensity(): FeedbackIntensity {
  const { isiOS } = detectPlatform()
  return isiOS ? 'medium' : 'heavy'
}

function getStartupMeta() {
  const { isiOS, isAndroid, isSafari } = detectPlatform()
  if (isiOS) {
    return isSafari
      ? '当前环境：iPhone / Safari · 已升级到 Three.js 真 3D 水果场景'
      : '当前环境：iPhone · 建议改用 Safari 打开，兼容性最好'
  }
  if (isAndroid) {
    return '当前环境：Android · 推荐使用 Chrome，当前版本已升级到 Three.js 真 3D 水果场景'
  }
  return '当前环境：桌面或其他浏览器 · 真机测试请用手机 HTTPS 链接打开'
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
  showPanel(true)
  refs.resultScore.textContent = `本局击碎：${crushCount}`
  refs.resultCombo.textContent = `最高连击：x${bestCombo}`
  refs.resultScore.classList.remove('hidden')
  refs.resultCombo.classList.remove('hidden')
  updatePanel('挑战结束', '这一版已经升级到 Three.js 真 3D 水果场景、飞溅特效和分层音效。', '如果继续打磨，下一步可以接入真正的 glTF 水果模型。', '再来一局')
  refs.startButton.disabled = false
  refs.panelAction.disabled = false
  refs.startButton.textContent = '重新开始'
  refs.panelAction.textContent = '再来一局'
  updateStatus('挑战结束')
  updateHint('点击“再来一局”重新开始 60 秒挑战。')
}

function getDeviceFruitScale() {
  const shortSide = Math.min(window.innerWidth, window.innerHeight)
  if (shortSide <= 430) return 0.28
  if (shortSide <= 540) return 0.4
  if (shortSide <= 768) return 0.62
  return 0.82
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
    return dist >= item.radius + radius + 72
  })
}

function createFruitVisual(spriteIndex: number, radius: number) {
  const scale = getDeviceFruitScale()
  return threeScene.createFruit(
    fruitTextures[spriteIndex],
    radius * 0.038 * scale,
    JUICE_COLORS[spriteIndex % JUICE_COLORS.length],
    spriteIndex,
  )
}

function spawnObject(): Crushable {
  const deviceScale = getDeviceFruitScale()
  const margin = 54
  const hudTop = Math.min(window.innerHeight * 0.18, 132)
  const hudRight = Math.min(window.innerWidth * 0.16, 88)
  let attempts = 0
  let radius = randomBetween(24, 34) * deviceScale
  let baseX = 0
  let baseY = 0
  do {
    radius = randomBetween(24, 34) * deviceScale
    baseX = randomBetween(margin, window.innerWidth - margin - hudRight)
    baseY = randomBetween(hudTop, window.innerHeight - margin - 110)
    attempts += 1
  } while (attempts < 120 && !isValidSpawn(baseX, baseY, radius))

  const spriteIndex = Math.floor(Math.random() * fruitTextures.length)
  const visual = createFruitVisual(spriteIndex, radius)
  const baseZ = randomBetween(-1.6, 1.4)

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
    driftSpeed: randomBetween(0.2, 0.45),
    driftRadius: randomBetween(10, 18),
    baseX,
    baseY,
    baseZ,
    roll: randomBetween(0, Math.PI * 2),
    rollSpeed: randomBetween(0.5, 0.9),
    yaw: randomBetween(-0.8, 0.8),
    yawSpeed: randomBetween(0.5, 0.85),
    tilt: randomBetween(-0.45, 0.45),
    tiltSpeed: randomBetween(0.35, 0.7),
    screenX: baseX,
    screenY: baseY,
    screenRadius: radius,
    splitProgress: 0,
    splitDirX: randomBetween(0.8, 1.2) * (Math.random() > 0.5 ? 1 : -1),
    splitDirY: randomBetween(0.4, 0.9),
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
  target.splitProgress = 0
}

function syncObjectVisual(item: Crushable, now: number) {
  if (!item.visual) return
  const world = getWorldFromScreen(item.x, item.y, item.z)
  item.visual.group.position.set(world.x, world.y, world.z)
  item.visual.group.rotation.set(item.tilt + Math.cos(item.roll * 0.85) * 0.22, item.yaw + Math.sin(item.roll * 0.8) * 0.35, item.roll)
  const scale = 1 + item.pulse * 0.18
  item.visual.group.scale.setScalar(scale)
  ;(item.visual.glow.material as THREE.MeshBasicMaterial).opacity = item.id === lockedTargetId ? 0.34 + Math.sin(now / 140) * 0.08 : 0

  const split = item.splitProgress
  const lift = split * item.radius * 0.06
  item.visual.body.visible = !item.crushed
  item.visual.shell.visible = !item.crushed
  item.visual.leftHalf.visible = item.crushed
  item.visual.rightHalf.visible = item.crushed
  item.visual.leftCut.visible = item.crushed
  item.visual.rightCut.visible = item.crushed
  if (item.visual.stem) item.visual.stem.visible = !item.crushed
  if (item.visual.leaf) item.visual.leaf.visible = !item.crushed

  if (item.crushed) {
    const spread = split * 0.38 * item.splitDirX
    const drop = split * split * 0.24 * item.splitDirY
    item.visual.leftHalf.position.set(-spread, lift - drop, split * 0.08)
    item.visual.rightHalf.position.set(spread, lift - drop, -split * 0.08)
    item.visual.leftHalf.rotation.set(split * 1.25, split * -0.2, split * -1.8)
    item.visual.rightHalf.rotation.set(split * -1.25, split * 0.2, split * 1.8)
    item.visual.leftCut.position.set(-spread * 0.92, lift - drop, split * 0.085)
    item.visual.rightCut.position.set(spread * 0.92, lift - drop, -split * 0.085)
    item.visual.leftCut.rotation.set(0, Math.PI / 2, split * -1.8)
    item.visual.rightCut.rotation.set(0, -Math.PI / 2, split * 1.8)
  } else {
    item.visual.leftHalf.position.set(0, 0, 0)
    item.visual.rightHalf.position.set(0, 0, 0)
    item.visual.leftCut.position.set(0, 0, 0)
    item.visual.rightCut.position.set(0, 0, 0)
    item.visual.leftHalf.rotation.set(0, 0, 0)
    item.visual.rightHalf.rotation.set(0, 0, 0)
    item.visual.leftCut.rotation.set(0, Math.PI / 2, 0)
    item.visual.rightCut.rotation.set(0, -Math.PI / 2, 0)
  }

  const screen = threeScene.projectToScreen(item.visual.group.position)
  item.screenX = screen.x
  item.screenY = screen.y
  item.screenRadius = item.radius * (0.48 + (0.8 - item.z) * 0.012)
}

function updateObjectMotion(dt: number) {
  const now = performance.now()
  for (const item of objects) {
    if (item.crushed) continue
    item.driftAngle += item.driftSpeed * dt
    item.roll += item.rollSpeed * dt
    item.yaw += Math.sin(item.roll * 0.8) * item.yawSpeed * dt * 0.35
    item.tilt += Math.cos(item.roll * 0.95) * item.tiltSpeed * dt * 0.22
    item.x = item.baseX + Math.cos(item.driftAngle) * item.driftRadius
    item.y = item.baseY + Math.sin(item.driftAngle * 0.8) * item.driftRadius * 0.75
    syncObjectVisual(item, now)
  }
}

function getPalmCenter(landmarks: NormalizedLandmark[]) {
  const ids = [0, 5, 9, 13, 17]
  const sum = ids.reduce((acc, idx) => {
    acc.x += landmarks[idx].x
    acc.y += landmarks[idx].y
    return acc
  }, { x: 0, y: 0 })
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

function playOscLayer(now: number, type: OscillatorType, startFreq: number, endFreq: number, gainPeak: number, duration: number, q = 0.8) {
  if (!audioCtx) return
  const output = getAudioOutput()
  if (!output) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  const filter = audioCtx.createBiquadFilter()
  osc.type = type
  osc.frequency.setValueAtTime(startFreq, now)
  osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), now + duration)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(3200, now)
  filter.Q.value = q
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.connect(filter)
  filter.connect(gain)
  gain.connect(output)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

function playNoiseBurst(now: number, duration: number, peak: number, lowpass: number, bandpass: number) {
  if (!audioCtx) return
  const output = getAudioOutput()
  if (!output) return
  const buffer = audioCtx.createBuffer(1, Math.max(1, Math.floor(audioCtx.sampleRate * duration)), audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const source = audioCtx.createBufferSource()
  const bp = audioCtx.createBiquadFilter()
  const lp = audioCtx.createBiquadFilter()
  const gain = audioCtx.createGain()
  source.buffer = buffer
  bp.type = 'bandpass'
  bp.frequency.value = bandpass
  bp.Q.value = 0.7
  lp.type = 'lowpass'
  lp.frequency.value = lowpass
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  source.connect(bp)
  bp.connect(lp)
  lp.connect(gain)
  gain.connect(output)
  source.start(now)
}

function playCrushSound() {
  if (!audioCtx) return
  const now = audioCtx.currentTime
  const heavy = feedbackIntensity === 'heavy'
  playOscLayer(now, 'triangle', 180, 58, heavy ? 0.22 : 0.14, 0.22)
  playOscLayer(now + 0.015, 'triangle', 124, 72, heavy ? 0.14 : 0.09, 0.18)
  playOscLayer(now + 0.03, 'sine', 680, 220, heavy ? 0.05 : 0.03, 0.11)
  playOscLayer(now + 0.055, 'square', 420, 130, heavy ? 0.08 : 0.05, 0.12)
  playNoiseBurst(now + 0.004, 0.08, heavy ? 0.08 : 0.05, 1800, 650)
  playNoiseBurst(now + 0.045, 0.14, heavy ? 0.065 : 0.045, 1400, 420)
  playNoiseBurst(now + 0.09, 0.18, heavy ? 0.04 : 0.03, 1000, 260)
}

function triggerHaptics() {
  if (typeof navigator.vibrate !== 'function') return
  if (feedbackIntensity === 'heavy') navigator.vibrate([14, 10, 18, 10, 24, 18, 12])
  else if (feedbackIntensity === 'medium') navigator.vibrate([12, 12, 18])
  else navigator.vibrate(18)
}

function createJuiceBurst(target: Crushable) {
  const splashHue = [8, 18, 38, 102, 352][target.spriteIndex % 5] ?? randomBetween(0, 360)
  for (let i = 0; i < config.particleBurst; i += 1) {
    const angle = randomBetween(-Math.PI * 0.95, Math.PI * 0.95)
    const speed = randomBetween(140, feedbackIntensity === 'heavy' ? 540 : 360)
    particles.push({
      x: target.screenX,
      y: target.screenY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(20, 140),
      life: randomBetween(0.32, 0.74),
      maxLife: randomBetween(0.32, 0.74),
      size: randomBetween(6, 22),
      hue: splashHue + randomBetween(-16, 16),
      alpha: randomBetween(0.45, 0.95),
      kind: i % 4 === 0 ? 'pulp' : 'juice',
      stretch: randomBetween(0.8, 2.8),
      gravity: randomBetween(520, 880),
      spin: randomBetween(-6, 6),
      rotation: randomBetween(0, Math.PI * 2),
    })
  }
  for (let i = 0; i < 8; i += 1) {
    particles.push({
      x: randomBetween(window.innerWidth * 0.12, window.innerWidth * 0.88),
      y: randomBetween(window.innerHeight * 0.08, window.innerHeight * 0.3),
      vx: randomBetween(-40, 40),
      vy: randomBetween(40, 120),
      life: randomBetween(0.28, 0.5),
      maxLife: randomBetween(0.28, 0.5),
      size: randomBetween(20, 44),
      hue: splashHue + randomBetween(-10, 10),
      alpha: randomBetween(0.12, 0.24),
      kind: 'screen',
      stretch: randomBetween(1.4, 2.3),
      gravity: randomBetween(40, 110),
      spin: randomBetween(-2, 2),
      rotation: randomBetween(0, Math.PI * 2),
    })
  }
}

function emitCrush(target: Crushable) {
  if (runtimeState !== 'running') return
  target.crushed = true
  target.respawnAt = performance.now() + 620
  target.pulse = 1.3
  target.splitProgress = 0.01
  target.splitDirX = (grabPoint.x - target.screenX) >= 0 ? -1 : 1
  target.splitDirY = randomBetween(0.5, 0.95)
  if (target.visual) {
    target.visual.group.visible = true
    target.visual.body.visible = false
    target.visual.shell.visible = false
    target.visual.leftHalf.visible = true
    target.visual.rightHalf.visible = true
    target.visual.leftCut.visible = true
    target.visual.rightCut.visible = true
    if (target.visual.stem) target.visual.stem.visible = false
    if (target.visual.leaf) target.visual.leaf.visible = false
  }
  crushCount += 1
  comboCount = comboTimer > 0 ? comboCount + 1 : 1
  bestCombo = Math.max(bestCombo, comboCount)
  comboTimer = COMBO_WINDOW_MS
  lockedTargetId = null
  lockCharge = 0
  updateScoreBoard()
  flashTimer = feedbackIntensity === 'heavy' ? 170 : 130
  shakeTimer = feedbackIntensity === 'heavy' ? 160 : 110
  playCrushSound()
  triggerHaptics()
  createJuiceBurst(target)
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
    if (currentDist <= current.screenRadius + config.lockRadius + 22) return
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
  lockedTargetId = best?.id ?? null
  if (!best) lockCharge = 0
}

function updateLockCharge(dt: number) {
  const locked = findLockedTarget()
  if (!locked || !grabPoint.visible || runtimeState !== 'running') {
    lockCharge = Math.max(0, lockCharge - dt * config.chargeDecay)
    return
  }
  const dist = Math.hypot(locked.screenX - grabPoint.x, locked.screenY - grabPoint.y)
  const nearRadius = locked.screenRadius + config.lockRadius
  const closeFactor = clamp(1 - dist / Math.max(nearRadius, 1), 0, 1)
  const gestureBoost = gestureState === 'FIST_HOLD' ? 1 : 0
  const chargeRate = config.chargeRate * (0.4 + closeFactor * 0.7) + gestureBoost * config.chargeBoostRate * 0.9
  if (dist <= nearRadius + 18) lockCharge = clamp(lockCharge + dt * chargeRate, 0, LOCK_CHARGE_MAX)
  else lockCharge = Math.max(0, lockCharge - dt * config.chargeDecay)
}

function detectHit() {
  if (!grabPoint.visible || runtimeState !== 'running') return
  const locked = findLockedTarget()
  if (!locked) return
  const now = performance.now()
  const dist = Math.hypot(locked.screenX - grabPoint.x, locked.screenY - grabPoint.y)
  const easyRadius = locked.screenRadius + config.hitPadding + config.easyCrushBoost + 20
  const cooldownReady = now - lastCrushAt >= CRUSH_COOLDOWN_MS
  const fistIntentActive = justStartedFist || (now - lastFistStartAt <= config.fistIntentBufferMs)
  const canTriggerThisFist = fistIntentActive && fistReleasedSinceLastCrush && cooldownReady
  const readyToCrush = gestureState === 'FIST_HOLD' && lockCharge >= 0.48
  if (dist <= easyRadius && readyToCrush && canTriggerThisFist) {
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
  cameraCtx.fillStyle = 'rgba(255,255,255,0.08)'
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
  const maxParticles = performanceTier === 'high' ? 260 : performanceTier === 'medium' ? 180 : 100
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
    particle.vx *= particle.kind === 'screen' ? 0.99 : 0.975
    particle.vy = particle.vy * 0.98 + particle.gravity * dt
    particle.rotation += particle.spin * dt
    const alpha = (particle.life / particle.maxLife) * particle.alpha
    overlayCtx.save()
    overlayCtx.translate(particle.x, particle.y)
    overlayCtx.rotate(particle.rotation)
    overlayCtx.fillStyle = `hsla(${particle.hue} 92% ${particle.kind === 'screen' ? 60 : 56}% / ${alpha})`
    overlayCtx.beginPath()
    overlayCtx.ellipse(0, 0, particle.size * particle.stretch, particle.size * (particle.kind === 'screen' ? 0.46 : 0.62), 0, 0, Math.PI * 2)
    overlayCtx.fill()
    if (particle.kind === 'pulp') {
      overlayCtx.fillStyle = `hsla(${particle.hue + 16} 90% 78% / ${alpha * 0.86})`
      overlayCtx.beginPath()
      overlayCtx.arc(0, 0, particle.size * 0.28, 0, Math.PI * 2)
      overlayCtx.fill()
    }
    overlayCtx.restore()
  }
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)
  if (flashTimer > 0) {
    overlayCtx.fillStyle = `rgba(255,255,255,${Math.min(flashTimer / 170, 0.36)})`
    overlayCtx.fillRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)
  }
  drawParticles(Math.min((performance.now() - lastFrameTs) / 1000, 0.033))
  drawVirtualHand()
}

function drawDebug() {
  if (!SHOW_DEBUG) return
  refs.debugText.textContent = [
    `runtime: ${runtimeState}`,
    `gestureState: ${gestureState}`,
    `fistScore: ${fistScoreSmoothed.toFixed(3)}`,
    `handPresent: ${handPresent}`,
    `lockedTargetId: ${lockedTargetId ?? 'none'}`,
    `lockCharge: ${lockCharge.toFixed(2)}`,
    `objects: ${objects.filter((item) => !item.crushed).length}`,
    `particles: ${particles.length}`,
    `crushCount: ${crushCount}`,
    `combo: ${comboCount}`,
    `bestCombo: ${bestCombo}`,
    `timeLeft: ${(roundTimeLeftMs / 1000).toFixed(2)}`,
    `detectIntervalMs: ${detectIntervalMs}`,
    `hitPadding: ${config.hitPadding}`,
    `lockRadius: ${config.lockRadius}`,
    `facingMode: ${currentFacingMode}`,
    `tier: ${performanceTier}`,
    `feedback: ${feedbackIntensity}`,
    `secure: ${isSecureRuntime()}`,
  ].join('\n')
}

function normalizeToScreen(point: { x: number; y: number }) {
  return {
    x: (1 - point.x) * refs.overlayCanvas.width,
    y: point.y * refs.overlayCanvas.height,
  }
}

function processDetection(result: HandLandmarkerResult | null) {
  const landmarks = result?.landmarks?.[0]
  handPresent = Boolean(landmarks)
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
  if (justStartedFist) detectHit()
  if (runtimeState === 'running') {
    const cooldownLeft = Math.max(0, CRUSH_COOLDOWN_MS - (performance.now() - lastCrushAt))
    updateStatus(
      lockedTargetId != null
        ? gestureState === 'FIST_HOLD'
          ? !fistReleasedSinceLastCrush
            ? cooldownLeft > 0
              ? `命中成功，冷却 ${(cooldownLeft / 1000).toFixed(1)}s，先松手再握`
              : '先松手，再重新握拳触发下一次'
            : lockCharge >= 0.48
              ? '重新握拳可捏爆 3D 水果'
              : '保持锁定，轻握也能识别'
          : '已锁定，重新握拳才触发'
        : '把手移到水果附近',
    )
  }
}

async function setupHandTracking() {
  updateStatus('加载手势识别模型...')
  const resolver = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm')
  handLandmarker = await HandLandmarker.createFromOptions(resolver, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
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
  updateStatus('请求相机权限...')
  stopCameraStream()
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } } })
  refs.video.srcObject = stream
  await refs.video.play()
}

async function toggleCameraFacingMode() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment'
  updateCameraButtonLabel()
  try {
    await setupCamera()
  } catch (error) {
    console.error(error)
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment'
    updateCameraButtonLabel()
    await setupCamera()
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    else await document.exitFullscreen()
  } catch (error) {
    console.warn('Fullscreen toggle failed', error)
  }
  updateFullscreenLabel()
}

function handleVisibilityChange() {
  if (document.hidden) stream?.getVideoTracks().forEach((track) => (track.enabled = false))
  else stream?.getVideoTracks().forEach((track) => (track.enabled = true))
}

function describeStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (!isSecureRuntime()) {
    return {
      title: '需要 HTTPS 才能启动相机',
      desc: '当前页面不是安全上下文。请把项目部署到 https:// 域名后，再用手机打开试玩。',
      meta: '推荐部署到 Cloudflare Pages / Netlify / Vercel，发布后直接把 HTTPS 链接发给别人。',
    }
  }
  if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
    return {
      title: '相机权限被拒绝',
      desc: '请在浏览器地址栏或系统设置中允许相机权限，然后重新点击开始游戏。',
      meta: 'iPhone 建议用 Safari；Android 建议用 Chrome。',
    }
  }
  if (message.includes('getUserMedia')) {
    return {
      title: '当前浏览器不支持相机能力',
      desc: '请换用较新的 Safari / Chrome 打开此页面。',
      meta: '主流安卓 Chrome 与 iPhone Safari 兼容最好。',
    }
  }
  return {
    title: '启动失败',
    desc: '初始化手势识别、Three.js 场景或相机时出错，请重试一次，或换浏览器/网络环境。',
    meta: message,
  }
}

async function startGame() {
  refs.startButton.disabled = true
  refs.panelAction.disabled = true
  refs.startButton.textContent = '启动中...'
  refs.panelAction.textContent = '启动中...'
  setRuntimeState('starting')
  try {
    if (!isSecureRuntime()) throw new Error('Insecure context')
    audioCtx = audioCtx ?? new AudioContext()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    feedbackIntensity = chooseFeedbackIntensity()
    refs.feedbackText.textContent = feedbackIntensity
    applyPerformanceTier(choosePerformanceTier())
    resizeCanvases()
    resetRoundStats()
    resetObjects()
    if (!stream) await setupCamera()
    if (!handLandmarker) await setupHandTracking()
    setRuntimeState('running')
    updateStatus('挑战开始')
    updateHint('现在已升级为 Three.js 真 3D 水果场景；手机端握拳识别已进一步放宽，且只有重新握拳命中目标才会捏爆。')
    refs.startButton.textContent = '挑战中'
    refs.panelAction.textContent = '开始挑战'
  } catch (error) {
    console.error(error)
    const detail = describeStartupError(error)
    setRuntimeState('error')
    updateStatus('启动失败')
    updateHint(detail.desc)
    updatePanel(detail.title, detail.desc, detail.meta, '重试启动')
    refs.startButton.disabled = false
    refs.panelAction.disabled = false
    refs.startButton.textContent = '重试启动'
    refs.panelAction.textContent = '重试启动'
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
      item.splitProgress = Math.min(1, item.splitProgress + dt * 3.8)
      if (ts >= item.respawnAt) {
        respawnObject(item)
        continue
      }
    } else {
      item.splitProgress = 0
    }
    if (item.visual) item.visual.group.visible = true
    item.pulse = Math.max(0, item.pulse - dt * 3.2)
  }

  threeScene.render()
  drawOverlay()
  drawDebug()
  requestAnimationFrame(tick)
}

function bindStartActions() {
  const start = () => {
    void startGame()
  }
  refs.startButton.addEventListener('click', start)
  refs.panelAction.addEventListener('click', start)
}

window.addEventListener('resize', resizeCanvases)
window.addEventListener('fullscreenchange', updateFullscreenLabel)
document.addEventListener('visibilitychange', handleVisibilityChange)
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

threeScene.setBackground(backgroundTexture)
applyPerformanceTier(choosePerformanceTier())
feedbackIntensity = chooseFeedbackIntensity()
refs.feedbackText.textContent = feedbackIntensity
resizeCanvases()
ensureObjects(MAX_OBJECTS)
updateScoreBoard()
updateFullscreenLabel()
updateCameraButtonLabel()
updatePanel('锁定 3D 水果，重新握拳再捏爆', '点击开始后授权相机，屏幕里的虚拟手会实时反映你的张手或抓手。先锁定 Three.js 3D 水果，再重新握拳，才能触发一次捏爆。', getStartupMeta(), '开始挑战')
updateHint('这是移动端 Three.js 3D 版。水果会在立体场景中翻滚，必须先锁定目标，再重新握拳，且两次触发间隔 1 秒。')
updateStatus('等待启动')
setRuntimeState('idle')
bindStartActions()
requestAnimationFrame(tick)
