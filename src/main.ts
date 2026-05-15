import './style.css'
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

type GestureState = 'OPEN' | 'CLOSING' | 'FIST_HOLD'
type Crushable = {
  id: number
  emoji: string
  x: number
  y: number
  radius: number
  crushed: boolean
  respawnAt: number
  pulse: number
  driftAngle: number
  driftSpeed: number
  driftRadius: number
  baseX: number
  baseY: number
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: number
}

type PerformanceTier = 'high' | 'medium' | 'low'
type FeedbackIntensity = 'light' | 'medium' | 'heavy'
type RuntimeState = 'idle' | 'starting' | 'running' | 'error' | 'ended'
type CameraFacingMode = 'environment' | 'user'

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
const ROUND_DURATION_MS = 30000
const LOCK_CHARGE_MAX = 1
const MAX_OBJECTS = 5

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
      <div class="intro-chip">Hand Crush Web · 上线试玩版</div>
      <h1 id="panelTitle">锁定目标，握住再捏爆</h1>
      <p id="panelDesc">现在屏幕里会显示你的虚拟游戏手。先靠近目标完成锁定，再明确做抓握动作，才能触发爆裂。</p>
      <div class="step-list">
        <div class="step-item"><span>1</span><p>点击开始并允许相机权限</p></div>
        <div class="step-item"><span>2</span><p>把虚拟手移到漂浮目标附近</p></div>
        <div class="step-item"><span>3</span><p>看到锁定后，明确握住再捏爆</p></div>
      </div>
      <p id="panelMeta" class="intro-meta">推荐：Android Chrome / iPhone Safari · 需要 HTTPS 才能正常调用相机</p>
      <p id="resultScore" class="result-line hidden"></p>
      <p id="resultCombo" class="result-line hidden"></p>
      <div class="intro-actions">
        <button id="panelAction" class="start-button">开始挑战</button>
      </div>
    </div>

    <div class="hud top-left compact-hud">
      <div class="badge">Virtual Hand Mode</div>
      <div id="statusText" class="status">等待启动</div>
      <div id="hintText" class="hint">先靠近锁定，再真正握住，才会捏爆目标。</div>
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
        <strong id="timerText">30.0</strong>
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
const gameCtx = refs.gameCanvas.getContext('2d')!
const overlayCtx = refs.overlayCanvas.getContext('2d')!

const EMOJIS = ['🍎', '💎', '🧊', '🥝', '🍋', '⭐', '🫐', '🥥']
const FINGER_TIPS = [4, 8, 12, 16, 20]
const FINGER_BASES = [2, 5, 9, 13, 17]

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
let flashTimer = 0
let shakeTimer = 0
let ringTimer = 0
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

const objects: Crushable[] = []
const particles: Particle[] = []

const config = {
  smoothingAlpha: 0.6,
  enterThreshold: 0.58,
  holdThreshold: 0.54,
  exitThreshold: 0.34,
  minEnterFrames: 2,
  minExitFrames: 2,
  particleBurst: 28,
  hitPadding: 84,
  lockRadius: 126,
  easyCrushBoost: 24,
  chargeRate: 1.25,
  chargeBoostRate: 1.8,
  chargeDecay: 1.4,
}

function resizeCanvases() {
  const width = window.innerWidth
  const height = window.innerHeight
  for (const canvas of [refs.cameraCanvas, refs.gameCanvas, refs.overlayCanvas]) {
    canvas.width = width
    canvas.height = height
  }
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
  const show = state !== 'running'
  showPanel(show)
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
    config.particleBurst = 32
    config.hitPadding = 92
    config.lockRadius = 138
  } else if (tier === 'medium') {
    detectIntervalMs = 26
    config.particleBurst = 28
    config.hitPadding = 84
    config.lockRadius = 126
  } else {
    detectIntervalMs = 36
    config.particleBurst = 18
    config.hitPadding = 70
    config.lockRadius = 108
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
      ? '当前环境：iPhone / Safari · 已强化虚拟手柄与抓握态反馈'
      : '当前环境：iPhone · 建议改用 Safari 打开，兼容性最好'
  }
  if (isAndroid) {
    return '当前环境：Android · 推荐使用 Chrome，当前版本加入了虚拟手柄手'
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
  updatePanel(
    '挑战结束',
    '这一版需要明确握住后才会捏爆，虚拟手会同步显示你的张手与抓手状态。',
    '如果要上线试玩，这版更像真正的“虚拟抓取手柄”了。',
    '再来一局',
  )
  refs.startButton.disabled = false
  refs.panelAction.disabled = false
  refs.startButton.textContent = '重新开始'
  refs.panelAction.textContent = '再来一局'
  updateStatus('挑战结束')
  updateHint('点击“再来一局”重新开始 30 秒挑战。')
}

