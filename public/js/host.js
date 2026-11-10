/**
 * TURBO PARTY RACE — TV Host & 60 FPS HTML5 Canvas 2D Game Engine
 * Features: Catmull-Rom Neon-Asphalt Grand Prix Track, Mario Kart Drift + Sparks,
 * Mystery Boxes (Nitro, Oil Slick, Shockwave), AI Bots, Web Audio Synthesizer & Socket.IO Sync.
 */

import { soundEngine } from '/js/audio.js';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const TOTAL_LAPS = 3;
const TRACK_HALF_WIDTH = 78; // 156px total width for 8-car overtaking

const ITEM_META = {
  nitro: { icon: '🔥', label: 'Nitro' },
  oil: { icon: '🍌', label: 'Huile' },
  shockwave: { icon: '⚡', label: 'Onde' }
};

// Closed circuit control points (26 points around 1920x1080 with scenic layout)
// Start/Finish straight is at bottom-center heading RIGHT (clockwise loop)
const TRACK_CONTROL_POINTS = [
  { x: 760, y: 905 },
  { x: 960, y: 905 },  // Start/Finish line near here
  { x: 1180, y: 905 },
  { x: 1420, y: 895 },
  { x: 1630, y: 830 },
  { x: 1735, y: 690 },
  { x: 1715, y: 515 },
  { x: 1565, y: 425 },
  { x: 1370, y: 450 },
  { x: 1245, y: 365 },
  { x: 1320, y: 225 },
  { x: 1475, y: 155 },
  { x: 1360, y: 115 },
  { x: 1100, y: 130 },
  { x: 865, y: 210 },
  { x: 690, y: 150 },
  { x: 455, y: 140 },
  { x: 255, y: 215 },
  { x: 175, y: 375 },
  { x: 230, y: 535 },
  { x: 420, y: 590 },
  { x: 545, y: 675 },
  { x: 405, y: 785 },
  { x: 245, y: 855 },
  { x: 350, y: 925 },
  { x: 555, y: 912 }
];

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const canvas = document.getElementById('race-canvas');
const ctx = canvas.getContext('2d');

const lobbyView = document.getElementById('lobby-view');
const raceHud = document.getElementById('race-hud');
const podiumView = document.getElementById('podium-view');

const roomPillMini = document.getElementById('room-pill-mini');
const miniRoomCode = document.getElementById('mini-room-code');
const lobbyRoomCode = document.getElementById('lobby-room-code');
const qrContainer = document.getElementById('qr-container');
const joinUrlLink = document.getElementById('join-url-link');
const btnCopyUrl = document.getElementById('btn-copy-url');

const driverCountBadge = document.getElementById('driver-count-badge');
const driversGrid = document.getElementById('drivers-grid');
const lobbyStatusMsg = document.getElementById('lobby-status-msg');
const btnAddBot = document.getElementById('btn-add-bot');
const btnRemoveBot = document.getElementById('btn-remove-bot');
const btnStartRace = document.getElementById('btn-start-race');

const hudStandings = document.getElementById('hud-standings');
const killfeedContainer = document.getElementById('killfeed-container');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownText = document.getElementById('countdown-text');
const light1 = document.getElementById('light-1');
const light2 = document.getElementById('light-2');
const light3 = document.getElementById('light-3');

const podiumTop3 = document.getElementById('podium-top3');
const podiumStandingsList = document.getElementById('podium-standings-list');
const btnRestartRace = document.getElementById('btn-restart-race');
const btnBackLobby = document.getElementById('btn-back-lobby');

const btnMute = document.getElementById('btn-mute');
const muteIcon = document.getElementById('mute-icon');
const muteLabel = document.getElementById('mute-label');
const btnFullscreen = document.getElementById('btn-fullscreen');

// ============================================================================
// TRACK GEOMETRY & OFFSCREEN RENDERING
// ============================================================================

const trackWaypoints = [];
let totalTrackLength = 0;
const checkpointIndices = [0, 0, 0]; // 1/4, 2/4, 3/4 waypoint indices

// Offscreen canvases for static scenery and persistent tire skidmarks
const trackStaticCanvas = document.createElement('canvas');
trackStaticCanvas.width = CANVAS_W;
trackStaticCanvas.height = CANVAS_H;
const trackStaticCtx = trackStaticCanvas.getContext('2d');

const skidCanvas = document.createElement('canvas');
skidCanvas.width = CANVAS_W;
skidCanvas.height = CANVAS_H;
const skidCtx = skidCanvas.getContext('2d');

// Decorative elements around the circuit
const trees = [];
const spectators = [];
const tireBarriers = [];
let spectatorCheerTimer = 0;

/**
 * Evaluates a Catmull-Rom spline point between P1 and P2 with tension 0.5
 */
function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

/**
 * Generates ~320 uniform waypoints along the closed Catmull-Rom loop
 */
function buildTrackGeometry() {
  const rawPoints = [];
  const n = TRACK_CONTROL_POINTS.length;
  const samplesPerSegment = 28;

  for (let i = 0; i < n; i++) {
    const p0 = TRACK_CONTROL_POINTS[(i - 1 + n) % n];
    const p1 = TRACK_CONTROL_POINTS[i];
    const p2 = TRACK_CONTROL_POINTS[(i + 1) % n];
    const p3 = TRACK_CONTROL_POINTS[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      rawPoints.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }

  // Compute cumulative arc length
  const cumLengths = [0];
  let accum = 0;
  for (let i = 1; i <= rawPoints.length; i++) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i % rawPoints.length];
    accum += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    cumLengths.push(accum);
  }
  totalTrackLength = accum;

  // Resample into 320 equidistant waypoints
  const targetCount = 320;
  const stepDist = totalTrackLength / targetCount;
  trackWaypoints.length = 0;

  let rawIdx = 0;
  for (let i = 0; i < targetCount; i++) {
    const targetD = i * stepDist;
    while (rawIdx < cumLengths.length - 2 && cumLengths[rawIdx + 1] < targetD) {
      rawIdx++;
    }
    const segLen = cumLengths[rawIdx + 1] - cumLengths[rawIdx] || 1;
    const ratio = (targetD - cumLengths[rawIdx]) / segLen;
    const a = rawPoints[rawIdx];
    const b = rawPoints[(rawIdx + 1) % rawPoints.length];
    trackWaypoints.push({
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
      tx: 1,
      ty: 0,
      nx: 0,
      ny: 1,
      dist: targetD,
      curvature: 0
    });
  }

  // Compute tangents, normals, and curvature at each waypoint
  const wpCount = trackWaypoints.length;
  for (let i = 0; i < wpCount; i++) {
    const prev = trackWaypoints[(i - 1 + wpCount) % wpCount];
    const next = trackWaypoints[(i + 1) % wpCount];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const wp = trackWaypoints[i];
    wp.tx = dx / len;
    wp.ty = dy / len;
    wp.nx = -wp.ty;
    wp.ny = wp.tx;
  }

  for (let i = 0; i < wpCount; i++) {
    const prev = trackWaypoints[(i - 4 + wpCount) % wpCount];
    const next = trackWaypoints[(i + 4) % wpCount];
    const a1 = Math.atan2(prev.ty, prev.tx);
    const a2 = Math.atan2(next.ty, next.tx);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    trackWaypoints[i].curvature = diff;
  }

  // Set 3 invisible checkpoints at 1/4, 2/4, 3/4 of the circuit
  checkpointIndices[0] = Math.floor(wpCount * 0.25);
  checkpointIndices[1] = Math.floor(wpCount * 0.5);
  checkpointIndices[2] = Math.floor(wpCount * 0.75);

  generateDecorations();
  renderStaticTrack();
}

/**
 * Finds minimum distance from point (x, y) to any track waypoint
 */
function getDistanceToTrack(x, y) {
  let minSq = Infinity;
  let nearestIdx = 0;
  for (let i = 0; i < trackWaypoints.length; i++) {
    const wp = trackWaypoints[i];
    const dSq = (x - wp.x) * (x - wp.x) + (y - wp.y) * (y - wp.y);
    if (dSq < minSq) {
      minSq = dSq;
      nearestIdx = i;
    }
  }
  return { distance: Math.sqrt(minSq), index: nearestIdx, waypoint: trackWaypoints[nearestIdx] };
}

/**
 * Generates decorative trees, spectator stands and tire barriers outside the track
 */
