/**
 * SLITHER.IO CLONE — game.js
 * Vue 3 Composition API + Canvas 2D
 * ─────────────────────────────────────────────────────────
 * Arquitectura:
 *   - Vue 3 maneja las pantallas (SPA) y el estado reactivo del HUD
 *   - Canvas 2D maneja el renderizado del mundo del juego
 *   - requestAnimationFrame loop principal
 *   - Grid espacial (spatial hash) para detección de colisiones eficiente
 * ─────────────────────────────────────────────────────────
 */

const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch } = Vue;

// ═══════════════════════════════════════════════════════════
// CONSTANTES DEL JUEGO
// ═══════════════════════════════════════════════════════════
const WORLD_W    = 3200;
const WORLD_H    = 3200;
const BASE_SPEED = 2.4;
const TURBO_SPEED = 4.8;
const TURBO_DRAIN = 0.25;   // % por frame
const TURBO_REGEN = 0.08;
const SEGMENT_RADIUS = 9;
const HEAD_RADIUS    = 11;
const ORB_RADIUS     = 5;
const ORB_COUNT_INIT = 320;
const ORB_COUNT_MAX  = 500;
const BOT_COUNT      = 12;
const SEGMENT_SPACING= 14;
const INITIAL_LENGTH = 6;
const GROW_PER_ORB   = 4;
const MAX_TURN_RATE  = 0.12;   // radianes por frame

// Colores disponibles para serpientes
const SNAKE_COLORS = [
  { id: 'green',  hex: '#00f5a0', glow: '#00f5a080', head: '#00ffc3', body: '#00c47e', dark: '#007a50' },
  { id: 'blue',   hex: '#00c8ff', glow: '#00c8ff80', head: '#40d8ff', body: '#0099cc', dark: '#005f80' },
  { id: 'pink',   hex: '#ff3d6b', glow: '#ff3d6b80', head: '#ff6b8a', body: '#cc3057', dark: '#801e38' },
  { id: 'yellow', hex: '#ffd100', glow: '#ffd10080', head: '#ffe040', body: '#ccaa00', dark: '#806a00' },
  { id: 'purple', hex: '#b86bff', glow: '#b86bff80', head: '#cc8fff', body: '#9350d4', dark: '#5c3085' },
  { id: 'orange', hex: '#ff8c00', glow: '#ff8c0080', head: '#ffaa40', body: '#cc7000', dark: '#804500' },
];

// Paleta de colores para bots
const BOT_PALETTES = [
  { head: '#ff6b6b', body: '#cc4444', dark: '#882222' },
  { head: '#6bcfff', body: '#4499cc', dark: '#226688' },
  { head: '#b8ff6b', body: '#88cc44', dark: '#558822' },
  { head: '#ff6bff', body: '#cc44cc', dark: '#882288' },
  { head: '#ffcf6b', body: '#cc9944', dark: '#886622' },
  { head: '#6bffcf', body: '#44cc99', dark: '#228866' },
  { head: '#ff9f6b', body: '#cc7244', dark: '#884422' },
  { head: '#cf6bff', body: '#9944cc', dark: '#662288' },
];

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));
const dist    = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const clamp   = (v, min, max) => Math.min(Math.max(v, min), max);
const lerp    = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
  let diff = b - a;
  while (diff > Math.PI)  diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
};
const clampAngle = (current, target, maxDelta) => {
  let diff = target - current;
  while (diff > Math.PI)  diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  diff = clamp(diff, -maxDelta, maxDelta);
  return current + diff;
};

// ═══════════════════════════════════════════════════════════
// CLASES DEL JUEGO
// ═══════════════════════════════════════════════════════════

class Orb {
  constructor(x, y) {
    this.x = x ?? rand(ORB_RADIUS + 20, WORLD_W - ORB_RADIUS - 20);
    this.y = y ?? rand(ORB_RADIUS + 20, WORLD_H - ORB_RADIUS - 20);
    this.r = ORB_RADIUS * rand(0.6, 1.6);
    this.value = Math.round(this.r * 2);
    const hues = [120, 180, 60, 300, 30, 240, 0];
    this.hue   = hues[randInt(0, hues.length)];
    this.pulse = rand(0, Math.PI * 2);
    this.pulseSpeed = rand(0.03, 0.07);
    this.alpha = rand(0.7, 1.0);
  }

