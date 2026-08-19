/**
 * fx.js — Partículas, sacudida de pantalla, hitstop y texto flotante.
 *
 * Todo lo que hace que las acciones se sientan. Se engancha al bus de eventos
 * del mundo, así que el motor no sabe nada de esto: se pueden quitar los efectos
 * enteros sin tocar una línea de lógica.
 *
 * Presupuesto duro de partículas por nivel de calidad. En calidad baja el sistema
 * se apaga entero en lugar de ir a tirones.
 */

import { CFG } from '../config.js';
import { EV } from '../engine/events.js';
import { rgba, clamp, mixHex } from '../engine/math.js';
import { particleSprite, tinted, drawSprite } from './sprites.js';

const TRAIL_CFG = {
  chispas:    { life: 0.55, size: 5,  gravity: 0 },
  burbujas:   { life: 0.7,  size: 4,  gravity: -6 },
  humo:       { life: 0.9,  size: 7,  gravity: -3 },
  fragmentos: { life: 0.5,  size: 3.5, gravity: 0 },
  fuego:      { life: 0.45, size: 6,  gravity: -18, color: (glow) => mixHex(glow, '#ff5500', 0.6) },
  nieve:      { life: 0.8,  size: 3.5, gravity: 4, color: '#c8e6ff' },
  arcoiris:   { life: 0.6,  size: 4.5, gravity: 0, color: () => rainbowColor() },
};

let _rainbowHue = 0;
function rainbowColor() {
  _rainbowHue = (_rainbowHue + 37) % 360;
  const { r, g, b } = hslToRgb(_rainbowHue / 360, 0.9, 0.6);
  return `rgb(${r},${g},${b})`;
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

class Particle {
  constructor() { this.alive = false; }
  spawn(x, y, vx, vy, life, size, color, opts = {}) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size;
    this.color = color;
    this.drag = opts.drag ?? 2.4;
    this.gravity = opts.gravity ?? 0;
    this.grow = opts.grow ?? 0;
    this.alive = true;
  }
}

class Ring {
  constructor() { this.alive = false; }
  spawn(x, y, r0, r1, life, color, width) {
    this.x = x; this.y = y;
    this.r0 = r0; this.r1 = r1;
    this.life = life; this.maxLife = life;
    this.color = color;
    this.width = width;
    this.alive = true;
  }
}

class FloatText {
  constructor() { this.alive = false; }
  spawn(x, y, text, color, life = 1.1, size = 14) {
    this.x = x; this.y = y;
    this.text = text; this.color = color;
    this.life = life; this.maxLife = life;
    this.size = size;
    this.alive = true;
  }
}

export class FX {
  constructor(settings) {
    this.settings = settings;
    this.particles = Array.from({ length: 1000 }, () => new Particle());
    this.rings = Array.from({ length: 48 }, () => new Ring());
    this.texts = Array.from({ length: 40 }, () => new FloatText());
    this.liveParticles = 0;
    this._cursor = 0;

    this.shake = { x: 0, y: 0, mag: 0 };
    this.hitstop = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.vignettePulse = 0;
    this.vignetteColor = '#ff3b30';
    this._unsub = [];
  }

  get budget() {
    const q = this.settings.resolvedQuality ?? this.settings.quality;
    return CFG.fx.particleBudget[q] ?? 340;
  }

  get reduced() {
    return this.settings.reducedMotion;
  }