function generateDecorations() {
  trees.length = 0;
  spectators.length = 0;
  tireBarriers.length = 0;

  // Spectators in two grandstands (bottom main straight & top-left hairpin)
  const standConfigs = [
    { startX: 780, startY: 1018, cols: 26, rows: 3, dx: 18, dy: 14, angle: 0 },
    { startX: 250, startY: 66, cols: 18, rows: 2, dx: 18, dy: 14, angle: 0 }
  ];
  const palette = ['#ff006e', '#00f5d4', '#ffbe0b', '#3a86ff', '#fb5607', '#ffffff', '#a855f7'];

  standConfigs.forEach((stand) => {
    for (let r = 0; r < stand.rows; r++) {
      for (let c = 0; c < stand.cols; c++) {
        spectators.push({
          x: stand.startX + c * stand.dx + (r % 2) * 6,
          y: stand.startY + r * stand.dy,
          color: palette[(r * 7 + c * 3) % palette.length],
          phase: Math.random() * Math.PI * 2
        });
      }
    }
  });

  // Tire barriers on tight outer corners
  for (let i = 0; i < trackWaypoints.length; i += 4) {
    const wp = trackWaypoints[i];
    if (Math.abs(wp.curvature) > 0.36) {
      const sign = wp.curvature > 0 ? -1 : 1;
      const bx = wp.x + wp.nx * sign * (TRACK_HALF_WIDTH + 18);
      const by = wp.y + wp.ny * sign * (TRACK_HALF_WIDTH + 18);
      if (bx > 30 && bx < CANVAS_W - 30 && by > 30 && by < CANVAS_H - 30) {
        tireBarriers.push({
          x: bx,
          y: by,
          color: (i / 4) % 2 === 0 ? '#ef4444' : '#f8fafc'
        });
      }
    }
  }

  // Stylized top-down trees placed safely away from the asphalt & lake
  const candidateTrees = [
    { x: 95, y: 120, r: 30 }, { x: 135, y: 165, r: 24 }, { x: 80, y: 690, r: 32 },
    { x: 120, y: 745, r: 25 }, { x: 1815, y: 160, r: 32 }, { x: 1840, y: 230, r: 26 },
    { x: 1845, y: 890, r: 34 }, { x: 1785, y: 945, r: 26 }, { x: 1580, y: 270, r: 26 },
    { x: 1030, y: 310, r: 28 }, { x: 980, y: 350, r: 22 }, { x: 560, y: 365, r: 30 },
    { x: 615, y: 400, r: 24 }, { x: 1120, y: 685, r: 28 }, { x: 1175, y: 715, r: 22 },
    { x: 1530, y: 635, r: 28 }, { x: 750, y: 720, r: 26 }, { x: 695, y: 740, r: 21 }
  ];

  candidateTrees.forEach((t) => {
    const { distance } = getDistanceToTrack(t.x, t.y);
    if (distance > TRACK_HALF_WIDTH + 48) {
      trees.push(t);
    }
  });
}

/**
 * Pre-renders the high-detail Grand Prix circuit onto trackStaticCanvas
 */
function renderStaticTrack() {
  const c = trackStaticCtx;
  c.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // 1. Rich Lawn with alternating mowing stripes
  c.fillStyle = '#0f291e';
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const stripeW = 64;
  c.fillStyle = '#133325';
  for (let x = -CANVAS_H; x < CANVAS_W + CANVAS_H; x += stripeW * 2) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + stripeW, 0);
    c.lineTo(x + stripeW - CANVAS_H * 0.35, CANVAS_H);
    c.lineTo(x - CANVAS_H * 0.35, CANVAS_H);
    c.closePath();
    c.fill();
  }

  // 2. Scenic Infield Lake (around x: 830, y: 540)
  c.save();
  c.beginPath();
  c.ellipse(835, 555, 175, 95, -0.12, 0, Math.PI * 2);
  c.fillStyle = '#eab30833'; // Sandy shore halo
  c.lineWidth = 18;
  c.strokeStyle = 'rgba(217, 179, 108, 0.38)';
  c.stroke();
  const lakeGrad = c.createRadialGradient(815, 540, 20, 835, 555, 180);
  lakeGrad.addColorStop(0, '#0ea5e9');
  lakeGrad.addColorStop(0.7, '#0284c7');
  lakeGrad.addColorStop(1, '#0369a1');
  c.fillStyle = lakeGrad;
  c.fill();
  c.restore();

  // Helper to trace the closed centerline path
  const traceCenterPath = () => {
    c.beginPath();
    trackWaypoints.forEach((wp, idx) => {
      if (idx === 0) c.moveTo(wp.x, wp.y);
      else c.lineTo(wp.x, wp.y);
    });
    c.closePath();
  };

  c.lineJoin = 'round';
  c.lineCap = 'round';

  // 3. Outer dark shadow & grass verge
  traceCenterPath();
  c.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  c.lineWidth = TRACK_HALF_WIDTH * 2 + 34;
  c.stroke();

  // 4. Red & White Curbs (Vibreurs) along the track edges
  for (let i = 0; i < trackWaypoints.length; i++) {
    const wp1 = trackWaypoints[i];
    const wp2 = trackWaypoints[(i + 1) % trackWaypoints.length];
    c.beginPath();
    c.moveTo(wp1.x, wp1.y);
    c.lineTo(wp2.x, wp2.y);
    c.strokeStyle = Math.floor(i / 2) % 2 === 0 ? '#ef4444' : '#f8fafc';
    c.lineWidth = TRACK_HALF_WIDTH * 2 + 18;
    c.stroke();
  }

  // 5. Main Anthracite Asphalt Surface
  traceCenterPath();
  c.strokeStyle = '#1e2430';
  c.lineWidth = TRACK_HALF_WIDTH * 2;
  c.stroke();

  // Subtle lighter inner racing groove
  traceCenterPath();
  c.strokeStyle = '#252c3a';
  c.lineWidth = TRACK_HALF_WIDTH * 1.45;
  c.stroke();

  // Neon cyan inner/outer subtle edge glow lines for Arcade TV vibe
  traceCenterPath();
  c.strokeStyle = 'rgba(0, 245, 212, 0.12)';
  c.lineWidth = TRACK_HALF_WIDTH * 2 - 4;
  c.stroke();

  // 6. Dashed Center Line
  c.save();
  traceCenterPath();
  c.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  c.lineWidth = 3;
  c.setLineDash([18, 22]);
  c.stroke();
  c.restore();

  // 7. Starting Grid Boxes (8 staggered slots behind waypoint 0)
  const totalWp = trackWaypoints.length;
  for (let slot = 0; slot < 8; slot++) {
    const wpIndex = (totalWp - 6 - slot * 3 + totalWp) % totalWp;
    const wp = trackWaypoints[wpIndex];
    const lateralOffset = (slot % 2 === 0 ? -1 : 1) * 32;
    const gx = wp.x + wp.nx * lateralOffset;
    const gy = wp.y + wp.ny * lateralOffset;
    const angle = Math.atan2(wp.ty, wp.tx);

    c.save();
    c.translate(gx, gy);
    c.rotate(angle);
    c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(18, -14);
    c.lineTo(24, -14);
    c.lineTo(24, 14);
    c.lineTo(18, 14);
    c.stroke();
    c.restore();
  }

  // 8. Checkered Start / Finish Line at Waypoint 0
  const startWp = trackWaypoints[0];
  const startAngle = Math.atan2(startWp.ty, startWp.tx);
  c.save();
  c.translate(startWp.x, startWp.y);
  c.rotate(startAngle);
  const rows = 12;
  const cols = 3;
  const cellH = (TRACK_HALF_WIDTH * 2) / rows;
  const cellW = 10;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      c.fillStyle = (r + col) % 2 === 0 ? '#ffffff' : '#090d16';
      c.fillRect(- (cols * cellW) / 2 + col * cellW, -TRACK_HALF_WIDTH + r * cellH, cellW, cellH + 0.5);
    }
  }
  // Neon arch banner over finish line
  c.fillStyle = 'rgba(255, 190, 11, 0.9)';
  c.fillRect(-6, -TRACK_HALF_WIDTH - 14, 12, 14);
  c.fillRect(-6, TRACK_HALF_WIDTH, 12, 14);
  c.restore();

  // 9. Grandstand Roofs / Structures
  c.save();
  c.fillStyle = '#0f172a';
  c.strokeStyle = '#334155';
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(760, 998, 495, 62, 10);
  c.fill();
  c.stroke();

  c.beginPath();
  c.roundRect(230, 48, 350, 46, 10);
  c.fill();
  c.stroke();
  c.restore();

  // 10. Tire barriers at tight curves
  tireBarriers.forEach((tb) => {
    c.save();
    c.beginPath();
    c.arc(tb.x, tb.y, 8, 0, Math.PI * 2);
    c.fillStyle = tb.color;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#0f172a';
    c.stroke();
    c.restore();
  });

  // 11. Top-down stylized trees
  trees.forEach((t) => {
    c.save();
    // Drop shadow
    c.beginPath();
    c.arc(t.x + 8, t.y + 8, t.r, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0, 0, 0, 0.38)';
    c.fill();
    // Outer foliage
    c.beginPath();
    c.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    c.fillStyle = '#15803d';
    c.fill();
    // Inner highlight
    c.beginPath();
    c.arc(t.x - t.r * 0.22, t.y - t.r * 0.22, t.r * 0.65, 0, Math.PI * 2);
    c.fillStyle = '#22c55e';
    c.fill();
    c.restore();
  });
}

function clearSkidmarks() {
  skidCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
}

// ============================================================================
// GAME STATE & ENTITIES
// ============================================================================

let roomCode = sessionStorage.getItem('hostRoomCode') || '';
let roomStatus = 'lobby'; // 'lobby' | 'countdown' | 'racing' | 'finished'
let playersList = [];     // Synced from server room:state

// Map of car physics states keyed by player.id
const carsMap = new Map();

// Demo cars that drive around in the background when lobby has 0 players
const demoCars = [];

// 6 Mystery Boxes placed along the circuit
const mysteryBoxes = [];
const MYSTERY_BOX_WP_FRACTIONS = [0.14, 0.31, 0.46, 0.62, 0.78, 0.91];

// Active Oil Slicks / Banana Hazards on track
const oilSlicks = [];

// Active Shockwave visual rings
const shockwaveRings = [];

// Particle system (sparks, nitro flames, grass dirt, smoke, confetti)
const particles = [];
const confettiParticles = [];

// Screen shake intensity
let screenShake = 0;

// Race timing
let raceStartTime = 0;
let countdownTimer = 0;
let lastCountdownStep = -1;
let lastTelemetrySync = 0;

// Local PC keyboard input state (for quick testing on host screen)
const keyboardInput = {
  left: false,
  right: false,
  accel: false,
  drift: false
};

/**
 * Initializes the 6 Mystery Boxes on the track
 */
