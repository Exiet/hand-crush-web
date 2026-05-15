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
}

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const SHOW_DEBUG = import.meta.env.DEV
const COMBO_WINDOW_MS = 1600
const ROUND_DURATION_MS = 30000

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app root')

app.innerHTML = `
  <div class="shell">
    <video id="camera" playsinline muted></video>
    <canvas id="cameraCanvas"></canvas>
    <canvas id="gameCanvas"></canvas>
    <canvas id="overlayCanvas"></canvas>

    <div class="intro-panel" id="panel">
      <div class="intro-chip">Hand Crush Web · 挑战试玩版</div>
      <h1 id="panelTitle">30 秒内，你能抓爆多少目标？</h1>
      <p id="panelDesc">点击开始后授权相机，把手掌移到目标上方，快速握拳。倒计时结束后会显示你的成绩。</p>
      <div class="step-list">
        <div class="step-item"><span>1</span><p>点击开始并允许相机权限</p></div>
        <div class="step-item"><span>2</span><p>把手掌移到目标上方</p></div>
        <div class="step-item"><span>3</span><p>快速握拳，尽量打出更高连击</p></div>
      </div>
      <p id="panelMeta" class="intro-meta">推荐：Android Chrome / iPhone Safari · 需要 HTTPS 才能正常调用相机</p>
      <p id="resultScore" class="result-line hidden"></p>
      <p id="resultCombo" class="result-line hidden"></p>
      <div class="intro-actions">
        <button id="panelAction" class="start-button">开始挑战</button>
      </div>
    </div>

    <div class="hud top-left">
      <div class="badge">Hand Crush Web · Challenge</div>
      <div id="statusText" class="status">等待启动</div>
      <div id="hintText" class="hint">点击开始后授权相机，把手放进画面，握拳抓爆目标。</div>
      <div class="pill-row">
        <span class="pill">性能：<strong id="perfText">auto</strong></span>
        <span class="pill">反馈：<strong id="feedbackText">heavy</strong></span>
      </div>
    </div>

    <div class="hud top-center score-board">
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
    </div>

    <div class="hud top-right controls">
      <button id="installButton" class="secondary-button hidden">安装到手机</button>
      <button id="startButton" class="start-button">开始挑战</button>
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
}

const cameraCtx = refs.cameraCanvas.getContext('2d')!
const gameCtx = refs.gameCanvas.getContext('2d')!
const overlayCtx = refs.overlayCanvas.getContext('2d')!

const EMOJIS = ['🍎', '💎', '🧊', '🥝', '🍋', '⭐', '🫐', '🥥']
const FINGER_TIPS = [4, 8, 12, 16, 20]
const FINGER_BASES = [2, 5, 9, 13, 17]

let handLandmarker: HandLandmarker | null = null
let lastVideoTime = -1
let detectIntervalMs = 45
let lastDetectTs = 0
let fistScoreSmoothed = 0
let enterFrames = 0
let exitFrames = 0
let gestureState: GestureState = 'OPEN'
let justStartedFist = false
let grabPoint = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5, visible: false }
let handPresent = false
let stream: MediaStream | null = null
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

const objects: Crushable[] = []
const particles: Particle[] = []

const config = {
  smoothingAlpha: 0.42,
  enterThreshold: 0.72,
  holdThreshold: 0.68,
  exitThreshold: 0.45,
  minEnterFrames: 3,
  minExitFrames: 2,
  particleBurst: 18,
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
}

function updateScoreBoard() {
  refs.scoreText.textContent = String(crushCount)
  refs.comboText.textContent = `x${comboCount}`
  refs.timerText.textContent = (roundTimeLeftMs / 1000).toFixed(1)
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
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
    detectIntervalMs = 33
    config.particleBurst = 22
  } else if (tier === 'medium') {
    detectIntervalMs = 45
    config.particleBurst = 16
  } else {
    detectIntervalMs = 66
    config.particleBurst = 10
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
      ? '当前环境：iPhone / Safari · 建议添加到主屏幕获得更像 App 的体验'
      : '当前环境：iPhone · 建议改用 Safari 打开，兼容性最好'
  }
  if (isAndroid) {
    return '当前环境：Android · 推荐使用 Chrome，振动与权限体验更稳定'
  }
  return '当前环境：桌面或其他浏览器 · 真机测试请用手机 HTTPS 链接打开'
}

function resetRoundStats() {
  crushCount = 0
  comboCount = 0
  bestCombo = 0
  comboTimer = 0
  roundTimeLeftMs = ROUND_DURATION_MS
  updateScoreBoard()
  refs.resultScore.classList.add('hidden')
  refs.resultCombo.classList.add('hidden')
}

function finishRound() {
  runtimeState = 'ended'
  showPanel(true)
  refs.resultScore.textContent = `本局击碎：${crushCount}`
  refs.resultCombo.textContent = `最高连击：x${bestCombo}`
  refs.resultScore.classList.remove('hidden')
  refs.resultCombo.classList.remove('hidden')
  updatePanel(
    '挑战结束',
    '你已经完成本轮 30 秒挑战，可以立刻再来一局，继续刷新成绩。',
    '把这个链接发给朋友，看看谁的击碎数更高。',
    '再来一局',
  )
  refs.startButton.disabled = false
  refs.panelAction.disabled = false
  refs.startButton.textContent = '重新开始'
  refs.panelAction.textContent = '再来一局'
  updateStatus('挑战结束')
  updateHint('点击“再来一局”重新开始 30 秒挑战。')
}

function spawnObject(): Crushable {
  const margin = 56
  return {
    id: nextObjectId++,
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    x: randomBetween(margin, window.innerWidth - margin),
    y: randomBetween(140, window.innerHeight - margin),
    radius: randomBetween(28, 42),
    crushed: false,
    respawnAt: 0,
    pulse: 0,
  }
}

function ensureObjects(count = 5) {
  while (objects.length < count) objects.push(spawnObject())
}

function resetObjects() {
  objects.length = 0
  ensureObjects(5)
}

function respawnObject(target: Crushable) {
  const replacement = spawnObject()
  target.emoji = replacement.emoji
  target.x = replacement.x
  target.y = replacement.y
  target.radius = replacement.radius
  target.crushed = false
  target.respawnAt = 0
  target.pulse = 0
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
    const normalized = 1 - Math.min(fold / (extend * 2.2), 1)
    return normalized
  })

  const thumbBoost = values[0] * 0.9
  const fingerAvg = (values[1] + values[2] + values[3] + values[4]) / 4
  return Math.max(0, Math.min(1, fingerAvg * 0.82 + thumbBoost * 0.18))
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
        ringTimer = 120
      }
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
      if (score > config.holdThreshold) gestureState = 'FIST_HOLD'
    }
  }
}

function playOscLayer(now: number, type: OscillatorType, startFreq: number, endFreq: number, gainPeak: number, duration: number) {
  if (!audioCtx) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  const filter = audioCtx.createBiquadFilter()

  osc.type = type
  osc.frequency.setValueAtTime(startFreq, now)
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration)

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1800, now)

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

function playCrushSound() {
  if (!audioCtx) return
  const now = audioCtx.currentTime
  const heavy = feedbackIntensity === 'heavy'

  playOscLayer(now, 'triangle', randomBetween(140, 190), randomBetween(58, 80), heavy ? 0.2 : 0.13, 0.15)
  playOscLayer(now, 'square', randomBetween(230, 320), randomBetween(88, 130), heavy ? 0.12 : 0.08, 0.09)
  playOscLayer(now + 0.004, 'sawtooth', randomBetween(500, 760), randomBetween(180, 260), heavy ? 0.05 : 0.03, 0.05)
}

function triggerHaptics() {
  if (typeof navigator.vibrate !== 'function') return
  if (feedbackIntensity === 'heavy') {
    navigator.vibrate([14, 16, 24])
  } else if (feedbackIntensity === 'medium') {
    navigator.vibrate([12, 14, 18])
  } else {
    navigator.vibrate(18)
  }
}

function emitCrush(target: Crushable) {
  if (runtimeState !== 'running') return

  target.crushed = true
  target.respawnAt = performance.now() + 650
  target.pulse = 1
  crushCount += 1
  comboCount = comboTimer > 0 ? comboCount + 1 : 1
  bestCombo = Math.max(bestCombo, comboCount)
  comboTimer = COMBO_WINDOW_MS
  updateScoreBoard()

  flashTimer = feedbackIntensity === 'heavy' ? 130 : 90
  shakeTimer = feedbackIntensity === 'heavy' ? 120 : 70
  playCrushSound()
  triggerHaptics()

  for (let i = 0; i < config.particleBurst; i += 1) {
    const angle = (Math.PI * 2 * i) / config.particleBurst + randomBetween(-0.25, 0.25)
    const speed = randomBetween(120, feedbackIntensity === 'heavy' ? 340 : 260)
    particles.push({
      x: target.x,
      y: target.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randomBetween(0.22, 0.42),
      maxLife: randomBetween(0.22, 0.42),
      size: randomBetween(4, 10),
      hue: randomBetween(0, 360),
    })
  }
}

function detectHit() {
  if (!grabPoint.visible || runtimeState !== 'running') return
  const active = objects.find((item) => {
    if (item.crushed) return false
    return Math.hypot(item.x - grabPoint.x, item.y - grabPoint.y) <= item.radius + 28
  })

  if (active) emitCrush(active)
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

  cameraCtx.fillStyle = 'rgba(8, 12, 24, 0.32)'
  cameraCtx.fillRect(0, 0, w, h)
}

function drawObjects(dt: number) {
  const now = performance.now()
  gameCtx.clearRect(0, 0, refs.gameCanvas.width, refs.gameCanvas.height)

  let offsetX = 0
  let offsetY = 0
  if (shakeTimer > 0) {
    const shakeStrength = feedbackIntensity === 'heavy' ? 8 : 5
    offsetX = randomBetween(-shakeStrength, shakeStrength)
    offsetY = randomBetween(-shakeStrength, shakeStrength)
  }

  gameCtx.save()
  gameCtx.translate(offsetX, offsetY)

  for (const item of objects) {
    if (item.crushed && now >= item.respawnAt) {
      respawnObject(item)
    }

    if (!item.crushed) {
      item.pulse = Math.max(0, item.pulse - dt * 2.4)
      const scale = 1 + item.pulse * 0.15
      gameCtx.save()
      gameCtx.translate(item.x, item.y)
      gameCtx.scale(scale, scale)
      gameCtx.beginPath()
      gameCtx.fillStyle = 'rgba(255,255,255,0.14)'
      gameCtx.arc(0, 0, item.radius + 12, 0, Math.PI * 2)
      gameCtx.fill()
      gameCtx.font = `${item.radius * 1.45}px system-ui`
      gameCtx.textAlign = 'center'
      gameCtx.textBaseline = 'middle'
      gameCtx.fillText(item.emoji, 0, 2)
      gameCtx.restore()
    }
  }

  const maxParticles = performanceTier === 'high' ? 120 : performanceTier === 'medium' ? 72 : 40
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
    particle.vx *= 0.98
    particle.vy *= 0.98
    particle.vy += 380 * dt

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
    overlayCtx.fillStyle = `rgba(255,255,255,${Math.min(flashTimer / 140, 0.34)})`
    overlayCtx.fillRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height)
  }

  if (grabPoint.visible) {
    overlayCtx.save()
    overlayCtx.translate(grabPoint.x, grabPoint.y)
    overlayCtx.strokeStyle = gestureState === 'FIST_HOLD' ? '#ff7a18' : '#61dafb'
    overlayCtx.fillStyle = gestureState === 'FIST_HOLD' ? 'rgba(255,122,24,0.22)' : 'rgba(97,218,251,0.16)'
    overlayCtx.lineWidth = 3
    overlayCtx.beginPath()
    overlayCtx.arc(0, 0, gestureState === 'FIST_HOLD' ? 36 : 28, 0, Math.PI * 2)
    overlayCtx.fill()
    overlayCtx.stroke()

    if (ringTimer > 0) {
      const t = ringTimer / 120
      overlayCtx.beginPath()
      overlayCtx.strokeStyle = `rgba(255,255,255,${t * 0.6})`
      overlayCtx.lineWidth = 4 * t
      overlayCtx.arc(0, 0, 44 + (1 - t) * 34, 0, Math.PI * 2)
      overlayCtx.stroke()
    }

    overlayCtx.beginPath()
    overlayCtx.moveTo(-18, 0)
    overlayCtx.lineTo(18, 0)
    overlayCtx.moveTo(0, -18)
    overlayCtx.lineTo(0, 18)
    overlayCtx.stroke()
    overlayCtx.restore()
  }
}

function drawDebug() {
  if (!SHOW_DEBUG) return
  refs.debugText.textContent = [
    `runtime: ${runtimeState}`,
    `gestureState: ${gestureState}`,
    `fistScore: ${fistScoreSmoothed.toFixed(3)}`,
    `handPresent: ${handPresent}`,
    `objects: ${objects.filter((item) => !item.crushed).length}`,
    `particles: ${particles.length}`,
    `crushCount: ${crushCount}`,
    `combo: ${comboCount}`,
    `bestCombo: ${bestCombo}`,
    `timeLeft: ${(roundTimeLeftMs / 1000).toFixed(2)}`,
    `detectIntervalMs: ${detectIntervalMs}`,
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
    fistScoreSmoothed *= 0.85
    gestureState = 'OPEN'
    enterFrames = 0
    exitFrames = 0
    if (runtimeState === 'running') updateStatus('未检测到手势')
    return
  }

  const palm = getPalmCenter(landmarks)
  const point = normalizeToScreen(palm)
  grabPoint.x = point.x
  grabPoint.y = point.y
  grabPoint.visible = true

  const rawScore = computeFistScore(landmarks)
  fistScoreSmoothed =
    fistScoreSmoothed * (1 - config.smoothingAlpha) + rawScore * config.smoothingAlpha
  updateGestureState(fistScoreSmoothed)

  if (justStartedFist) {
    detectHit()
  }

  if (runtimeState === 'running') {
    updateStatus(
      gestureState === 'FIST_HOLD'
        ? '已握拳：抓爆中'
        : gestureState === 'CLOSING'
          ? '检测到握拳趋势'
          : '张手待命',
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

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持 getUserMedia')
  }

  updateStatus('请求相机权限...')
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'environment',
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  })

  refs.video.srcObject = stream
  await refs.video.play()
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
    updateHint('30 秒内尽量抓爆更多目标，保持节奏冲击更高连击。')
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

applyPerformanceTier(choosePerformanceTier())
feedbackIntensity = chooseFeedbackIntensity()
refs.feedbackText.textContent = feedbackIntensity
resizeCanvases()
ensureObjects(5)
updateScoreBoard()
updatePanel(
  '30 秒内，你能抓爆多少目标？',
  '点击开始后授权相机，把手掌移到目标上方，快速握拳。倒计时结束后会显示你的成绩。',
  getStartupMeta(),
  '开始挑战',
)
updateHint('这是移动端手势抓爆挑战试玩版。上线后请用 HTTPS 域名分享给手机用户。')
updateStatus('等待启动')
setRuntimeState('idle')
bindStartActions()
requestAnimationFrame(tick)