  update() {
    this.pulse += this.pulseSpeed;
  }

  draw(ctx) {
    const scale = 1 + Math.sin(this.pulse) * 0.2;
    const r = this.r * scale;
    const grd = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 2);
    grd.addColorStop(0,   `hsla(${this.hue},100%,90%,${this.alpha})`);
    grd.addColorStop(0.4, `hsla(${this.hue},100%,60%,${this.alpha * 0.8})`);
    grd.addColorStop(1,   `hsla(${this.hue},100%,40%,0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 2, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
  }
}

class Snake {
  constructor({ x, y, angle, colorPalette, name, isPlayer = false }) {
    this.name      = name;
    this.isPlayer  = isPlayer;
    this.palette   = colorPalette;
    this.alive     = true;
    this.score     = 0;
    this.growQueue = 0;

    // Segmentos: array de {x, y}
    this.segments = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      this.segments.push({
        x: x - Math.cos(angle) * i * SEGMENT_SPACING,
        y: y - Math.sin(angle) * i * SEGMENT_SPACING,
      });
    }

    this.angle       = angle;
    this.targetAngle = angle;
    this.speed       = BASE_SPEED;
    this.turboActive = false;
    this.turboFuel   = 100;

    // Bot AI
    this.botTarget     = { x: rand(100, WORLD_W - 100), y: rand(100, WORLD_H - 100) };
    this.botTimer      = 0;
    this.botTurbo      = false;
    this.wobble        = rand(0, Math.PI * 2);
    this.wobbleSpeed   = rand(0.02, 0.05);
  }

  get head() { return this.segments[0]; }
  get length() { return this.segments.length; }

  // Mueve la serpiente un paso
  step(nearbyOrbs, allSnakes) {
    if (!this.alive) return;

    if (!this.isPlayer) this._botAI(nearbyOrbs, allSnakes);

    // Turbo
    if (this.turboActive && this.turboFuel > 0) {
      this.turboFuel = Math.max(0, this.turboFuel - TURBO_DRAIN);
      this.speed = TURBO_SPEED;
      if (this.turboFuel === 0) this.turboActive = false;
    } else {
      this.speed = BASE_SPEED;
      if (!this.turboActive) {
        this.turboFuel = Math.min(100, this.turboFuel + TURBO_REGEN);
      }
    }

    // Interpolación de ángulo suave con límite de giro máximo
    const easedAngle = lerpAngle(this.angle, this.targetAngle, 0.18);
    this.angle = clampAngle(this.angle, easedAngle, MAX_TURN_RATE);

    let newX = this.head.x + Math.cos(this.angle) * this.speed;
    let newY = this.head.y + Math.sin(this.angle) * this.speed;

    // Rebotar suavemente contra los bordes del mundo sin matar a nadie
    const minX = HEAD_RADIUS;
    const maxX = WORLD_W - HEAD_RADIUS;
    const minY = HEAD_RADIUS;
    const maxY = WORLD_H - HEAD_RADIUS;

    if (newX < minX || newX > maxX) {
      this.angle = Math.PI - this.angle;
      newX = clamp(newX, minX, maxX);
    }
    if (newY < minY || newY > maxY) {
      this.angle = -this.angle;
      newY = clamp(newY, minY, maxY);
    }

    // Nuevo segmento cabeza
    this.segments.unshift({ x: newX, y: newY });

    // Crecer o recortar cola
    if (this.growQueue > 0) {
      this.growQueue--;
    } else {
      this.segments.pop();
    }
  }

  // Comprobar si choca con borde del mundo
  isOutOfBounds() {
    const h = this.head;
    return h.x < 0 || h.x > WORLD_W || h.y < 0 || h.y > WORLD_H;
  }

  // Dibujar la serpiente
  draw(ctx) {
    if (!this.alive || this.segments.length < 2) return;
    const { palette } = this;

    // Cuerpo
    for (let i = this.segments.length - 1; i >= 1; i--) {
      const s = this.segments[i];
      const t = i / this.segments.length; // 0=cabeza, 1=cola
      const r = SEGMENT_RADIUS * (1 - t * 0.3);

      // Patrón de escamas alternadas
      const isOdd = i % 2 === 0;
      const color = isOdd ? palette.body : palette.dark;

      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Brillo superior
      if (i % 4 === 0) {
        const grd = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.3, 0, s.x, s.y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.25)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }
    }

    // Cabeza
    const hx = this.head.x;
    const hy = this.head.y;
    const hr = HEAD_RADIUS;

    // Glow alrededor de la cabeza
    const glowGrd = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr * 3);
    glowGrd.addColorStop(0,   `${palette.head}40`);
    glowGrd.addColorStop(1,   'transparent');
    ctx.beginPath();
    ctx.arc(hx, hy, hr * 3, 0, Math.PI * 2);
    ctx.fillStyle = glowGrd;
    ctx.fill();

    // Cabeza principal
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = palette.head;
    ctx.fill();

    // Highlight
    const hlGrd = ctx.createRadialGradient(hx - hr * 0.3, hy - hr * 0.3, 0, hx, hy, hr);
    hlGrd.addColorStop(0, 'rgba(255,255,255,0.5)');
    hlGrd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = hlGrd;
    ctx.fill();

    // Ojos
    const eyeOffset = hr * 0.45;
    const eyeAngleL = this.angle - 0.55;
    const eyeAngleR = this.angle + 0.55;
    const eyeR      = hr * 0.28;

    for (const ea of [eyeAngleL, eyeAngleR]) {
      const ex = hx + Math.cos(ea) * eyeOffset;
      const ey = hy + Math.sin(ea) * eyeOffset;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + Math.cos(this.angle) * eyeR * 0.4, ey + Math.sin(this.angle) * eyeR * 0.4, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
    }

    // Nombre encima de la cabeza
    if (this.isPlayer || this.length > 15) {
      ctx.font = `bold 11px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.isPlayer ? palette.head : 'rgba(200,220,255,0.8)';
      ctx.shadowColor = '#000';
      ctx.shadowBlur  = 4;
      ctx.fillText(this.name, hx, hy - hr - 6);
      ctx.shadowBlur = 0;
    }
  }

  // IA básica para bots
  _botAI(nearbyOrbs, allSnakes) {
    this.botTimer--;
    this.wobble += this.wobbleSpeed;

    const hx = this.head.x;
    const hy = this.head.y;

    // Priorizar huir de amenazas más grandes
    let danger = null;
    for (const snake of allSnakes) {
      if (snake === this || !snake.alive) continue;
      const d = dist(hx, hy, snake.head.x, snake.head.y);
      if (d < 260 && snake.length >= this.length) {
        if (!danger || d < danger.dist) {
          danger = { snake, dist: d };
        }
      }
    }

    if (danger && danger.dist < 220) {
      const dx = hx - danger.snake.head.x;
      const dy = hy - danger.snake.head.y;
      const angleAway = Math.atan2(dy, dx) + Math.sin(this.wobble) * 0.2;
      this.targetAngle = angleAway;
      this.botTimer = 40;
      this.turboActive = this.turboFuel > 10;
      return;
    }

    // Evitar bordes del mundo
    const margin = 190;
    if (hx < margin || hx > WORLD_W - margin || hy < margin || hy > WORLD_H - margin) {
      this.botTarget = { x: WORLD_W / 2 + rand(-400, 400), y: WORLD_H / 2 + rand(-400, 400) };
      this.botTimer = 60;
    }

    // Buscar orbe más cercano
    if (this.botTimer <= 0 || nearbyOrbs.length > 0) {
      let best = null, bestD = Infinity;
      for (const orb of nearbyOrbs) {
        const d = dist(hx, hy, orb.x, orb.y);
        if (d < bestD) { bestD = d; best = orb; }
      }
      if (best && bestD < 300) {
        this.botTarget = { x: best.x, y: best.y };
      } else if (this.botTimer <= 0) {
        this.botTarget = {
          x: clamp(hx + rand(-300, 300), 100, WORLD_W - 100),
          y: clamp(hy + rand(-300, 300), 100, WORLD_H - 100),
        };
        this.botTimer = randInt(80, 200);
      }
    }

    // Calcular ángulo hacia objetivo + pequeño wobble natural
    const dx = this.botTarget.x - hx;
    const dy = this.botTarget.y - hy;
    const targetA = Math.atan2(dy, dx) + Math.sin(this.wobble) * 0.12;
    this.targetAngle = targetA;

    // Turbo ocasional y defensivo
    const shouldBoost = Math.random() < 0.01 || danger?.dist < 200;
    this.botTurbo = shouldBoost;
    this.turboActive = this.botTurbo && this.turboFuel > 12;
  }
}