function initMysteryBoxes() {
  mysteryBoxes.length = 0;
  const wpCount = trackWaypoints.length;
  MYSTERY_BOX_WP_FRACTIONS.forEach((frac, idx) => {
    const wpIdx = Math.floor(wpCount * frac) % wpCount;
    const wp = trackWaypoints[wpIdx];
    const lateral = (idx % 2 === 0 ? -1 : 1) * 26;
    mysteryBoxes.push({
      id: idx,
      x: wp.x + wp.nx * lateral,
      y: wp.y + wp.ny * lateral,
      respawnTimer: 0, // 0 = active
      spinPhase: idx * 1.1
    });
  });
}

/**
 * Creates a fresh physics car object placed on its starting grid slot
 */
function createCarEntity(playerInfo, gridSlotIndex = 0) {
  const totalWp = trackWaypoints.length;
  const slot = Math.max(0, Math.min(7, gridSlotIndex));
  const wpIndex = (totalWp - 6 - slot * 3 + totalWp) % totalWp;
  const wp = trackWaypoints[wpIndex];
  const lateralOffset = (slot % 2 === 0 ? -1 : 1) * 32;
  const startX = wp.x + wp.nx * lateralOffset;
  const startY = wp.y + wp.ny * lateralOffset;
  const startAngle = Math.atan2(wp.ty, wp.tx);

  return {
    id: playerInfo.id,
    name: playerInfo.name,
    color: playerInfo.color || '#00E5FF',
    slotIndex: slot,
    isBot: Boolean(playerInfo.isBot),
    isCreator: Boolean(playerInfo.isCreator),
    connected: playerInfo.connected !== false,

    // Position & Kinematics
    x: startX,
    y: startY,
    prevX: startX,
    prevY: startY,
    vx: 0,
    vy: 0,
    speed: 0,
    angle: startAngle,
    driftAngle: 0,

    // Drift & Boosts
    isDrifting: false,
    driftDir: 0,
    driftCharge: 0, // seconds
    driftLevel: 0,  // 0 = none, 1 = blue sparks (>=0.6s), 2 = orange sparks (>=1.3s)
    boostTimer: 0,  // mini-boost duration
    nitroTimer: 0,  // full nitro duration (1.5s)
    spinoutTimer: 0,
    spinoutAngle: 0,

    // Track Progression & Laps
    currentWpIndex: wpIndex,
    checkpointMask: 0, // bit 1 (1/4), bit 2 (2/4), bit 4 (3/4) => 7 = all 3 passed
    completedLaps: 0,
    lap: 1,
    position: slot + 1,
    progressScore: -slot,
    finished: false,
    finishTimeMs: 0,

    // Items & AI
    item: null,
    botItemDelay: 0,
    botLaneOffset: (Math.random() - 0.5) * 44,
    honkVisualTimer: 0,

    // Controller input
    input: { left: false, right: false, accel: false, drift: false }
  };
}

/**
 * Resets all cars to the starting grid for a new race
 */
function resetCarsOnStartingGrid() {
  clearSkidmarks();
  oilSlicks.length = 0;
  shockwaveRings.length = 0;
  particles.length = 0;
  confettiParticles.length = 0;
  initMysteryBoxes();

  const existingIds = new Set();
  playersList.forEach((p, idx) => {
    const slot = typeof p.slotIndex === 'number' ? p.slotIndex : idx;
    const car = createCarEntity(p, slot);
    carsMap.set(p.id, car);
    existingIds.add(p.id);
  });

  for (const id of carsMap.keys()) {
    if (!existingIds.has(id)) carsMap.delete(id);
  }
}

/**
 * Initializes 4 autonomous demo cars for the background when lobby is empty
 */
function initDemoCars() {
  demoCars.length = 0;
  const demoColors = ['#FF3366', '#00E5FF', '#FFD600', '#00E676'];
  const demoNames = ['Turbo', 'Neon', 'Apex', 'Vortex'];
  for (let i = 0; i < 4; i++) {
    const c = createCarEntity(
      { id: `demo-${i}`, name: demoNames[i], color: demoColors[i], isBot: true },
      i * 2
    );
    c.currentWpIndex = (i * 75) % trackWaypoints.length;
    const wp = trackWaypoints[c.currentWpIndex];
    c.x = wp.x;
    c.y = wp.y;
    c.angle = Math.atan2(wp.ty, wp.tx);
    demoCars.push(c);
  }
}

// ============================================================================
// UI HELPERS (SVG Car Preview, Killfeed, Standings, QR Code)
// ============================================================================

function generateCarSvg(color = '#00E5FF') {
  return `
    <svg viewBox="0 0 120 66" xmlns="http://www.w3.org/2000/svg">
      <!-- Wheels -->
      <rect x="18" y="4" width="24" height="11" rx="4" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
      <rect x="78" y="4" width="24" height="11" rx="4" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
      <rect x="18" y="51" width="24" height="11" rx="4" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
      <rect x="78" y="51" width="24" height="11" rx="4" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
      <!-- Rear Spoiler -->
      <rect x="6" y="12" width="10" height="42" rx="3" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Main Body -->
      <path d="M16 14 L92 14 Q112 18 112 33 Q112 48 92 52 L16 52 Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <!-- Racing Stripes -->
      <rect x="22" y="29" width="84" height="8" rx="3" fill="rgba(255,255,255,0.85)"/>
      <!-- Cockpit Canopy -->
      <rect x="44" y="20" width="34" height="26" rx="8" fill="#0f172a" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
      <!-- Driver Helmet -->
      <circle cx="58" cy="33" r="8" fill="#ffffff"/>
      <path d="M59 27 A6 6 0 0 1 65 33 A6 6 0 0 1 59 39 Z" fill="#0284c7"/>
    </svg>
  `;
}

function pushKillfeed(text, borderColor = '#00f5d4') {
  if (!killfeedContainer) return;
  const toast = document.createElement('div');
  toast.className = 'killfeed-toast';
  toast.style.borderColor = borderColor;
  toast.textContent = text;
  killfeedContainer.prepend(toast);

  while (killfeedContainer.children.length > 3) {
    killfeedContainer.lastElementChild.remove();
  }

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}

/**
 * Fetches QR code from /api/qr and updates the Lobby Join card
 */
async function updateRoomLinksAndQr(code) {
  if (!code) return;
  const joinUrl = `${window.location.origin}/play?room=${encodeURIComponent(code)}`;

  lobbyRoomCode.textContent = code;
  miniRoomCode.textContent = code;
  joinUrlLink.href = joinUrl;
  joinUrlLink.textContent = joinUrl;

  try {
    const res = await fetch(`/api/qr?url=${encodeURIComponent(joinUrl)}`);
    const data = await res.json();
    if (data && data.dataUrl) {
      qrContainer.innerHTML = `<img src="${data.dataUrl}" alt="QR Code Salon ${code}" />`;
    } else if (data && data.svg) {
      qrContainer.innerHTML = data.svg;
    }
  } catch (_) {
    qrContainer.innerHTML = `<div class="qr-loading">Code Salon : <strong>${code}</strong></div>`;
  }
}

/**
 * Renders the 8 driver slots in the Lobby view
 */