function isValidSpawn(baseX: number, baseY: number, radius: number) {
  return objects.every((item) => {
    if (item.crushed) return true
    const dist = Math.hypot(item.baseX - baseX, item.baseY - baseY)
    return dist >= item.radius + radius + 28
  })
}

function spawnObject(): Crushable {
  const margin = 72
  const hudTop = Math.min(window.innerHeight * 0.24, 180)
  const hudRight = Math.min(window.innerWidth * 0.23, 120)

  let attempts = 0
  let radius = randomBetween(38, 56)
  let baseX = 0
  let baseY = 0
  do {
    radius = randomBetween(38, 56)
    baseX = randomBetween(margin, window.innerWidth - margin - hudRight)
    baseY = randomBetween(hudTop, window.innerHeight - margin - 90)
    attempts += 1
  } while (attempts < 50 && !isValidSpawn(baseX, baseY, radius))

  return {
    id: nextObjectId++,
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    x: baseX,
    y: baseY,
    baseX,
    baseY,
    radius,
    crushed: false,
    respawnAt: 0,
    pulse: 0,
    driftAngle: randomBetween(0, Math.PI * 2),
    driftSpeed: randomBetween(0.45, 0.95),
    driftRadius: randomBetween(16, 34),
  }
}

function ensureObjects(count = MAX_OBJECTS) {
  while (objects.length < count) objects.push(spawnObject())
}

function resetObjects() {
  objects.length = 0
  ensureObjects(MAX_OBJECTS)
}

function respawnObject(target: Crushable) {
  const replacement = spawnObject()
  Object.assign(target, replacement)
}

function updateObjectMotion(dt: number) {
  for (const item of objects) {
    if (item.crushed) continue
    item.driftAngle += item.driftSpeed * dt
    item.x = item.baseX + Math.cos(item.driftAngle) * item.driftRadius
    item.y = item.baseY + Math.sin(item.driftAngle * 0.8) * item.driftRadius
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

  return {
    x: sum.x / ids.length,
    y: sum.y / ids.length,
  }
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
    const normalized = 1 - Math.min(fold / (extend * 2.55), 1)
    return normalized
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
        ringTimer = 140
      }
    } else if (score > config.holdThreshold) {
      gestureState = 'CLOSING'
    } else {
      enterFrames = 0
      if (score < config.exitThreshold) gestureState = 'OPEN'
    }
  }

  if (gestureState === 'FIST_HOLD') {
    if (score < config.exitThreshold) {
      exitFrames += 1
      if (exitFrames >= config.minExitFrames) {
        gestureState = 'OPEN'
        enterFrames = 0
        exitFrames = 0
      }
    } else {
      exitFrames = 0
    }
  }
}

function playOscLayer(
  now: number,
  type: OscillatorType,
  startFreq: number,
  endFreq: number,
  gainPeak: number,
  duration: number,
) {
  if (!audioCtx) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  const filter = audioCtx.createBiquadFilter()

  osc.type = type
  osc.frequency.setValueAtTime(startFreq, now)
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration)

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2200, now)

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

function playNoiseBurst(now: number) {
  if (!audioCtx) return
  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.08, audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  const source = audioCtx.createBufferSource()
  const filter = audioCtx.createBiquadFilter()
  const gain = audioCtx.createGain()
  source.buffer = buffer
  filter.type = 'bandpass'
  filter.frequency.value = 1400
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(audioCtx.destination)
  source.start(now)
}

function playCrushSound() {
  if (!audioCtx) return
  const now = audioCtx.currentTime
  const heavy = feedbackIntensity === 'heavy'

  playOscLayer(now, 'triangle', randomBetween(150, 200), randomBetween(62, 82), heavy ? 0.24 : 0.15, 0.18)
  playOscLayer(now, 'square', randomBetween(260, 360), randomBetween(96, 140), heavy ? 0.14 : 0.09, 0.1)
  playOscLayer(now + 0.002, 'sawtooth', randomBetween(640, 840), randomBetween(180, 260), heavy ? 0.06 : 0.04, 0.06)
  playNoiseBurst(now + 0.001)
}