// ═══════════════════════════════════════════════════════════
// SPATIAL HASH — detección de colisiones eficiente
// ═══════════════════════════════════════════════════════════
class SpatialHash {
  constructor(cellSize = 100) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  _key(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }
  insert(obj) {
    const key = this._key(obj.x, obj.y);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(obj);
  }
  query(x, y, radius) {
    const result = [];
    const cx0 = Math.floor((x - radius) / this.cellSize);
    const cx1 = Math.floor((x + radius) / this.cellSize);
    const cy0 = Math.floor((y - radius) / this.cellSize);
    const cy1 = Math.floor((y + radius) / this.cellSize);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        if (this.cells.has(key)) result.push(...this.cells.get(key));
      }
    }
    return result;
  }
  clear() { this.cells.clear(); }
}

// ═══════════════════════════════════════════════════════════
// VUE APP
// ═══════════════════════════════════════════════════════════
createApp({
  setup() {
    // ── Estado de Vue (UI) ──────────────────────────────
    const screen       = ref('menu');
    const playerName   = ref('');
    const selectedColor= ref('green');
    const score        = ref(0);
    const snakeLength  = ref(INITIAL_LENGTH);
    const turboActive  = ref(false);
    const turboFuel    = ref(100);
    const paused       = ref(false);
    const bestScore    = ref(parseInt(localStorage.getItem('slither_best') || '0'));
    const deathCause   = ref('');
    const leaderboard  = ref([]);
    const nameInput    = ref(null);
    const gameCanvas   = ref(null);

    const snakeColors  = SNAKE_COLORS;

    // ── Estado del juego (imperativo, fuera de Vue) ─────
    let ctx, animId, player, bots, orbs, spatialOrbs, spatialSnakes;
    let keys = {};
    let mouseAngle = null;
    let lastMouseX = null, lastMouseY = null;

    // ── Inicializar canvas ──────────────────────────────
    function initCanvas() {
      const canvas = gameCanvas.value;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx = canvas.getContext('2d');
    }

    // ── Crear mundo ─────────────────────────────────────
    function createWorld() {
      // Orbes
      orbs = [];
      for (let i = 0; i < ORB_COUNT_INIT; i++) orbs.push(new Orb());
      spatialOrbs   = new SpatialHash(120);
      spatialSnakes = new SpatialHash(80);

      // Jugador
      const palette = SNAKE_COLORS.find(c => c.id === selectedColor.value) || SNAKE_COLORS[0];
      player = new Snake({
        x: WORLD_W / 2 + rand(-200, 200),
        y: WORLD_H / 2 + rand(-200, 200),
        angle: rand(0, Math.PI * 2),
        colorPalette: palette,
        name: playerName.value.trim() || 'Jugador',
        isPlayer: true,
      });

      // Bots
      bots = [];
      for (let i = 0; i < BOT_COUNT; i++) {
        const palette = BOT_PALETTES[i % BOT_PALETTES.length];
        const botNames = ['Cobra','Mamba','Víbora','Boa','Pitón','Anaconda','Naga','Sierpe','Basilisk','Wyrm','Asp','Krait'];
        bots.push(new Snake({
          x: rand(200, WORLD_W - 200),
          y: rand(200, WORLD_H - 200),
          angle: rand(0, Math.PI * 2),
          colorPalette: palette,
          name: botNames[i % botNames.length] + (Math.floor(rand(10, 99))),
          isPlayer: false,
        }));
      }
    }

    // ── Input del jugador ───────────────────────────────
    function setupInput() {
      const onKey = (e) => { keys[e.code] = e.type === 'keydown'; };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup',   onKey);

      const canvas = gameCanvas.value;
      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        lastMouseX = e.clientX - rect.left;
        lastMouseY = e.clientY - rect.top;
      });

      canvas.addEventListener('mousedown', () => { if (player) player.turboActive = true; });
      canvas.addEventListener('mouseup',   () => { if (player) player.turboActive = false; });

      // Touch
      canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        lastMouseX = e.touches[0].clientX - rect.left;
        lastMouseY = e.touches[0].clientY - rect.top;
      }, { passive: false });

      canvas.addEventListener('touchstart', () => { if (player) player.turboActive = true; });
      canvas.addEventListener('touchend',   () => { if (player) player.turboActive = false; });
    }

    function processInput(cam) {
      if (!player || !player.alive) return;

      // Teclas flechas / WASD
      const left  = keys['ArrowLeft']  || keys['KeyA'];
      const right = keys['ArrowRight'] || keys['KeyD'];
      const up    = keys['ArrowUp']    || keys['KeyW'];
      const down  = keys['ArrowDown']  || keys['KeyS'];

      if (left)  player.targetAngle = Math.PI;
      if (right) player.targetAngle = 0;
      if (up)    player.targetAngle = -Math.PI / 2;
      if (down)  player.targetAngle = Math.PI / 2;

      // Combinaciones diagonal
      if (up && left)    player.targetAngle = -Math.PI * 0.75;
      if (up && right)   player.targetAngle = -Math.PI * 0.25;
      if (down && left)  player.targetAngle = Math.PI * 0.75;
      if (down && right) player.targetAngle = Math.PI * 0.25;

      // Ratón
      if (lastMouseX !== null && lastMouseY !== null) {
        const worldMx = lastMouseX + cam.x;
        const worldMy = lastMouseY + cam.y;
        player.targetAngle = Math.atan2(
          worldMy - player.head.y,
          worldMx - player.head.x
        );
      }
    }

    // ── Actualizar mundo ─────────────────────────────────
    function update() {
      if (paused.value) return;

      // Reconstruir grids espaciales
      spatialOrbs.clear();
      spatialSnakes.clear();

      for (const orb of orbs) {
        orb.update();
        spatialOrbs.insert(orb);
      }

      const allSnakes = [player, ...bots].filter(s => s.alive);
      for (const snake of allSnakes) {
        for (let i = 0; i < snake.segments.length; i++) {
          const seg = snake.segments[i];
          spatialSnakes.insert({ x: seg.x, y: seg.y, snake, index: i, isHead: i === 0 });
        }
      }

      // Cámara (centrada en el jugador)
      const cam = computeCamera();

      // Mover y comprobar jugador
      if (player.alive) {
        processInput(cam);

        const nearbyOrbs = spatialOrbs.query(player.head.x, player.head.y, 300);
        player.step(nearbyOrbs, allSnakes);

        // Colisión jugador → otros segmentos
        const dangerSegs = spatialSnakes.query(player.head.x, player.head.y, HEAD_RADIUS * 3);
        for (const seg of dangerSegs) {
          if (seg.snake === player) continue;
          const distance = dist(player.head.x, player.head.y, seg.x, seg.y);

          if (seg.isHead && distance < HEAD_RADIUS * 2) {
            const outcome = resolveHeadToHeadCollision(player, seg.snake);
            if (outcome === 'attacker') {
              killPlayer(`Choque de cabezas con ${seg.snake.name}`);
              return;
            }
            if (outcome === 'defender') {
              killSnake(seg.snake, `Mataste a ${seg.snake.name}`, player);
              return;
            }
            if (outcome === 'both') {
              killPlayer(`Choque de cabezas con ${seg.snake.name}`);
              killSnake(seg.snake, `Choque de cabezas con ${player.name}`, player);
              return;
            }
          }

          if (distance < HEAD_RADIUS + SEGMENT_RADIUS - 2) {
            killPlayer(`Chocaste contra ${seg.snake.name}`);
            return;
          }
        }

        // Comer orbes
        eatNearbyOrbs(player);

        // Sincronizar Vue
        score.value       = player.score;
        snakeLength.value = player.length;
        turboActive.value = player.turboActive;
        turboFuel.value   = Math.round(player.turboFuel);
      }

      // Bots
      for (const bot of bots) {
        if (!bot.alive) continue;
        const nb = spatialOrbs.query(bot.head.x, bot.head.y, 250);
        bot.step(nb, allSnakes);

        // Bot colisiona con jugador o entre bots
        const bDangerSegs = spatialSnakes.query(bot.head.x, bot.head.y, HEAD_RADIUS * 3);
        for (const seg of bDangerSegs) {
          if (seg.snake === bot) continue;
          const distance = dist(bot.head.x, bot.head.y, seg.x, seg.y);

          if (seg.isHead && distance < HEAD_RADIUS * 2) {
            const outcome = resolveHeadToHeadCollision(bot, seg.snake);
            if (outcome === 'attacker') {
              killSnake(bot, `Chocaste contra ${seg.snake.name}`);
              break;
            }
            if (outcome === 'defender') {
              killSnake(seg.snake, `Fue golpeado por ${bot.name}`, bot);
              break;
            }
            if (outcome === 'both') {
              killSnake(bot, `Choque de cabezas con ${seg.snake.name}`);
              killSnake(seg.snake, `Choque de cabezas con ${bot.name}`, bot);
              break;
            }
          }

          if (distance < HEAD_RADIUS + SEGMENT_RADIUS - 2) {
            killSnake(bot, `Chocaste contra ${seg.snake.name}`);
            break;
          }
        }

        if (bot.alive) eatNearbyOrbs(bot);
      }

      // Reponer orbes
      while (orbs.filter(o => o).length < ORB_COUNT_MAX) {
        orbs.push(new Orb());
      }

      // Actualizar leaderboard
      updateLeaderboard(allSnakes);
    }

    function eatNearbyOrbs(snake) {
      const eat = spatialOrbs.query(snake.head.x, snake.head.y, HEAD_RADIUS + ORB_RADIUS * 2);
      for (const orb of eat) {
        const d = dist(snake.head.x, snake.head.y, orb.x, orb.y);
        if (d < HEAD_RADIUS + orb.r) {
          // Consumir orbe
          const idx = orbs.indexOf(orb);
          if (idx !== -1) {
            orbs.splice(idx, 1);
            snake.score += orb.value;
            snake.growQueue += GROW_PER_ORB;
          }
        }
      }
    }

    function spawnDeathOrbsFromSnake(snake) {
      const count = Math.min(snake.length * 2, 120);
      for (let i = 0; i < count; i++) {
        const seg = snake.segments[i % snake.segments.length];
        if (!seg) continue;
        orbs.push(new Orb(
          seg.x + rand(-SEGMENT_RADIUS * 1.5, SEGMENT_RADIUS * 1.5),
          seg.y + rand(-SEGMENT_RADIUS * 1.5, SEGMENT_RADIUS * 1.5)
        ));
      }
    }

    function resolveHeadToHeadCollision(attacker, defender) {
      if (attacker.length === defender.length) return 'both';
      return attacker.length > defender.length ? 'defender' : 'attacker';
    }

    function killSnake(snake, cause, killer) {
      if (!snake.alive) return;
      snake.alive = false;

      if (snake === player) {
        killPlayer(cause);
        return;
      }

      spawnDeathOrbsFromSnake(snake);

      if (killer === player) {
        player.score += snake.length * 3;
        player.growQueue += snake.length;
      }

      respawnBot(snake);
    }

    function respawnBot(bot) {
      setTimeout(() => {
        bot.segments = [];
        const x = rand(200, WORLD_W - 200);
        const y = rand(200, WORLD_H - 200);
        const a = rand(0, Math.PI * 2);
        for (let i = 0; i < INITIAL_LENGTH; i++) {
          bot.segments.push({ x: x - Math.cos(a) * i * SEGMENT_SPACING, y: y - Math.sin(a) * i * SEGMENT_SPACING });
        }
        bot.angle = a;
        bot.targetAngle = a;
        bot.score = 0;
        bot.growQueue = 0;
        bot.alive = true;
      }, 3000);
    }

    function killPlayer(cause) {
      player.alive = false;
      deathCause.value = cause;
      spawnDeathOrbsFromSnake(player);

      if (player.score > bestScore.value) {
        bestScore.value = player.score;
        localStorage.setItem('slither_best', String(player.score));
      }

      cancelAnimationFrame(animId);
      setTimeout(() => { screen.value = 'gameover'; }, 1200);
    }

    // ── Leaderboard ──────────────────────────────────────
    function updateLeaderboard(allSnakes) {
      const entries = [...bots.filter(b => b.alive), player]
        .map(s => ({ name: s.name, score: s.score, isPlayer: s.isPlayer }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 7);
      leaderboard.value = entries;
    }

    // ── Cámara ───────────────────────────────────────────
    function computeCamera() {
      const canvas = gameCanvas.value;
      const cx = player.alive ? player.head.x - canvas.width  / 2 : WORLD_W / 2 - canvas.width / 2;
      const cy = player.alive ? player.head.y - canvas.height / 2 : WORLD_H / 2 - canvas.height / 2;
      return { x: cx, y: cy };
    }

    // ── Renderizado ─────────────────────────────────────
    function render() {
      const canvas = gameCanvas.value;
      const w = canvas.width, h = canvas.height;
      const cam = computeCamera();

      ctx.clearRect(0, 0, w, h);

      // ── Fondo: grilla del mundo
      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // Fondo sólido
      ctx.fillStyle = '#070b14';
      ctx.fillRect(cam.x, cam.y, w, h);

      // Grilla
      ctx.strokeStyle = 'rgba(0,200,255,0.05)';
      ctx.lineWidth   = 1;
      const gridSize  = 80;
      const startX    = Math.floor(cam.x / gridSize) * gridSize;
      const startY    = Math.floor(cam.y / gridSize) * gridSize;
      for (let gx = startX; gx < cam.x + w; gx += gridSize) {
        ctx.beginPath(); ctx.moveTo(gx, cam.y); ctx.lineTo(gx, cam.y + h); ctx.stroke();
      }
      for (let gy = startY; gy < cam.y + h; gy += gridSize) {
        ctx.beginPath(); ctx.moveTo(cam.x, gy); ctx.lineTo(cam.x + w, gy); ctx.stroke();
      }

      // Borde del mundo
      ctx.strokeStyle = 'rgba(255,61,107,0.5)';
      ctx.lineWidth   = 8;
      ctx.strokeRect(4, 4, WORLD_W - 8, WORLD_H - 8);
      ctx.strokeStyle = 'rgba(255,61,107,0.15)';
      ctx.lineWidth   = 40;
      ctx.strokeRect(4, 4, WORLD_W - 8, WORLD_H - 8);

      // Orbes
      const visOrbs = spatialOrbs.query(cam.x + w / 2, cam.y + h / 2, Math.max(w, h) * 0.75);
      for (const orb of visOrbs) {
        orb.draw(ctx);
      }

      // Bots
      for (const bot of bots) {
        if (!bot.alive) continue;
        // Sólo dibujar si visible
        const hb = bot.head;
        if (hb.x < cam.x - 200 || hb.x > cam.x + w + 200 ||
            hb.y < cam.y - 200 || hb.y > cam.y + h + 200) continue;
        bot.draw(ctx);
      }

      // Jugador
      if (player.alive) player.draw(ctx);

      ctx.restore();

      // Minimapa
      drawMinimap(cam, w, h);
    }

    function drawMinimap(cam, canvasW, canvasH) {
      const mmW = 120, mmH = 120;
      const mmX = 14, mmY = canvasH - mmH - 14;
      const scaleX = mmW / WORLD_W;
      const scaleY = mmH / WORLD_H;

      ctx.save();
      ctx.globalAlpha = 0.85;

      // Fondo minimapa
      ctx.fillStyle = 'rgba(13,21,37,0.9)';
      ctx.beginPath();
      ctx.roundRect(mmX, mmY, mmW, mmH, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(26,45,80,1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Borde mundo
      ctx.strokeStyle = 'rgba(255,61,107,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mmX, mmY, mmW, mmH);

      // Bots
      for (const bot of bots) {
        if (!bot.alive) continue;
        const bx = mmX + bot.head.x * scaleX;
        const by = mmY + bot.head.y * scaleY;
        ctx.beginPath();
        ctx.arc(bx, by, 2, 0, Math.PI * 2);
        ctx.fillStyle = bot.palette.head;
        ctx.fill();
      }

      // Jugador
      if (player.alive) {
        const px = mmX + player.head.x * scaleX;
        const py = mmY + player.head.y * scaleY;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = player.palette.head;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Viewport rect en minimapa
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        mmX + cam.x * scaleX,
        mmY + cam.y * scaleY,
        gameCanvas.value.width  * scaleX,
        gameCanvas.value.height * scaleY
      );

      ctx.restore();
    }

    // ── Loop principal ───────────────────────────────────
    function loop() {
      update();
      render();
      animId = requestAnimationFrame(loop);
    }

    // ── Resize ───────────────────────────────────────────
    function onResize() {
      if (!gameCanvas.value) return;
      gameCanvas.value.width  = window.innerWidth;
      gameCanvas.value.height = window.innerHeight;
    }

    window.addEventListener('resize', onResize);

    // ── Controles de pantalla ────────────────────────────
    function startGame() {
      if (!playerName.value.trim()) return;
      screen.value = 'game';
      paused.value = false;
      keys = {};
      lastMouseX = null; lastMouseY = null;

      nextTick(() => {
        initCanvas();
        createWorld();
        setupInput();
        loop();
      });
    }

    function restartGame() {
      cancelAnimationFrame(animId);
      screen.value = 'game';
      paused.value = false;
      keys = {};
      lastMouseX = null; lastMouseY = null;
      score.value = 0;
      snakeLength.value = INITIAL_LENGTH;
      turboFuel.value   = 100;
      turboActive.value = false;

      nextTick(() => {
        initCanvas();
        createWorld();
        setupInput();
        loop();
      });
    }

    function goToMenu() {
      cancelAnimationFrame(animId);
      screen.value = 'menu';
      paused.value = false;
      nextTick(() => nameInput.value?.focus());
    }

    function togglePause() {
      paused.value = !paused.value;
      if (!paused.value) loop(); // reanudar loop
      else cancelAnimationFrame(animId);
    }

    onMounted(() => {
      nextTick(() => nameInput.value?.focus());
    });

    onUnmounted(() => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    });

    // Atajo ESC → pausa
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && screen.value === 'game') togglePause();
    });

    return {
      // estado UI
      screen, playerName, selectedColor, snakeColors,
      score, snakeLength, turboActive, turboFuel,
      paused, bestScore, deathCause, leaderboard,
      // refs
      nameInput, gameCanvas,
      // métodos
      startGame, restartGame, goToMenu, togglePause,
    };
  }
}).mount('#app');