function renderLobbyGrid() {
  const count = playersList.length;
  driverCountBadge.textContent = `${count} / 8`;

  const hasBots = playersList.some((p) => p.isBot);
  btnAddBot.disabled = count >= 8;
  btnRemoveBot.disabled = !hasBots;
  btnStartRace.disabled = count < 1;

  if (count === 0) {
    lobbyStatusMsg.textContent =
      "Scannez le QR Code sur votre téléphone ou ajoutez un Bot IA pour lancer la course !";
  } else {
    const creator = playersList.find((p) => p.isCreator && !p.isBot);
    lobbyStatusMsg.textContent = creator
      ? `Prêt à partir ! ${creator.name} (👑 Hôte) peut aussi lancer depuis son téléphone.`
      : `${count} pilote${count > 1 ? 's' : ''} sur la grille de départ !`;
  }

  driversGrid.innerHTML = '';
  for (let slotIdx = 0; slotIdx < 8; slotIdx++) {
    const player =
      playersList.find((p) => p.slotIndex === slotIdx) || playersList[slotIdx] || null;
    const slotEl = document.createElement('div');
    slotEl.className = `driver-slot ${player ? 'occupied' : ''}`;
    slotEl.dataset.slotIndex = String(slotIdx);

    if (player) {
      slotEl.dataset.playerId = player.id;
      slotEl.style.setProperty('--slot-color', player.color);

      const badgesHtml = [];
      if (player.isCreator && !player.isBot) {
        badgesHtml.push(`<span class="slot-badge badge-host">👑 HÔTE</span>`);
      }
      if (player.isBot) {
        badgesHtml.push(`<span class="slot-badge badge-bot">🤖 BOT IA</span>`);
      }
      if (!player.isBot && player.connected === false) {
        badgesHtml.push(`<span class="slot-badge badge-net">📡 4G...</span>`);
      }

      slotEl.innerHTML = `
        <div class="slot-top-row">
          <span class="slot-number">P${slotIdx + 1}</span>
          <div class="slot-badges">${badgesHtml.join('')}</div>
        </div>
        <div class="slot-car-preview">
          ${generateCarSvg(player.color)}
        </div>
        <div class="slot-driver-name">${escapeHtml(player.name)}</div>
      `;
    } else {
      slotEl.innerHTML = `
        <div class="slot-top-row">
          <span class="slot-number">P${slotIdx + 1}</span>
        </div>
        <div class="slot-car-preview" style="opacity:0.18">
          ${generateCarSvg('#64748b')}
        </div>
        <div class="slot-empty-text">Emplacement libre</div>
      `;
    }

    driversGrid.appendChild(slotEl);
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Triggers a visual bounce + "BIP-BIP!" bubble + horn sound when a player honks
 */
function triggerPlayerHonkVisual(playerId) {
  const player = playersList.find((p) => p.id === playerId);
  const slotPitch = player ? 0.88 + (player.slotIndex % 8) * 0.06 : 1.0;
  soundEngine.playHonk(slotPitch);

  const car = carsMap.get(playerId);
  if (car) {
    car.honkVisualTimer = 0.65;
  }

  const slotEl = driversGrid.querySelector(`.driver-slot[data-player-id="${playerId}"]`);
  if (slotEl) {
    slotEl.classList.remove('honking');
    void slotEl.offsetWidth;
    slotEl.classList.add('honking');

    const preview = slotEl.querySelector('.slot-car-preview');
    if (preview) {
      const oldBubble = preview.querySelector('.honk-bubble');
      if (oldBubble) oldBubble.remove();
      const bubble = document.createElement('div');
      bubble.className = 'honk-bubble';
      bubble.textContent = '📯 BIP-BIP !';
      preview.appendChild(bubble);
      setTimeout(() => bubble.remove(), 750);
    }
  }
}

/**
 * Updates the live Race HUD Standings Bar
 */
function renderHudStandings() {
  const sortedCars = Array.from(carsMap.values()).sort((a, b) => a.position - b.position);
  hudStandings.innerHTML = sortedCars
    .map((c) => {
      const rankLabel = c.position === 1 ? '1er' : `${c.position}e`;
      const lapDisplay = c.finished
        ? '🏁 FINI'
        : `Tour ${Math.min(TOTAL_LAPS, c.lap)}/${TOTAL_LAPS}`;
      const itemIcon = c.item && ITEM_META[c.item] ? ITEM_META[c.item].icon : '·';
      const netWarn = !c.isBot && !c.connected ? ' 📡' : '';

      return `
        <div class="hud-driver-pill" style="--driver-color: ${c.color}">
          <span class="hud-pos-badge">${rankLabel}</span>
          <div class="hud-driver-info">
            <span class="hud-driver-name">${escapeHtml(c.name)}${netWarn}</span>
            <span class="hud-driver-lap">${lapDisplay}</span>
          </div>
          <div class="hud-driver-item">${itemIcon}</div>
        </div>
      `;
    })
    .join('');
}

/**
 * Renders the Podium View at the end of the race
 */
function showPodiumView(sortedCars) {
  lobbyView.classList.add('hidden');
  raceHud.classList.add('hidden');
  podiumView.classList.remove('hidden');
  roomPillMini.classList.remove('hidden');

  // Top 3 Pillars in visual order: 2nd, 1st, 3rd
  const visualOrder = [sortedCars[1], sortedCars[0], sortedCars[2]].filter(Boolean);
  podiumTop3.innerHTML = visualOrder
    .map((car) => {
      const rank = car.position;
      const medal = rank === 1 ? '🥇 1er' : rank === 2 ? '🥈 2e' : '🥉 3e';
      const timeStr = formatRaceTime(car.finishTimeMs);
      return `
        <div class="podium-pillar">
          <div class="slot-car-preview">${generateCarSvg(car.color)}</div>
          <div class="podium-driver-badge">
            <div class="podium-name">${escapeHtml(car.name)}</div>
            <div class="podium-time">${timeStr}</div>
          </div>
          <div class="podium-step rank-${rank}">${medal}</div>
        </div>
      `;
    })
    .join('');

  // Full 1..8 Standings List
  podiumStandingsList.innerHTML = sortedCars
    .map((car) => {
      const rankLabel = car.position === 1 ? '1er' : `${car.position}ème`;
      return `
        <div class="podium-row" style="--row-color: ${car.color}">
          <div class="podium-row-left">
            <span class="podium-row-rank">${rankLabel}</span>
            <span class="podium-row-name">${escapeHtml(car.name)}</span>
          </div>
          <span class="podium-row-time">${formatRaceTime(car.finishTimeMs)}</span>
        </div>
      `;
    })
    .join('');

  // Spawn celebratory confetti
  confettiParticles.length = 0;
  const colors = ['#ff006e', '#00f5d4', '#ffbe0b', '#3a86ff', '#00e676', '#ffffff'];
  for (let i = 0; i < 110; i++) {
    confettiParticles.push({
      x: Math.random() * CANVAS_W,
      y: -Math.random() * CANVAS_H,
      vx: (Math.random() - 0.5) * 2.5,
      vy: 2.2 + Math.random() * 3.5,
      size: 7 + Math.random() * 7,
      color: colors[i % colors.length],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.14
    });
  }
}

function formatRaceTime(ms) {
  if (!ms || ms <= 0) return '--:--.--';
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(
    hundredths
  ).padStart(2, '0')}`;
}

// ============================================================================
// BONUS ITEMS & COMBAT MECHANICS (NITRO, OIL SLICK, SHOCKWAVE)
// ============================================================================

function rollMysteryItem(carPosition, totalCars) {
  const r = Math.random();
  if (carPosition === 1 && totalCars > 1) {
    // Leader gets defensive oil or nitro
    if (r < 0.52) return 'oil';
    if (r < 0.88) return 'nitro';
    return 'shockwave';
  } else if (carPosition >= Math.ceil(totalCars * 0.6)) {
    // Chasers get high chance of Nitro or Shockwave
    if (r < 0.52) return 'nitro';
    if (r < 0.88) return 'shockwave';
    return 'oil';
  }
  if (r < 0.4) return 'nitro';
  if (r < 0.72) return 'oil';
  return 'shockwave';
}

function activateCarItem(car) {
  if (!car || !car.item || car.finished || roomStatus !== 'racing') return;

  const usedItem = car.item;
  car.item = null;

  if (usedItem === 'nitro') {
    car.nitroTimer = 1.5; // 1.5s brutal acceleration & off-road immunity
    car.speed = Math.max(car.speed, 9.8);
    soundEngine.playNitro(1.15);
    pushKillfeed(`🔥 ${car.name} active la NITRO !`, car.color);
    emitHaptic(car.id, 'nitro', [45, 25, 70]);
  } else if (usedItem === 'oil') {
    // Drop oil slick / banana behind the car
    const dropDist = 42;
    oilSlicks.push({
      x: car.x - Math.cos(car.angle) * dropDist,
      y: car.y - Math.sin(car.angle) * dropDist,
      ownerId: car.id,
      graceTimer: 0.45,
      radius: 23,
      createdAt: performance.now()
    });
    soundEngine.playHonk(0.75);
    pushKillfeed(`🍌 ${car.name} largue une flaque d'huile !`, '#eab308');
  } else if (usedItem === 'shockwave') {
    const blastRadius = 240;
    shockwaveRings.push({
      x: car.x,
      y: car.y,
      radius: 24,
      maxRadius: blastRadius,
      alpha: 1.0,
      color: car.color
    });
    soundEngine.playShockwave();
    screenShake = Math.max(screenShake, 14);
    pushKillfeed(`⚡ ${car.name} déclenche une ONDE DE CHOC !`, '#00f5d4');
    emitHaptic(car.id, 'shockwave', [60, 30, 90]);

    // Violently knock back all rival cars within 240px
    for (const other of carsMap.values()) {
      if (other.id === car.id || other.finished) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const dist = Math.hypot(dx, dy);
      if (dist < blastRadius && dist > 0.001) {
        const force = (1 - dist / blastRadius) * 14.5 + 5.5;
        const nx = dx / dist;
        const ny = dy / dist;
        other.vx += nx * force;
        other.vy += ny * force;
        other.speed *= 0.45;
        other.spinoutTimer = Math.max(other.spinoutTimer, 0.45);
        spawnImpactSparks(other.x, other.y, '#00f5d4', 18);
        emitHaptic(other.id, 'shockwave_hit', [90, 40, 120]);
      }
    }
  }

  syncTelemetryNow();
}

function spawnImpactSparks(x, y, color = '#ffbe0b', count = 14) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 6.5;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      size: 2.5 + Math.random() * 3.5,
      color,
      alpha: 1,
      decay: 0.035 + Math.random() * 0.025
    });
  }
}

// ============================================================================
// AI BOT CONTROLLER
// ============================================================================

function updateBotAI(car, dtSec) {
  const wpCount = trackWaypoints.length;
  const lookAheadIdx = (car.currentWpIndex + 10) % wpCount;
  const farAheadIdx = (car.currentWpIndex + 18) % wpCount;
  const targetWp = trackWaypoints[lookAheadIdx];
  const farWp = trackWaypoints[farAheadIdx];

  let aimX = targetWp.x + targetWp.nx * car.botLaneOffset;
  let aimY = targetWp.y + targetWp.ny * car.botLaneOffset;

  // Dodge nearby oil slicks
  for (const slick of oilSlicks) {
    const d = Math.hypot(slick.x - car.x, slick.y - car.y);
    if (d < 150) {
      aimX += targetWp.nx * 46;
      aimY += targetWp.ny * 46;
      break;
    }
  }

  const desiredAngle = Math.atan2(aimY - car.y, aimX - car.x);
  let angleDiff = desiredAngle - car.angle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  car.input.accel = true;
  car.input.left = angleDiff < -0.085;
  car.input.right = angleDiff > 0.085;

  // Drift in sharp turns when moving fast
  const sharpTurn = Math.abs(farWp.curvature) > 0.32 || Math.abs(angleDiff) > 0.42;
  car.input.drift = sharpTurn && car.speed > 5.5;

  // Release drift once orange or blue sparks are charged and corner opens up
  if (car.driftLevel >= 1 && Math.abs(angleDiff) < 0.22) {
    car.input.drift = false;
  }

  // Automatic item usage after 1..3 seconds delay
  if (car.item && roomStatus === 'racing') {
    car.botItemDelay -= dtSec;
    if (car.botItemDelay <= 0) {
      activateCarItem(car);
    }
  }
}