  /** Se engancha a los eventos del mundo. Devuelve una función para soltarlos. */
  bind(world, theme) {
    this.unbind();
    this.theme = theme;
    const on = (type, fn) => this._unsub.push(world.events.on(type, fn));

    on(EV.EAT, ({ snake, orb, poison }) => {
      if (poison) {
        this.burst(orb.x, orb.y, 8, '#8bd450', { speed: 90, life: 0.5, size: 4 });
        return;
      }
      const n = snake.isPlayer ? 6 : 2;
      this.burst(orb.x, orb.y, n, `hsl(${orb.hue},95%,68%)`, { speed: 70, life: 0.32, size: orb.r * 0.9 });
    });

    on(EV.BOOST_DROP, ({ snake, x, y }) => {
      this.burst(x, y, 2, snake.skin.glow, { speed: 40, life: 0.5, size: 4.5, drag: 3.4 });
    });

    on(EV.KILL, ({ killer, victim }) => {
      const h = victim.head;
      const mag = clamp(victim.radius / 6, 0.6, 3.2);
      this.ring(h.x, h.y, victim.radius, victim.radius * 9, 0.55, victim.skin.glow, 4);
      this.burst(h.x, h.y, Math.round(18 * mag), victim.skin.head, { speed: 260, life: 0.8, size: 6, drag: 1.6 });
      if (killer?.isPlayer) {
        this.addShake(6 * mag);
        this.hitstop = CFG.fx.hitstop;
        this.floatText(h.x, h.y, `+${Math.round(victim.mass * CFG.scoring.killMassShare)}`, '#ffd15c', 1.2, 18);
      } else if (victim.isPlayer) {
        this.addShake(9);
      }
    });

    on(EV.DEATH, ({ snake, killer }) => {
      if (killer) return;   // ya lo cubre EV.KILL
      const h = snake.head;
      this.ring(h.x, h.y, snake.radius, snake.radius * 7, 0.5, snake.skin.glow, 3);
      this.burst(h.x, h.y, 14, snake.skin.head, { speed: 200, life: 0.7, size: 5 });
      if (snake.isPlayer) { this.addShake(11); this.flashScreen('#ff3b52', 0.35); }
    });

    on(EV.PICKUP, ({ snake, power, x, y }) => {
      this.ring(x, y, 8, 70, 0.45, '#9fe8ff', 3);
      this.burst(x, y, 12, '#9fe8ff', { speed: 150, life: 0.6, size: 5 });
      if (snake.isPlayer) this.floatText(x, y, power.name, '#9fe8ff', 1.3, 16);
    });

    on(EV.STREAK, ({ x, y, mult }) => {
      this.ring(x, y, 10, 90, 0.5, '#ffd15c', 3);
      this.floatText(x, y, `×${mult}`, '#ffd15c', 1.1, 22);
    });

    on(EV.ZONE_PHASE, ({ phase, closing }) => {
      if (closing) { this.flashScreen('#ff6b4a', 0.2); this.addShake(4); }
    });

    on(EV.WAVE_START, ({ wave, boss }) => {
      this.flashScreen(boss ? '#ff4d6d' : '#7be8c1', 0.25);
      if (boss) this.addShake(10);
    });

    on(EV.NODE_CAP, ({ node, team }) => {
      this.ring(node.x, node.y, node.r * 0.4, node.r * 1.6, 0.7, team.color, 5);
    });

    return () => this.unbind();
  }

  unbind() {
    for (const fn of this._unsub) fn();
    this._unsub.length = 0;
  }

  // ── Emisores ──────────────────────────────────────────────

  /**
   * Reserva una partícula del pool.
   *
   * Con un cursor y un contador en vez de escanear el pool entero: emitir una
   * ráfaga de 60 partículas con búsqueda lineal sobre 1000 huecos costaba 60.000
   * iteraciones, y las ráfagas ocurren justo en el fotograma de una muerte, que
   * es el peor momento posible para gastar milisegundos.
   */
  _freeParticle() {
    if (this.reduced) return null;
    const budget = this.budget;
    if (budget === 0 || this.liveParticles >= budget) return null;

    const pool = this.particles;
    const n = pool.length;
    for (let i = 0; i < n; i++) {
      const idx = this._cursor;
      this._cursor = (this._cursor + 1) % n;
      if (!pool[idx].alive) {
        this.liveParticles++;
        return pool[idx];
      }
    }
    return null;
  }