function triggerHaptics() {
  if (typeof navigator.vibrate !== 'function') return
  if (feedbackIntensity === 'heavy') {
    navigator.vibrate([18, 14, 24, 12, 30])
  } else if (feedbackIntensity === 'medium') {
    navigator.vibrate([12, 12, 18])
  } else {
    navigator.vibrate(18)
  }
}

function emitCrush(target: Crushable) {
  if (runtimeState !== 'running') return

  target.crushed = true
  target.respawnAt = performance.now() + 480
  target.pulse = 1.3
  crushCount += 1
  comboCount = comboTimer > 0 ? comboCount + 1 : 1
  bestCombo = Math.max(bestCombo, comboCount)
  comboTimer = COMBO_WINDOW_MS
  lockedTargetId = null
  lockCharge = 0
  updateScoreBoard()

  flashTimer = feedbackIntensity === 'heavy' ? 160 : 120
  shakeTimer = feedbackIntensity === 'heavy' ? 150 : 100
  playCrushSound()
  triggerHaptics()

  for (let i = 0; i < config.particleBurst; i += 1) {
    const angle = (Math.PI * 2 * i) / config.particleBurst + randomBetween(-0.32, 0.32)
    const speed = randomBetween(200, feedbackIntensity === 'heavy' ? 500 : 340)
    particles.push({
      x: target.x,
      y: target.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randomBetween(0.26, 0.52),
      maxLife: randomBetween(0.26, 0.52),
      size: randomBetween(5, 13),
      hue: randomBetween(0, 360),
    })
  }
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
    const currentDist = Math.hypot(current.x - grabPoint.x, current.y - grabPoint.y)
    if (currentDist <= current.radius + config.lockRadius + 22) {
      return
    }
  }

  let best: Crushable | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const item of objects) {
    if (item.crushed) continue
    const dist = Math.hypot(item.x - grabPoint.x, item.y - grabPoint.y)
    if (dist < bestDist && dist <= item.radius + config.lockRadius) {
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

  const dist = Math.hypot(locked.x - grabPoint.x, locked.y - grabPoint.y)
  const nearRadius = locked.radius + config.lockRadius
  const closeFactor = clamp(1 - dist / Math.max(nearRadius, 1), 0, 1)
  const gestureBoost = gestureState === 'FIST_HOLD' ? 1 : 0
  const chargeRate = config.chargeRate * (0.4 + closeFactor * 0.7) + gestureBoost * config.chargeBoostRate * 0.9

  if (dist <= nearRadius + 18) {
    lockCharge = clamp(lockCharge + dt * chargeRate, 0, LOCK_CHARGE_MAX)
  } else {
    lockCharge = Math.max(0, lockCharge - dt * config.chargeDecay)
  }
}

function detectHit() {
  if (!grabPoint.visible || runtimeState !== 'running') return

  const locked = findLockedTarget()
  if (locked) {
    const dist = Math.hypot(locked.x - grabPoint.x, locked.y - grabPoint.y)
    const easyRadius = locked.radius + config.hitPadding + config.easyCrushBoost
    const readyToCrush = gestureState === 'FIST_HOLD' && lockCharge >= 0.72
    if (dist <= easyRadius && readyToCrush) {
      emitCrush(locked)
      return
    }
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

  cameraCtx.fillStyle = 'rgba(4, 10, 22, 0.72)'
  cameraCtx.fillRect(0, 0, w, h)
}

function drawBackgroundLayer() {
  const w = refs.gameCanvas.width
  const h = refs.gameCanvas.height
  gameCtx.fillStyle = 'rgba(6, 12, 28, 0.4)'
  gameCtx.fillRect(0, 0, w, h)

  for (let i = 0; i < 5; i += 1) {
    const y = 120 + i * 150
    gameCtx.strokeStyle = `rgba(120, 220, 255, ${0.05 + i * 0.01})`
    gameCtx.lineWidth = 2
    gameCtx.beginPath()
    gameCtx.moveTo(0, y)
    gameCtx.lineTo(w, y)
    gameCtx.stroke()
  }
}

function drawVirtualHand() {
  if (!grabPoint.visible) return

  overlayCtx.save()
  overlayCtx.translate(grabPoint.x, grabPoint.y)

  const grab = gestureState === 'FIST_HOLD'
  const scale = grab ? 0.92 : 1

  overlayCtx.scale(scale, scale)
  overlayCtx.fillStyle = 'rgba(255, 214, 173, 0.95)'
  overlayCtx.strokeStyle = 'rgba(71, 42, 28, 0.7)'
  overlayCtx.lineWidth = 3

  if (!grab) {
    overlayCtx.beginPath()
    overlayCtx.roundRect(-28, 6, 56, 78, 24)
    overlayCtx.fill()
    overlayCtx.stroke()

    const fingerXs = [-26, -10, 6, 22]
    const fingerHeights = [64, 80, 74, 58]
    fingerXs.forEach((x, index) => {
      overlayCtx.beginPath()
      overlayCtx.roundRect(x, -fingerHeights[index], 12, fingerHeights[index] + 18, 10)
      overlayCtx.fill()
      overlayCtx.stroke()
    })

    overlayCtx.save()
    overlayCtx.translate(-34, 18)
    overlayCtx.rotate(-0.95)
    overlayCtx.beginPath()
    overlayCtx.roundRect(-8, -26, 16, 44, 10)
    overlayCtx.fill()
    overlayCtx.stroke()
    overlayCtx.restore()
  } else {
    overlayCtx.beginPath()
    overlayCtx.arc(0, 28, 34, 0, Math.PI * 2)
    overlayCtx.fill()
    overlayCtx.stroke()

    const knuckleXs = [-22, -8, 6, 20]
    knuckleXs.forEach((x) => {
      overlayCtx.beginPath()
      overlayCtx.roundRect(x, -6, 12, 30, 8)
      overlayCtx.fill()
      overlayCtx.stroke()
    })

    overlayCtx.save()
    overlayCtx.translate(-30, 26)
    overlayCtx.rotate(-0.7)
    overlayCtx.beginPath()
    overlayCtx.roundRect(-8, -18, 16, 34, 8)
    overlayCtx.fill()
    overlayCtx.stroke()
    overlayCtx.restore()
  }

  overlayCtx.restore()
}

function drawObjects(dt: number) {
  const now = performance.now()
  gameCtx.clearRect(0, 0, refs.gameCanvas.width, refs.gameCanvas.height)
  drawBackgroundLayer()

  let offsetX = 0
  let offsetY = 0
  if (shakeTimer > 0) {
    const shakeStrength = feedbackIntensity === 'heavy' ? 10 : 6
    offsetX = randomBetween(-shakeStrength, shakeStrength)
    offsetY = randomBetween(-shakeStrength, shakeStrength)
  }

  updateObjectMotion(dt)

  gameCtx.save()
  gameCtx.translate(offsetX, offsetY)

  for (const item of objects) {
    if (item.crushed && now >= item.respawnAt) {
      respawnObject(item)
    }

    if (!item.crushed) {
      item.pulse = Math.max(0, item.pulse - dt * 3.2)
      const scale = 1 + item.pulse * 0.22
      gameCtx.save()
      gameCtx.translate(item.x, item.y)
      gameCtx.scale(scale, scale)

      const isLocked = item.id === lockedTargetId
      const near = grabPoint.visible && Math.hypot(item.x - grabPoint.x, item.y - grabPoint.y) <= item.radius + config.hitPadding
      gameCtx.beginPath()
      gameCtx.fillStyle = isLocked ? 'rgba(255,255,255,0.36)' : near ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.14)'
      gameCtx.arc(0, 0, item.radius + 18, 0, Math.PI * 2)
      gameCtx.fill()

      gameCtx.beginPath()
      gameCtx.strokeStyle = isLocked ? 'rgba(255,215,106,0.98)' : near ? 'rgba(124,255,175,0.9)' : 'rgba(158,232,255,0.35)'
      gameCtx.lineWidth = isLocked ? 5 : near ? 4 : 2
      gameCtx.arc(0, 0, item.radius + 12, 0, Math.PI * 2)
      gameCtx.stroke()

      if (isLocked) {
        gameCtx.beginPath()
        gameCtx.strokeStyle = 'rgba(255,215,106,0.55)'
        gameCtx.lineWidth = 2
        gameCtx.arc(0, 0, item.radius + 22 + Math.sin(now / 120) * 4, 0, Math.PI * 2)
        gameCtx.stroke()
      }

      gameCtx.font = `${item.radius * 1.45}px system-ui`
      gameCtx.textAlign = 'center'
      gameCtx.textBaseline = 'middle'
      gameCtx.fillText(item.emoji, 0, 2)
      gameCtx.restore()
    }
  }

  const maxParticles = performanceTier === 'high' ? 180 : performanceTier === 'medium' ? 104 : 58
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
    particle.vx *= 0.975
    particle.vy *= 0.975
    particle.vy += 420 * dt

    const alpha = particle.life / particle.maxLife
    gameCtx.fillStyle = `hsla(${particle.hue} 100% 70% / ${alpha})`
    gameCtx.beginPath()
    gameCtx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2)
    gameCtx.fill()
  }

  gameCtx.restore()
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)

  if (flashTimer > 0) {
    overlayCtx.fillStyle = `rgba(255,255,255,${Math.min(flashTimer / 160, 0.45)})`
    overlayCtx.fillRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)
  }

  const locked = findLockedTarget()
  if (locked) {
    overlayCtx.beginPath()
    overlayCtx.strokeStyle = 'rgba(255,215,106,0.6)'
    overlayCtx.lineWidth = 2
    overlayCtx.arc(locked.x, locked.y, locked.radius + 30 + Math.sin(performance.now() / 120) * 5, 0, Math.PI * 2)
    overlayCtx.stroke()

    overlayCtx.beginPath()
    overlayCtx.strokeStyle = lockCharge >= 0.75 ? 'rgba(255,110,110,0.95)' : 'rgba(124,255,175,0.95)'
    overlayCtx.lineWidth = 6
    overlayCtx.arc(
      locked.x,
      locked.y,
      locked.radius + 24,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * lockCharge,
    )
    overlayCtx.stroke()
  }

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
  fistScoreSmoothed =
    fistScoreSmoothed * (1 - config.smoothingAlpha) + rawScore * config.smoothingAlpha
  updateGestureState(fistScoreSmoothed)

  if (justStartedFist || gestureState === 'FIST_HOLD') {
    detectHit()
  }

  if (runtimeState === 'running') {
    updateStatus(
      lockedTargetId != null
        ? gestureState === 'FIST_HOLD'
          ? lockCharge >= 0.72
            ? '握住了，捏爆！'
            : '保持抓握，继续蓄力'
          : '已锁定，先握住'
        : '把手移到目标附近',
    )
  }
}