// ============================================================================
// PHYSICS ENGINE (60 FPS Normalized, Drift Sparks, Off-Road, Checkpoints)
// ============================================================================

function updateSingleCarPhysics(car, dtNorm, dtSec, isInteractiveRace) {
  car.prevX = car.x;
  car.prevY = car.y;

  if (car.honkVisualTimer > 0) {
    car.honkVisualTimer = Math.max(0, car.honkVisualTimer - dtSec);
  }

  // Check distance to track for off-road grass penalty and waypoint progression
  const trackInfo = getDistanceToTrack(car.x, car.y);
  car.currentWpIndex = trackInfo.index;
  const isOnGrass = trackInfo.distance > TRACK_HALF_WIDTH;

  // Checkpoint & Lap validation
  if (isInteractiveRace && !car.finished) {
    updateCarCheckpointsAndLap(car, trackInfo.index);
  }

  // If car has finished the race, let AI cruise gently around the track
  if (car.isBot || car.finished || !isInteractiveRace) {
    updateBotAI(car, dtSec);
  }

  const input = { ...car.input };

  // Allow host keyboard override on the 1st human car (or 1st car if solo with bots)
  if (
    isInteractiveRace &&
    !car.finished &&
    (keyboardInput.left || keyboardInput.right || keyboardInput.accel || keyboardInput.drift)
  ) {
    const firstHuman = playersList.find((p) => !p.isBot) || playersList[0];
    if (firstHuman && firstHuman.id === car.id) {
      input.left = input.left || keyboardInput.left;
      input.right = input.right || keyboardInput.right;
      input.accel = input.accel || keyboardInput.accel;
      input.drift = input.drift || keyboardInput.drift;
    }
  }

  // Timers countdown
  if (car.nitroTimer > 0) car.nitroTimer = Math.max(0, car.nitroTimer - dtSec);
  if (car.boostTimer > 0) car.boostTimer = Math.max(0, car.boostTimer - dtSec);

  // Spinout state (Oil Slick hit)
  if (car.spinoutTimer > 0) {
    car.spinoutTimer = Math.max(0, car.spinoutTimer - dtSec);
    car.spinoutAngle += 0.36 * dtNorm;
    car.speed *= Math.pow(0.93, dtNorm);
    car.vx *= Math.pow(0.93, dtNorm);
    car.vy *= Math.pow(0.93, dtNorm);
    car.x += car.vx * dtNorm;
    car.y += car.vy * dtNorm;
    drawTireSkid(car, 0.35);
    return;
  } else {
    car.spinoutAngle = 0;
  }

  // Determine top speed & acceleration
  const baseMaxSpeed = car.isBot ? 7.65 : 7.85;
  let maxSpeed = baseMaxSpeed;

  if (car.nitroTimer > 0) {
    maxSpeed = 11.4; // Brutal Nitro boost + ignores grass
  } else if (car.boostTimer > 0) {
    maxSpeed = 9.7;  // Drift Mini-Boost
  } else if (isOnGrass) {
    maxSpeed = baseMaxSpeed * 0.55; // -45% speed in grass
  }

  // Acceleration / Braking / Reverse
  const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (input.accel || car.nitroTimer > 0 || car.boostTimer > 0) {
    const accelRate = car.nitroTimer > 0 ? 0.42 : car.boostTimer > 0 ? 0.32 : 0.19;
    car.speed += accelRate * dtNorm;
  } else if (input.drift && Math.abs(steerInput) === 0 && car.speed < 2.2) {
    // Holding brake/drift at low speed without turning reverses slowly to unstick
    car.speed = Math.max(-2.6, car.speed - 0.14 * dtNorm);
  } else {
    car.speed *= Math.pow(0.965, dtNorm);
  }

  if (car.speed > maxSpeed) {
    car.speed = maxSpeed + (car.speed - maxSpeed) * Math.pow(0.88, dtNorm);
  }

  // Mario Kart Drift Mechanics
  const canDrift = input.drift && car.speed > 3.8 && (steerInput !== 0 || car.isDrifting);

  if (canDrift) {
    if (!car.isDrifting) {
      car.isDrifting = true;
      car.driftDir = steerInput !== 0 ? steerInput : 1;
      car.driftCharge = 0;
      car.driftLevel = 0;
    }
    car.driftCharge += dtSec;
    if (car.driftCharge >= 1.3) {
      car.driftLevel = 2; // Orange/Golden sparks
    } else if (car.driftCharge >= 0.6) {
      car.driftLevel = 1; // Blue sparks
    }

    // Pronounced slip angle & responsive cornering during drift
    const targetSlip = car.driftDir * 0.36;
    car.driftAngle += (targetSlip - car.driftAngle) * 0.18 * dtNorm;
    const driftTurnRate = (0.048 * car.driftDir + steerInput * 0.024) * dtNorm;
    car.angle += driftTurnRate;

    // Persistent tire marks on asphalt + drift sparks under rear wheels
    drawTireSkid(car, 0.28);
    spawnDriftSparks(car);
  } else {
    // Check if releasing a charged drift -> Trigger Mini-Boost!
    if (car.isDrifting && car.driftLevel >= 1) {
      const boostDur = car.driftLevel === 2 ? 1.1 : 0.65;
      car.boostTimer = Math.max(car.boostTimer, boostDur);
      car.speed = Math.max(car.speed, car.driftLevel === 2 ? 9.8 : 9.0);
      soundEngine.playNitro(car.driftLevel === 2 ? 1.0 : 0.75);
      emitHaptic(car.id, 'drift_boost', [35, 20, 50]);
    }
    car.isDrifting = false;
    car.driftCharge = 0;
    car.driftLevel = 0;
    car.driftAngle *= Math.pow(0.8, dtNorm);

    // Normal steering
    if (Math.abs(car.speed) > 0.15) {
      const dirSign = car.speed >= 0 ? 1 : -1;
      const turnRate = 0.056 * steerInput * dirSign * Math.min(1, Math.abs(car.speed) / 3.2);
      car.angle += turnRate * dtNorm;
    }
  }

  // Lateral inertia blending (velocity vector blends toward facing angle)
  const forwardVx = Math.cos(car.angle) * car.speed;
  const forwardVy = Math.sin(car.angle) * car.speed;
  const grip = car.isDrifting ? 0.14 : isOnGrass ? 0.18 : 0.28;
  car.vx += (forwardVx - car.vx) * grip * dtNorm;
  car.vy += (forwardVy - car.vy) * grip * dtNorm;

  car.x += car.vx * dtNorm;
  car.y += car.vy * dtNorm;

  // Keep inside canvas bounds with bounce
  const margin = 28;
  if (car.x < margin) { car.x = margin; car.vx = Math.abs(car.vx) * 0.6; }
  if (car.x > CANVAS_W - margin) { car.x = CANVAS_W - margin; car.vx = -Math.abs(car.vx) * 0.6; }
  if (car.y < margin) { car.y = margin; car.vy = Math.abs(car.vy) * 0.6; }
  if (car.y > CANVAS_H - margin) { car.y = CANVAS_H - margin; car.vy = -Math.abs(car.vy) * 0.6; }

  // Emit grass/dirt particles when off-road without Nitro
  if (isOnGrass && car.nitroTimer <= 0 && Math.abs(car.speed) > 2.2 && Math.random() < 0.55) {
    spawnWheelParticles(car, Math.random() < 0.5 ? '#15803d' : '#78350f', 3.5);
  }

  // Emit Nitro or Mini-Boost exhaust flames
  if (car.nitroTimer > 0 || car.boostTimer > 0) {
    spawnExhaustFlames(car, car.nitroTimer > 0 ? 'nitro' : 'miniboost');
  }
}

/**
 * Validates the 3 invisible checkpoints (1/4, 2/4, 3/4) in order before validating a lap
 */
function updateCarCheckpointsAndLap(car, wpIdx) {
  const wpCount = trackWaypoints.length;
  const distToCp = (idx) => {
    const d = Math.abs(wpIdx - idx);
    return Math.min(d, wpCount - d);
  };

  // Checkpoint 1 (1/4 track)
  if (distToCp(checkpointIndices[0]) < 16) {
    car.checkpointMask |= 1;
  }
  // Checkpoint 2 (2/4 track) - requires CP1
  if ((car.checkpointMask & 1) && distToCp(checkpointIndices[1]) < 16) {
    car.checkpointMask |= 2;
  }
  // Checkpoint 3 (3/4 track) - requires CP1 & CP2
  if ((car.checkpointMask & 3) === 3 && distToCp(checkpointIndices[2]) < 16) {
    car.checkpointMask |= 4;
  }

  // Crossing Finish Line (around waypoint 0..12) with all 3 checkpoints validated (mask === 7)
  if (car.checkpointMask === 7 && wpIdx >= 0 && wpIdx <= 14) {
    car.checkpointMask = 0;
    car.completedLaps += 1;
    spectatorCheerTimer = 2.2; // Spectators jump in the stands!

    if (car.completedLaps >= TOTAL_LAPS) {
      car.finished = true;
      car.lap = TOTAL_LAPS;
      car.finishTimeMs = Math.max(1000, Math.round(performance.now() - raceStartTime));
      soundEngine.playLap();
      pushKillfeed(`🏁 ${car.name} franchit la ligne d'arrivée !`, car.color);
      emitHaptic(car.id, 'finish', [70, 40, 70, 40, 120]);
      syncTelemetryNow();
      checkRaceCompletion();
    } else {
      car.lap = car.completedLaps + 1;
      soundEngine.playLap();
      pushKillfeed(`⏱️ ${car.name} entame le Tour ${car.lap}/${TOTAL_LAPS} !`, car.color);
      emitHaptic(car.id, 'lap', [40, 30, 50]);
      syncTelemetryNow();
    }
  }

  // Continuous progress score for live 1st..8th sorting
  // Prevent unwrapped waypoint 315 from looking ahead of waypoint 5 before CP1
  let effectiveWp = wpIdx;
  if (car.checkpointMask === 0 && wpIdx > wpCount * 0.75) {
    effectiveWp = wpIdx - wpCount;
  }
  car.progressScore = car.completedLaps * wpCount + effectiveWp;
}