  burst(x, y, count, color, { speed = 120, life = 0.6, size = 5, drag = 2.4, gravity = 0, spread = Math.PI * 2, angle = 0 } = {}) {
    if (this.reduced || this.budget === 0) return;
    for (let i = 0; i < count; i++) {
      const p = this._freeParticle();
      if (!p) return;
      const a = angle + (Math.random() - 0.5) * spread;
      const sp = speed * (0.45 + Math.random() * 0.75);
      p.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        life * (0.7 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8),
        color, { drag, gravity });
    }
  }

  /** Estela de turbo: se llama cada paso desde el renderizador. */
  trail(snake, theme, trailType = 'chispas') {
    if (this.reduced || this.budget === 0) return;
    if (!snake.boosting) return;
    if (Math.random() > 0.55) return;
    const p = this._freeParticle();
    if (!p) return;
    const t = snake.spine;
    const tx = t[t.length - 2], ty = t[t.length - 1];
    const a = snake.angle + Math.PI + (Math.random() - 0.5) * 1.1;
    const base = theme.particles?.trail ?? {};
    const cfg = TRAIL_CFG[trailType] ?? TRAIL_CFG['chispas'];
    const life = cfg.life ?? base.life ?? 0.55;
    const size = (cfg.size ?? base.size ?? 5) * (0.6 + Math.random() * 0.7);
    const color = cfg.color ? (typeof cfg.color === 'function' ? cfg.color(snake.skin.glow) : cfg.color) : snake.skin.glow;
    const gravity = cfg.gravity ?? base.gravity ?? 0;
    p.spawn(tx, ty, Math.cos(a) * 60, Math.sin(a) * 60, life, size, color, { drag: 2.8, gravity });
  }

  ring(x, y, r0, r1, life, color, width = 3) {
    if (this.reduced) return;
    const r = this.rings.find((k) => !k.alive);
    if (r) r.spawn(x, y, r0, r1, life, color, width);
  }

  floatText(x, y, text, color, life = 1.1, size = 14) {
    const t = this.texts.find((k) => !k.alive);
    if (t) t.spawn(x, y, text, color, life, size);
  }

  addShake(mag) {
    if (this.reduced || !this.settings.screenShake) return;
    this.shake.mag = Math.min(26, this.shake.mag + mag);
  }

  flashScreen(color, strength) {
    if (this.reduced) return;
    this.flash = Math.max(this.flash, strength);
    this.flashColor = color;
  }

  pulseVignette(strength, color = '#ff3b30') {
    this.vignettePulse = Math.max(this.vignettePulse, strength);
    this.vignetteColor = color;
  }

  // ── Actualización y dibujo ────────────────────────────────

  update(dt) {
    if (this.hitstop > 0) { this.hitstop -= dt; }

    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; this.liveParticles--; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grow) p.size += p.grow * dt;
    }

    for (const r of this.rings) {
      if (!r.alive) continue;
      r.life -= dt;
      if (r.life <= 0) r.alive = false;
    }

    for (const t of this.texts) {
      if (!t.alive) continue;
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) t.alive = false;
    }

    // Sacudida: decae exponencialmente y se muestrea con ruido, no con seno
    // (un seno se lee como vibración mecánica, no como impacto).
    if (this.shake.mag > 0.05) {
      this.shake.mag *= Math.exp(-CFG.fx.shakeDecay * dt);
      this.shake.x = (Math.random() - 0.5) * 2 * this.shake.mag;
      this.shake.y = (Math.random() - 0.5) * 2 * this.shake.mag;
    } else {
      this.shake.mag = 0; this.shake.x = 0; this.shake.y = 0;
    }

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.vignettePulse > 0) this.vignettePulse = Math.max(0, this.vignettePulse - dt * 1.4);
  }

  /** Partículas y anillos: en coordenadas de mundo. */
  drawWorld(ctx) {
    const sprite = particleSprite();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.particles) {
      if (!p.alive) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      drawSprite(ctx, tinted(sprite, p.color), p.x, p.y, p.size * 3.2 * (0.5 + a * 0.5), a * 0.85);
    }

    for (const r of this.rings) {
      if (!r.alive) continue;
      const t = 1 - r.life / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(t);
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Texto flotante: en pantalla, para que no se deforme con el zoom. */
  drawTexts(ctx, camera) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      if (!t.alive) continue;
      const p = camera.worldToScreen(t.x, t.y);
      const a = clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `800 ${t.size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(t.text, p.x, p.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, p.y);
    }
    ctx.restore();
  }

  /** Destello y viñeta: capa de pantalla completa, encima de todo. */
  drawOverlay(ctx, w, h) {
    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(this.flashColor, this.flash * 0.55);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (this.vignettePulse > 0.001) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, rgba(this.vignetteColor, 0));
      g.addColorStop(1, rgba(this.vignetteColor, this.vignettePulse * 0.75));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  clear() {
    for (const p of this.particles) p.alive = false;
    this.liveParticles = 0;
    this._cursor = 0;
    for (const r of this.rings) r.alive = false;
    for (const t of this.texts) t.alive = false;
    this.shake.mag = 0; this.shake.x = 0; this.shake.y = 0;
    this.flash = 0;
    this.vignettePulse = 0;
    this.hitstop = 0;
  }
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