async function setupHandTracking() {
  updateStatus('加载手势识别模型...')
  const resolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
  )

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
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持 getUserMedia')
  }

  updateStatus('请求相机权限...')
  stopCameraStream()
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: currentFacingMode,
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  })

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
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (error) {
    console.warn('Fullscreen toggle failed', error)
  }
  updateFullscreenLabel()
}

function handleVisibilityChange() {
  if (document.hidden) {
    stream?.getVideoTracks().forEach((track) => (track.enabled = false))
  } else {
    stream?.getVideoTracks().forEach((track) => (track.enabled = true))
  }
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
    desc: '初始化手势识别或相机时出错，请重试一次，或换浏览器/网络环境。',
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
    if (!isSecureRuntime()) {
      throw new Error('Insecure context')
    }

    audioCtx = audioCtx ?? new AudioContext()
    if (audioCtx.state === 'suspended') await audioCtx.resume()

    feedbackIntensity = chooseFeedbackIntensity()
    refs.feedbackText.textContent = feedbackIntensity
    applyPerformanceTier(choosePerformanceTier())

    resizeCanvases()
    resetRoundStats()
    resetObjects()

    if (!stream) {
      await setupCamera()
    }
    if (!handLandmarker) {
      await setupHandTracking()
    }

    setRuntimeState('running')
    updateStatus('挑战开始')
    updateHint('虚拟手会实时显示张手或抓手状态。先锁定，再真正握住目标。')
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
    if (roundTimeLeftMs === 0) {
      finishRound()
    }
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
  ringTimer = Math.max(0, ringTimer - dt * 1000)

  drawCameraLayer()
  drawObjects(dt)
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

applyPerformanceTier(choosePerformanceTier())
feedbackIntensity = chooseFeedbackIntensity()
refs.feedbackText.textContent = feedbackIntensity
resizeCanvases()
ensureObjects(MAX_OBJECTS)
updateScoreBoard()
updateFullscreenLabel()
updateCameraButtonLabel()
updatePanel(
  '锁定目标，握住再捏爆',
  '点击开始后授权相机，屏幕里的虚拟手会实时反映你的张手或抓手。先锁定目标，再明确握住，才能捏爆。',
  getStartupMeta(),
  '开始挑战',
)
updateHint('这是移动端虚拟手柄版。你会看到自己的游戏手，先张手靠近，握住后再爆。')
updateStatus('等待启动')
setRuntimeState('idle')
bindStartActions()
requestAnimationFrame(tick)