/**
 * Elastic Car-to-Car Collisions + Sparks + Sound + Haptics
 */
function resolveCarCollisions(carsArray) {
  const minDist = 36;
  for (let i = 0; i < carsArray.length; i++) {
    for (let j = i + 1; j < carsArray.length; j++) {
      const a = carsArray[i];
      const b = carsArray[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0 && dist < minDist) {
        const overlap = (minDist - dist) * 0.55;
        const nx = dx / dist;
        const ny = dy / dist;

        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        // Relative velocity along collision normal
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        if (velAlongNormal < 0) {
          const restitution = 1.35;
          const impulse = -(1 + restitution) * velAlongNormal * 0.5;
          const boostPush = Math.max(2.6, Math.abs(impulse));

          a.vx -= nx * boostPush;
          a.vy -= ny * boostPush;
          b.vx += nx * boostPush;
          b.vy += ny * boostPush;

          const impactX = (a.x + b.x) * 0.5;
          const impactY = (a.y + b.y) * 0.5;
          spawnImpactSparks(impactX, impactY, '#ffbe0b', 10);

          if (roomStatus === 'racing') {
            const impactForce = Math.min(1.3, boostPush / 4.5);
            soundEngine.playCollision(impactForce);
            if (impactForce > 0.8) {
              screenShake = Math.max(screenShake, 6);
            }
            emitHaptic(a.id, 'collision', [45]);
            emitHaptic(b.id, 'collision', [45]);
          }
        }
      }
    }
  }
}

/**
 * Checks Mystery Box pickups & Oil Slick spinouts
 */
function updateTrackItemsAndHazards(carsArray, dtSec) {
  // 1. Mystery boxes
  for (const box of mysteryBoxes) {
    box.spinPhase += dtSec * 3.2;
    if (box.respawnTimer > 0) {
      box.respawnTimer = Math.max(0, box.respawnTimer - dtSec);
      continue;
    }

    for (const car of carsArray) {
      if (car.finished) continue;
      const d = Math.hypot(car.x - box.x, car.y - box.y);
      if (d < 34) {
        box.respawnTimer = 5.0; // Respawns 5 seconds after pickup
        spawnImpactSparks(box.x, box.y, '#00f5d4', 12);

        if (!car.item) {
          car.item = rollMysteryItem(car.position, carsArray.length);
          car.botItemDelay = 1.0 + Math.random() * 2.0; // Bots use item after 1..3s
          soundEngine.playPickup();
          emitHaptic(car.id, 'pickup', [30, 20, 40]);
          syncTelemetryNow();
        }
        break;
      }
    }
  }

  // 2. Oil Slicks
  for (let i = oilSlicks.length - 1; i >= 0; i--) {
    const slick = oilSlicks[i];
    if (slick.graceTimer > 0) {
      slick.graceTimer = Math.max(0, slick.graceTimer - dtSec);
    }

    for (const car of carsArray) {
      if (car.finished || car.spinoutTimer > 0) continue;
      if (slick.graceTimer > 0 && slick.ownerId === car.id) continue;

      const d = Math.hypot(car.x - slick.x, car.y - slick.y);
      if (d < slick.radius + 16) {
        // Trigger 360° spinout for 1.0s!
        car.spinoutTimer = 1.0;
        car.speed *= 0.4;
        soundEngine.playSpinout();
        spawnImpactSparks(car.x, car.y, '#eab308', 14);
        pushKillfeed(`🍌 ${car.name} part en tête-à-queue !`, '#eab308');
        emitHaptic(car.id, 'spinout', [80, 30, 80, 30, 80]);
        oilSlicks.splice(i, 1);
        break;
      }
    }
  }

  // 3. Expanding Shockwave Rings
  for (let i = shockwaveRings.length - 1; i >= 0; i--) {
    const ring = shockwaveRings[i];
    ring.radius += (ring.maxRadius - ring.radius) * 0.22 + 6;
    ring.alpha -= dtSec * 1.9;
    if (ring.alpha <= 0 || ring.radius >= ring.maxRadius) {
      shockwaveRings.splice(i, 1);
    }
  }
}

/**
 * Updates live 1st..8th standings positions
 */
function updateLivePositions() {
  const allCars = Array.from(carsMap.values());
  allCars.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progressScore - a.progressScore;
  });

  allCars.forEach((car, index) => {
    car.position = index + 1;
  });
}

/**
 * Checks if all human players (or all cars) have finished the race
 */
function checkRaceCompletion() {
  if (roomStatus !== 'racing') return;
  const allCars = Array.from(carsMap.values());
  if (allCars.length === 0) return;

  const humans = allCars.filter((c) => !c.isBot && c.connected);
  const allHumansDone = humans.length > 0 && humans.every((c) => c.finished);
  const allCarsDone = allCars.every((c) => c.finished);
  const anyFinished = allCars.some((c) => c.finished);

  if (allCarsDone || (allHumansDone && anyFinished)) {
    finishRaceSequence();
  }
}

function finishRaceSequence() {
  if (roomStatus === 'finished') return;
  roomStatus = 'finished';
  soundEngine.stopEngine();
  soundEngine.playVictory();

  // Assign estimated finish times for remaining cars that haven't crossed the line
  const nowElapsed = Math.round(performance.now() - raceStartTime);
  updateLivePositions();
  const sorted = Array.from(carsMap.values()).sort((a, b) => a.position - b.position);
  sorted.forEach((c, idx) => {
    if (!c.finished) {
      c.finished = true;
      c.finishTimeMs = nowElapsed + (idx + 1) * 850;
    }
  });

  const rankings = sorted.map((c) => ({
    id: c.id,
    position: c.position,
    name: c.name,
    color: c.color,
    timeMs: c.finishTimeMs
  }));

  socket.emit('host:race_finished', { roomCode, rankings });
  syncTelemetryNow();
  showPodiumView(sorted);
}

// ============================================================================
// PARTICLE & SKIDMARK EFFECTS
// ============================================================================

function drawTireSkid(car, alpha = 0.26) {
  const renderAngle = car.angle + car.driftAngle + car.spinoutAngle;
  const cos = Math.cos(renderAngle);
  const sin = Math.sin(renderAngle);

  // Rear left and rear right wheel positions
  const wheels = [
    { lx: -14, ly: -10 },
    { lx: -14, ly: 10 }
  ];

  skidCtx.save();
  skidCtx.fillStyle = `rgba(10, 12, 18, ${alpha})`;
  wheels.forEach((w) => {
    const wx = car.x + w.lx * cos - w.ly * sin;
    const wy = car.y + w.lx * sin + w.ly * cos;
    skidCtx.beginPath();
    skidCtx.arc(wx, wy, 3.2, 0, Math.PI * 2);
    skidCtx.fill();
  });
  skidCtx.restore();
}

function spawnDriftSparks(car) {
  if (car.driftLevel === 0) return;
  const sparkColor =
    car.driftLevel === 2
      ? Math.random() < 0.5
        ? '#ffbe0b'
        : '#fb5607' // Orange/Gold sparks after 1.3s
      : Math.random() < 0.5
      ? '#00f5d4'
      : '#38bdf8';  // Blue sparks after 0.6s

  const renderAngle = car.angle + car.driftAngle;
  const backX = car.x - Math.cos(renderAngle) * 18;
  const backY = car.y - Math.sin(renderAngle) * 18;

  for (let i = 0; i < 2; i++) {
    particles.push({
      x: backX + (Math.random() - 0.5) * 14,
      y: backY + (Math.random() - 0.5) * 14,
      vx: -car.vx * 0.25 + (Math.random() - 0.5) * 3.2,
      vy: -car.vy * 0.25 + (Math.random() - 0.5) * 3.2,
      size: car.driftLevel === 2 ? 4.2 : 3.2,
      color: sparkColor,
      alpha: 1,
      decay: 0.07
    });
  }
}

function spawnExhaustFlames(car, mode = 'nitro') {
  const renderAngle = car.angle + car.driftAngle;
  const backX = car.x - Math.cos(renderAngle) * 22;
  const backY = car.y - Math.sin(renderAngle) * 22;
  const color =
    mode === 'nitro'
      ? Math.random() < 0.55
        ? '#ff5400'
        : '#ffbe0b'
      : Math.random() < 0.5
      ? '#00f5d4'
      : '#ffbe0b';

  for (let i = 0; i < 2; i++) {
    particles.push({
      x: backX + (Math.random() - 0.5) * 8,
      y: backY + (Math.random() - 0.5) * 8,
      vx: -Math.cos(renderAngle) * (3 + Math.random() * 3),
      vy: -Math.sin(renderAngle) * (3 + Math.random() * 3),
      size: mode === 'nitro' ? 6.5 : 4.8,
      color,
      alpha: 0.95,
      decay: 0.085
    });
  }
}

function spawnWheelParticles(car, color, size = 3.5) {
  const backX = car.x - Math.cos(car.angle) * 16;
  const backY = car.y - Math.sin(car.angle) * 16;
  particles.push({
    x: backX + (Math.random() - 0.5) * 14,
    y: backY + (Math.random() - 0.5) * 14,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
    size,
    color,
    alpha: 0.85,
    decay: 0.05
  });
}

// ============================================================================
// CANVAS 2D RENDERER
// ============================================================================

function renderScene(nowMs, dtNorm) {
  ctx.save();

  // Apply screen shake on heavy impacts or shockwaves
  if (screenShake > 0.2) {
    const sx = (Math.random() - 0.5) * screenShake;
    const sy = (Math.random() - 0.5) * screenShake;
    ctx.translate(sx, sy);
    screenShake *= Math.pow(0.86, dtNorm);
  } else {
    screenShake = 0;
  }

  // 1. Static Track + Persistent Skidmarks
  ctx.drawImage(trackStaticCanvas, 0, 0);
  ctx.drawImage(skidCanvas, 0, 0);

  // 2. Animated Water Shimmer in Infield Lake
  drawLakeReflections(nowMs);

  // 3. Animated Spectators in Grandstands
  drawSpectators(nowMs);

  // 4. Oil Slicks / Banana Hazards on Track
  oilSlicks.forEach((slick) => drawOilSlick(slick, nowMs));

  // 5. Mystery Boxes (? rotating neon cubes)
  mysteryBoxes.forEach((box) => drawMysteryBox(box, nowMs));

  // 6. Expanding Shockwave Rings
  shockwaveRings.forEach((ring) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 245, 212, ${Math.max(0, ring.alpha)})`;
    ctx.lineWidth = 8;
    ctx.shadowColor = '#00f5d4';
    ctx.shadowBlur = 22;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius * 0.78, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, ring.alpha * 0.7)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  });

  // 7. Particles (Sparks, Nitro Flames, Dirt)
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dtNorm;
    p.y += p.vy * dtNorm;
    p.alpha -= p.decay * dtNorm;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 8. Cars (either active room cars or demo background cars)
  const activeCars =
    carsMap.size > 0 ? Array.from(carsMap.values()) : demoCars;
  activeCars.forEach((car) => drawCarOnTrack(car, nowMs));

  // 9. Podium Confetti Overlay
  if (roomStatus === 'finished' && confettiParticles.length > 0) {
    confettiParticles.forEach((c) => {
      c.x += c.vx * dtNorm;
      c.y += c.vy * dtNorm;
      c.angle += c.spin * dtNorm;
      if (c.y > CANVAS_H + 20) {
        c.y = -20;
        c.x = Math.random() * CANVAS_W;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size * 0.5, -c.size * 0.3, c.size, c.size * 0.6);
      ctx.restore();
    });
  }

  ctx.restore();
}

function drawLakeReflections(nowMs) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const offset = Math.sin(nowMs * 0.002 + i * 1.4) * 14;
    const rx = 775 + i * 32 + offset;
    const ry = 525 + i * 18;
    ctx.beginPath();
    ctx.moveTo(rx - 22, ry);
    ctx.quadraticCurveTo(rx, ry - 5, rx + 22, ry);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpectators(nowMs) {
  const cheerBoost = spectatorCheerTimer > 0 ? 4.5 : 1.0;
  spectators.forEach((s) => {
    const jump =
      spectatorCheerTimer > 0
        ? Math.abs(Math.sin(nowMs * 0.016 + s.phase)) * 5.5
        : Math.sin(nowMs * 0.004 + s.phase) * 1.2 * cheerBoost;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y - jump, 4.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawOilSlick(slick, nowMs) {
  ctx.save();
  ctx.translate(slick.x, slick.y);
  // Darkrainbow oil puddle
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const r = slick.radius + Math.sin(a * 3 + nowMs * 0.004) * 3.5;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#090d16';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#eab308';
  ctx.stroke();

  // Banana / hazard icon on top
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🍌', 0, 0);
  ctx.restore();
}

function drawMysteryBox(box, nowMs) {
  if (box.respawnTimer > 0) {
    // Faint ghost outline while respawning
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-10, -10, 20, 20);
    ctx.restore();
    return;
  }

  const pulse = 1 + Math.sin(nowMs * 0.006 + box.spinPhase) * 0.12;
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.rotate(Math.sin(nowMs * 0.003 + box.spinPhase) * 0.35);
  ctx.scale(pulse, pulse);

  // Outer glow diamond
  const grad = ctx.createLinearGradient(-15, -15, 15, 15);
  grad.addColorStop(0, '#ff006e');
  grad.addColorStop(0.5, '#ffbe0b');
  grad.addColorStop(1, '#00f5d4');

  ctx.fillStyle = grad;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-14, -14, 28, 28, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#090d16';
  ctx.font = '900 17px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 1);
  ctx.restore();
}

function drawCarOnTrack(car, nowMs) {
  const renderAngle = car.angle + car.driftAngle + car.spinoutAngle;

  ctx.save();
  ctx.translate(car.x, car.y);

  // Honk soundwave ring around car
  if (car.honkVisualTimer > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 28 + (0.65 - car.honkVisualTimer) * 35, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffbe0b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  ctx.rotate(renderAngle);

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
  ctx.beginPath();
  ctx.roundRect(-21, -11, 42, 26, 6);
  ctx.fill();

  // 4 Wheels
  ctx.fillStyle = '#090d16';
  ctx.fillRect(-15, -15, 10, 5);
  ctx.fillRect(6, -15, 10, 5);
  ctx.fillRect(-15, 10, 10, 5);
  ctx.fillRect(6, 10, 10, 5);

  // Car Chassis
  ctx.fillStyle = car.color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-19, -11, 38, 22, 6);
  ctx.fill();
  ctx.stroke();

  // White racing stripe
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(-14, -2.5, 30, 5);

  // Rear Spoiler
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-21, -9, 4, 18);

  // Cockpit & Helmet
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(-5, -6.5, 13, 13, 4);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(1, 0, 3.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Floating Driver Label above car
  ctx.save();
  ctx.translate(car.x, car.y - 26);
  const itemPrefix = car.item && ITEM_META[car.item] ? `${ITEM_META[car.item].icon} ` : '';
  const netSuffix = !car.isBot && !car.connected ? ' 📡' : '';
  const labelText = `${itemPrefix}${car.name}${netSuffix}`;

  ctx.font = '700 12px "Chakra Petch", sans-serif';
  const textW = ctx.measureText(labelText).width;
  const pillW = textW + 14;

  ctx.fillStyle = 'rgba(8, 13, 26, 0.82)';
  ctx.strokeStyle = car.color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-pillW * 0.5, -10, pillW, 18, 9);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, 0, -1);
  ctx.restore();
}

// ============================================================================
// RACE COUNTDOWN & FLOW MANAGEMENT
// ============================================================================

function startCountdownAndRace() {
  if (playersList.length === 0) return;

  soundEngine.unlock();
  roomStatus = 'countdown';
  countdownTimer = 3.6;
  lastCountdownStep = 4;

  resetCarsOnStartingGrid();

  lobbyView.classList.add('hidden');
  podiumView.classList.add('hidden');
  raceHud.classList.remove('hidden');
  roomPillMini.classList.remove('hidden');

  countdownOverlay.classList.remove('hidden');
  countdownText.classList.remove('go');
  countdownText.textContent = '3';
  light1.className = 'traffic-light red';
  light2.className = 'traffic-light';
  light3.className = 'traffic-light';

  soundEngine.playCountdownBeep(false);
  renderHudStandings();
}

function updateCountdown(dtSec) {
  countdownTimer -= dtSec;
  const step = Math.ceil(countdownTimer - 0.6);

  if (step !== lastCountdownStep) {
    lastCountdownStep = step;
    if (step === 2) {
      countdownText.textContent = '2';
      light1.className = 'traffic-light red';
      light2.className = 'traffic-light red';
      soundEngine.playCountdownBeep(false);
    } else if (step === 1) {
      countdownText.textContent = '1';
      light1.className = 'traffic-light red';
      light2.className = 'traffic-light red';
      light3.className = 'traffic-light red';
      soundEngine.playCountdownBeep(false);
    } else if (step === 0) {
      countdownText.textContent = 'GO !';
      countdownText.classList.add('go');
      light1.className = 'traffic-light green';
      light2.className = 'traffic-light green';
      light3.className = 'traffic-light green';
      soundEngine.playCountdownBeep(true);
      soundEngine.startEngine();

      // Release cars immediately on GO!
      roomStatus = 'racing';
      raceStartTime = performance.now();
      emitHaptic('all', 'go', [60, 30, 90]);
      syncTelemetryNow();
    }
  }

  if (countdownTimer <= 0) {
    countdownOverlay.classList.add('hidden');
  }
}

// ============================================================================
// MAIN 60 FPS GAME LOOP
// ============================================================================

let lastFrameTime = performance.now();

function gameLoop(nowMs) {
  requestAnimationFrame(gameLoop);

  const rawDtSec = (nowMs - lastFrameTime) / 1000;
  lastFrameTime = nowMs;

  // Clamp dt to avoid physics jumps when switching tabs
  const dtSec = Math.min(0.05, Math.max(0.001, rawDtSec));
  const dtNorm = dtSec * 60; // 1.0 at 60Hz, 0.5 at 120Hz

  if (spectatorCheerTimer > 0) {
    spectatorCheerTimer = Math.max(0, spectatorCheerTimer - dtSec);
  }

  if (roomStatus === 'countdown') {
    updateCountdown(dtSec);
  }

  const activeCars = Array.from(carsMap.values());

  if (roomStatus === 'racing') {
    if (!countdownOverlay.classList.contains('hidden')) {
      countdownTimer -= dtSec;
      if (countdownTimer <= 0) countdownOverlay.classList.add('hidden');
    }

    activeCars.forEach((car) => updateSingleCarPhysics(car, dtNorm, dtSec, true));
    resolveCarCollisions(activeCars);
    updateTrackItemsAndHazards(activeCars, dtSec);
    updateLivePositions();
    renderHudStandings();

    // Modulate continuous engine hum by average car speed
    const avgSpeed =
      activeCars.reduce((acc, c) => acc + Math.abs(c.speed), 0) /
      Math.max(1, activeCars.length);
    soundEngine.updateEngine(avgSpeed / 8.5);

    // Periodic telemetry broadcast every 120ms
    if (nowMs - lastTelemetrySync >= 120) {
      syncTelemetryNow(nowMs);
    }
  } else if (roomStatus === 'finished') {
    // Cars continue cruising on autopilot in background behind Podium
    activeCars.forEach((car) => updateSingleCarPhysics(car, dtNorm, dtSec, false));
  } else if (roomStatus === 'lobby') {
    // Animate demo cars if lobby is empty, or keep joined cars parked / cruising
    if (activeCars.length === 0) {
      demoCars.forEach((c) => updateSingleCarPhysics(c, dtNorm, dtSec, false));
    } else {
      activeCars.forEach((c) => {
        if (c.honkVisualTimer > 0) {
          c.honkVisualTimer = Math.max(0, c.honkVisualTimer - dtSec);
        }
      });
    }
  }

  renderScene(nowMs, dtNorm);
}

// ============================================================================
// SOCKET.IO COMMUNICATION & TELEMETRY SYNC
// ============================================================================

const socket = window.io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 500
});

function syncTelemetryNow(nowMs = performance.now()) {
  if (!roomCode) return;
  lastTelemetrySync = nowMs;
  const telemetryPlayers = Array.from(carsMap.values()).map((c) => ({
    id: c.id,
    position: c.position,
    lap: c.lap,
    item: c.item,
    finished: c.finished
  }));
  socket.emit('host:sync_telemetry', {
    roomCode,
    players: telemetryPlayers
  });
}

function emitHaptic(targetId, type = 'impact', pattern = [40]) {
  if (!roomCode) return;
  socket.emit('host:haptic', { roomCode, targetId, type, pattern });
}

function handleRoomStateSync(statePayload) {
  const state = statePayload?.state || statePayload;
  if (!state) return;

  if (state.roomCode && state.roomCode !== roomCode) {
    roomCode = state.roomCode;
    sessionStorage.setItem('hostRoomCode', roomCode);
    updateRoomLinksAndQr(roomCode);
  } else if (state.roomCode && lobbyRoomCode.textContent === '----') {
    updateRoomLinksAndQr(state.roomCode);
  }

  const prevCount = playersList.length;
  playersList = Array.isArray(state.players) ? state.players : [];

  // Play joyful join sound if a new player/bot arrived in lobby
  if (playersList.length > prevCount && roomStatus === 'lobby') {
    soundEngine.playJoin();
  }

  // Sync carsMap with playersList
  const currentIds = new Set();
  playersList.forEach((p, idx) => {
    currentIds.add(p.id);
    const existingCar = carsMap.get(p.id);
    if (existingCar) {
      existingCar.name = p.name;
      existingCar.color = p.color;
      existingCar.isBot = Boolean(p.isBot);
      existingCar.isCreator = Boolean(p.isCreator);
      existingCar.connected = p.connected !== false;
      existingCar.slotIndex = typeof p.slotIndex === 'number' ? p.slotIndex : idx;
      if (roomStatus === 'lobby') {
        // Keep starting grid position updated in lobby
        const fresh = createCarEntity(p, existingCar.slotIndex);
        existingCar.x = fresh.x;
        existingCar.y = fresh.y;
        existingCar.angle = fresh.angle;
      }
    } else {
      const slot = typeof p.slotIndex === 'number' ? p.slotIndex : idx;
      carsMap.set(p.id, createCarEntity(p, slot));
    }
  });

  for (const id of carsMap.keys()) {
    if (!currentIds.has(id)) {
      carsMap.delete(id);
    }
  }

  renderLobbyGrid();
  if (roomStatus === 'racing' || roomStatus === 'countdown') {
    renderHudStandings();
  }
}

socket.on('connect', () => {
  const savedRoomCode = sessionStorage.getItem('hostRoomCode') || roomCode || '';
  socket.emit('host:create_room', { existingRoomCode: savedRoomCode });
});

socket.on('room:created', (payload) => {
  if (payload?.roomCode) {
    roomCode = payload.roomCode;
    sessionStorage.setItem('hostRoomCode', roomCode);
    updateRoomLinksAndQr(roomCode);
  }
  handleRoomStateSync(payload);
});

socket.on('room:state', (payload) => {
  handleRoomStateSync(payload);
});

socket.on('host:player_input', ({ playerId, input }) => {
  const car = carsMap.get(playerId);
  if (car && input) {
    car.input = {
      left: Boolean(input.left),
      right: Boolean(input.right),
      accel: Boolean(input.accel),
      drift: Boolean(input.drift)
    };
  }
});

socket.on('host:player_use_item', ({ playerId }) => {
  const car = carsMap.get(playerId);
  if (car) {
    activateCarItem(car);
  }
});

socket.on('host:player_honk', ({ playerId }) => {
  triggerPlayerHonkVisual(playerId);
});

socket.on('host:trigger_start', () => {
  if (roomStatus === 'lobby' && playersList.length > 0) {
    triggerRaceStartFromHost();
  }
});

socket.on('host:trigger_restart', () => {
  triggerDirectRaceRestart();
});

socket.on('host:player_removed', ({ playerId }) => {
  carsMap.delete(playerId);
  playersList = playersList.filter((p) => p.id !== playerId);
  renderLobbyGrid();
});

socket.on('host:player_reconnected', ({ playerId, player }) => {
  const car = carsMap.get(playerId);
  if (car) {
    car.connected = true;
    if (player?.name) car.name = player.name;
  }
  pushKillfeed(`📡 ${player?.name || 'Pilote'} est reconnecté !`, '#00e676');
  renderLobbyGrid();
});

// ============================================================================
// UI EVENT LISTENERS & KEYBOARD CONTROLS
// ============================================================================

function triggerRaceStartFromHost() {
  if (playersList.length === 0) return;
  socket.emit('host:start_race', { roomCode });
  startCountdownAndRace();
}

function triggerDirectRaceRestart() {
  socket.emit('host:restart_lobby', { roomCode, directRace: true });
  startCountdownAndRace();
}

function triggerReturnToLobby() {
  soundEngine.stopEngine();
  roomStatus = 'lobby';
  socket.emit('host:restart_lobby', { roomCode, directRace: false });
  resetCarsOnStartingGrid();
  podiumView.classList.add('hidden');
  raceHud.classList.add('hidden');
  roomPillMini.classList.add('hidden');
  lobbyView.classList.remove('hidden');
  renderLobbyGrid();
}

btnAddBot.addEventListener('click', () => {
  soundEngine.unlock();
  socket.emit('host:add_bot', { roomCode });
});

btnRemoveBot.addEventListener('click', () => {
  soundEngine.unlock();
  socket.emit('host:remove_bot', { roomCode });
});

btnStartRace.addEventListener('click', () => {
  triggerRaceStartFromHost();
});

btnRestartRace.addEventListener('click', () => {
  triggerDirectRaceRestart();
});

btnBackLobby.addEventListener('click', () => {
  triggerReturnToLobby();
});

btnCopyUrl.addEventListener('click', async () => {
  const url = joinUrlLink.href;
  try {
    await navigator.clipboard.writeText(url);
    btnCopyUrl.textContent = '✅ Lien copié !';
    setTimeout(() => {
      btnCopyUrl.textContent = '📋 Copier le lien';
    }, 2000);
  } catch (_) {}
});

btnMute.addEventListener('click', () => {
  const isMuted = soundEngine.toggleMute();
  btnMute.classList.toggle('muted', isMuted);
  muteIcon.textContent = isMuted ? '🔇' : '🔊';
  muteLabel.textContent = isMuted ? 'MUET' : 'SON ON';
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
});

// Host PC Keyboard Support (Arrows / WASD + Space for Drift + E/Enter for Item + H for Honk)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    btnMute.click();
    return;
  }
  if (e.code === 'KeyF') {
    btnFullscreen.click();
    return;
  }

  if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyQ') keyboardInput.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keyboardInput.right = true;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyZ') keyboardInput.accel = true;
  if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') keyboardInput.drift = true;

  if (e.code === 'KeyE' || e.code === 'Enter') {
    const firstCar =
      carsMap.get((playersList.find((p) => !p.isBot) || playersList[0])?.id);
    if (firstCar && roomStatus === 'racing') {
      activateCarItem(firstCar);
    }
  }

  if (e.code === 'KeyH') {
    const firstPlayer = playersList.find((p) => !p.isBot) || playersList[0];
    if (firstPlayer) {
      triggerPlayerHonkVisual(firstPlayer.id);
    } else {
      soundEngine.playHonk(1.0);
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyQ') keyboardInput.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keyboardInput.right = false;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyZ') keyboardInput.accel = false;
  if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') keyboardInput.drift = false;
});

// ============================================================================
// RENDER KEEP-ALIVE & INITIALIZATION
// ============================================================================

// Prevent Render free tier from sleeping during the party (every 25s)
setInterval(() => {
  fetch('/api/ping').catch(() => {});
}, 25000);

// Initialize Track, Mystery Boxes, Demo Cars & Start 60 FPS Loop
buildTrackGeometry();
initMysteryBoxes();
initDemoCars();
renderLobbyGrid();
requestAnimationFrame(gameLoop);
