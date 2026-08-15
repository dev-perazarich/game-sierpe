/**
 * nest.js — «Nido». Supervivencia por oleadas con mejoras entre rondas.
 *
 * El modo con más rejugabilidad del proyecto: cada partida construye una
 * serpiente distinta a partir de las cartas que te tocan. También es el que más
 * aprovecha el sistema de personalidades, porque lo que sube por oleada es la
 * habilidad y la agresividad de los bots, nunca su velocidad.
 *
 * Las cartas se descartan al terminar. No hay progresión permanente que rompa el
 * equilibrio: lo que se lleva de una partida a otra es lo que has aprendido.
 */

import { defineMode, uniqueName, formatTime } from './Mode.js';
import { BOT_NAMES, orbsForWorld } from '../config.js';
import { botSkin, hslHex, buildSkin } from '../themes/index.js';
import { EV } from '../engine/events.js';
import { ORB_KIND } from '../entities/Orb.js';
import { rgba, clamp } from '../engine/math.js';
import { describeCause } from './classic.js';

const WAVE_CALM = 15;
const BOSS_EVERY = 5;

/** Las 18 cartas. Cada una modifica el estado del jugador de forma legible. */
export const CARDS = [
  { id: 'turbo_barato',  name: 'Turbo eficiente',   desc: 'El turbo cuesta un 30 % menos de masa.',        apply: (s, m) => { m.boostDiscount += 0.3; } },
  { id: 'giro',          name: 'Giro cerrado',      desc: 'Giras un 25 % más rápido.',                     apply: (s) => { s.turnMul *= 1.25; } },
  { id: 'iman',          name: 'Imán de orbes',     desc: 'Atraes comida desde mucho más lejos.',          apply: (s) => { s.magnetMul *= 2.2; } },
  { id: 'escudo',        name: 'Escudo',            desc: 'Absorbe un impacto mortal.',                    apply: (s) => { s.shield += 1; } },
  { id: 'puas',          name: 'Cola de púas',      desc: 'Tras cada muerte tuya, 5 s de púas letales.',   apply: (s, m) => { m.spikesOnKill = 5; } },
  { id: 'radar',         name: 'Radar',             desc: 'Marca en pantalla las amenazas cercanas.',      apply: (s, m) => { m.radar = true; } },
  { id: 'robo',          name: 'Carroñero',         desc: 'Ganas un 50 % más de masa al eliminar.',        apply: (s, m) => { m.killBonus += 0.5; } },
  { id: 'grosor',        name: 'Compacta',          desc: 'Misma masa, cuerpo más corto y manejable.',     apply: (s, m) => { m.arcScale *= 0.78; } },
  { id: 'sprint',        name: 'Arranque',          desc: 'El turbo es un 12 % más rápido.',               apply: (s, m) => { m.boostSpeed += 0.12; } },
  { id: 'regen',         name: 'Metabolismo',       desc: 'Recuperas 0,8 de masa por segundo.',            apply: (s, m) => { m.regen += 0.8; } },
  { id: 'vision',        name: 'Visión amplia',     desc: 'La cámara se aleja: ves venir más cosas.',      apply: (s, m) => { m.zoomOut += 0.12; } },
  { id: 'cosecha',       name: 'Cosecha',           desc: 'Cada orbe alimenta un 35 % más.',               apply: (s, m) => { m.eatBonus += 0.35; } },
  { id: 'inmune',        name: 'Reflejos',          desc: 'Duplica la gracia al reaparecer y al golpear.', apply: (s, m) => { m.invulnBonus += 1.2; } },
  { id: 'veneno',        name: 'Antídoto',          desc: 'El veneno del jefe ya no te afecta.',           apply: (s, m) => { m.poisonImmune = true; } },
  { id: 'eco',           name: 'Eco',               desc: 'Los orbes de tu turbo valen el doble.',         apply: (s, m) => { m.boostOrbBonus += 1; } },
  { id: 'segunda',       name: 'Segunda piel',      desc: 'Otro escudo, y se recarga cada 3 oleadas.',     apply: (s, m) => { s.shield += 1; m.shieldRegen = 3; } },
  { id: 'cebo',          name: 'Cebo',              desc: 'Los orbes de muerte cercanos vuelan hacia ti.', apply: (s, m) => { m.deathMagnet = true; } },
  { id: 'furia',         name: 'Furia',             desc: 'Bajo 40 de masa, giras y aceleras mucho mejor.',apply: (s, m) => { m.rage = true; } },
];

export default defineMode({
  id: 'nest',
  name: 'Nido',
  short: 'Oleadas, jefes y una carta de mejora entre ronda y ronda.',
  duration: null,
  friendlyFire: true,
  orbHues: [95, 140, 35, 15],

  setup(world) {
    // Deliberadamente el mapa más pequeño de los cinco: en Nido no hay dónde
    // esconderse, y esa claustrofobia es el modo.
    const W = 3800, H = 3800;
    world.setWorldSize(W, H);
    world.orbTarget = orbsForWorld(W, H, 1.4);

    const theme = world.settings.themeObj;
    world.spawnPlayer(world.playerConfig.skin, world.playerConfig.name);
    world.fillOrbs(world.orbTarget);

    this.wave = 0;
    this.phase = 'calm';       // 'calm' | 'wave'
    this.timer = 6;            // margen antes de la primera oleada
    this.waveTime = 0;
    this.pendingCards = null;
    this.awaitingChoice = false;
    this.boss = null;
    this.botIndex = 0;
    this.deck = CARDS.slice();
    this.taken = [];

    // Modificadores acumulados por las cartas.
    this.mods = {
      boostDiscount: 0, killBonus: 0, eatBonus: 0, arcScale: 1,
      boostSpeed: 0, regen: 0, zoomOut: 0, invulnBonus: 0,
      spikesOnKill: 0, radar: false, poisonImmune: false,
      boostOrbBonus: 0, shieldRegen: 0, deathMagnet: false, rage: false,
    };
  },

  tick(world, dt) {
    if (this.awaitingChoice) return;   // el mundo se congela mientras eliges carta

    this._applyMods(world, dt);
    this.timer -= dt;

    if (this.phase === 'calm') {
      if (this.timer <= 0) this._startWave(world);
      return;
    }

    this.waveTime += dt;
    this._tickBoss(world, dt);

    // La oleada acaba cuando no queda ningún atacante vivo.
    const enemies = world.bots.filter((s) => s.alive);
    if (enemies.length === 0) this._endWave(world);
  },

  _applyMods(world, dt) {
    const p = world.player;
    if (!p || !p.alive) return;
    const m = this.mods;

    if (m.regen > 0) p.grow(m.regen * dt);

    if (m.rage) {
      const raging = p.mass < 40;
      p.turnMul = raging ? 1.5 : 1;
      p.speedMul = raging ? 1.12 : 1;
    }
  },

  _startWave(world) {
    this.wave++;
    this.phase = 'wave';
    this.waveTime = 0;
    this.timer = Infinity;

    const isBoss = this.wave % BOSS_EVERY === 0;
    const theme = world.settings.themeObj;
    const base = world.settings.difficultyValue;

    // Lo que escala es la HABILIDAD, no la velocidad. Un bot de oleada 15
    // reacciona en 90 ms y apenas falla el ángulo; corre exactamente igual.
    const waveDifficulty = clamp(base + this.wave * 0.045, 0.15, 0.99);
    const count = Math.min(14, 3 + Math.floor(this.wave * 0.8));
    const mass = 18 + this.wave * 6;

    for (let i = 0; i < count; i++) {
      const bot = world.spawnBot({
        skin: botSkin(this.botIndex++, theme),
        name: uniqueName(world, BOT_NAMES, this.botIndex),
        mass: mass * world.rng.range(0.75, 1.25),
        difficulty: waveDifficulty,
      });
      // La agresividad también sube: las oleadas tardías te buscan de verdad.
      bot.brain.traits.agresividad = clamp(bot.brain.traits.agresividad + this.wave * 0.03, 0, 0.99);
      bot.brain.traits.cautela = clamp(bot.brain.traits.cautela - this.wave * 0.015, 0.05, 1);
    }

    if (isBoss) this._spawnBoss(world, waveDifficulty);

    world.events.emit(EV.WAVE_START, { wave: this.wave, boss: isBoss, count });
  },

  _spawnBoss(world, difficulty) {
    const theme = world.settings.themeObj;
    const hue = (this.wave * 37) % 360;
    const skin = buildSkin({
      primary: hslHex(hue, 78, 52),
      secondary: hslHex((hue + 180) % 360, 70, 32),
      pattern: 'pulso', eyes: 'visor', trail: 'humo',
    }, theme);

    this.boss = world.spawnBot({
      skin,
      name: `JEFE · ${bossName(this.wave)}`,
      mass: 220 + this.wave * 30,
      difficulty: Math.min(0.99, difficulty + 0.15),
      kind: 'boss',
    });
    this.boss.kind = 'boss';
    this.boss.brain.traits.agresividad = 0.95;
    this.boss.brain.traits.paciencia = 0.85;
    this.boss.poisonTimer = 0;

    world.events.emit(EV.BOSS, { snake: this.boss, wave: this.wave });
  },

  /** El jefe deja un rastro venenoso que resta masa a quien lo cruza. */
  _tickBoss(world, dt) {
    const b = this.boss;
    if (!b || !b.alive) { if (b && !b.alive) this.boss = null; return; }

    b.poisonTimer -= dt;
    if (b.poisonTimer > 0) return;
    b.poisonTimer = 0.5;

    const t = b.spine;
    const tx = t[t.length - 2], ty = t[t.length - 1];
    world.orbs.spawn(tx, ty, {
      r: 8, kind: ORB_KIND.POISON, value: 3.2, hue: 95,
    });
  },

  _endWave(world) {
    this.phase = 'calm';
    this.timer = WAVE_CALM;
    this.boss = null;
    world.events.emit(EV.WAVE_END, { wave: this.wave });

    // Escudo que se recarga cada N oleadas
    if (this.mods.shieldRegen && this.wave % this.mods.shieldRegen === 0 && world.player.alive) {
      world.player.shield = Math.max(world.player.shield, 1);
    }

    this.pendingCards = this._drawCards(world, 3);
    this.awaitingChoice = this.pendingCards.length > 0;
  },

  _drawCards(world, n) {
    const pool = this.deck.filter((c) => !this.taken.includes(c.id));
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      const idx = world.rng.int(0, pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  },

  /** Lo llama la interfaz cuando el jugador elige. */
  chooseCard(world, cardId) {
    const card = this.pendingCards?.find((c) => c.id === cardId);
    if (!card) return;
    card.apply(world.player, this.mods);
    this.taken.push(card.id);
    this.pendingCards = null;
    this.awaitingChoice = false;
  },

  onEat(world, snake, orb) {
    if (orb.kind === ORB_KIND.POISON && snake.isPlayer && this.mods.poisonImmune) return 0;
    let v = orb.value;
    if (snake.isPlayer) {
      v *= 1 + this.mods.eatBonus;
      if (orb.kind === ORB_KIND.BOOST) v *= 1 + this.mods.boostOrbBonus;
    }
    return v;
  },

  onKill(world, victim, killer) {
    if (killer?.isPlayer) {
      if (this.mods.killBonus > 0) killer.grow(victim.mass * this.mods.killBonus * 0.35);
      if (this.mods.spikesOnKill > 0) killer.spikeTimer = this.mods.spikesOnKill;
    }
    // Los bots de una oleada no reaparecen: hay que limpiarla para avanzar.
    if (!victim.isPlayer) world.removeSnake(victim);
    if (victim === this.boss) this.boss = null;
  },

  isOver(world) {
    return !!world.player && !world.player.alive;
  },

  results(world) {
    const p = world.player;
    return {
      title: `Oleada ${this.wave}`,
      cause: describeCause(p),
      stats: [
        { label: 'Oleada', value: this.wave },
        { label: 'Longitud', value: Math.round(p.peakMass) },
        { label: 'Eliminaciones', value: p.kills },
        { label: 'Tiempo', value: formatTime(world.time) },
      ],
      extra: this.taken.length
        ? `Mejoras: ${this.taken.map((id) => CARDS.find((c) => c.id === id)?.name).join(' · ')}`
        : null,
      score: this.wave * 100 + p.kills * 25,
      metric: 'nestWave',
      wave: this.wave,
    };
  },

  hud(world) {
    return {
      primary: { label: 'Oleada', value: this.wave || '—', alert: this.boss !== null },
      secondary: this.phase === 'calm'
        ? { label: 'Siguiente', value: this.timer === Infinity ? '—' : formatTime(this.timer) }
        : { label: 'Enemigos', value: world.bots.filter((s) => s.alive).length },
      boss: this.boss ? { name: this.boss.name, mass: Math.round(this.boss.mass) } : null,
      cards: this.awaitingChoice ? this.pendingCards : null,
      taken: this.taken.map((id) => CARDS.find((c) => c.id === id)).filter(Boolean),
      paused: this.awaitingChoice,
    };
  },

  cameraZoomBonus() {
    return this.mods.zoomOut;
  },

  /** Radar: marca las amenazas en el borde de la pantalla. */
  drawHudCanvas(ctx, world, camera, theme, settings) {
    if (!this.mods.radar) return;
    const p = world.player;
    if (!p || !p.alive) return;

    const cx = camera.viewW / 2, cy = camera.viewH / 2;
    const margin = 46;

    ctx.save();
    for (const s of world.snakes) {
      if (!s.alive || s === p || s.mass < p.mass) continue;
      const sp = camera.worldToScreen(s.head.x, s.head.y);
      const onScreen = sp.x > 0 && sp.x < camera.viewW && sp.y > 0 && sp.y < camera.viewH;
      if (onScreen) continue;

      const a = Math.atan2(sp.y - cy, sp.x - cx);
      const rx = Math.min(cx - margin, Math.abs(Math.cos(a)) > 0.001 ? Math.abs((cx - margin) / Math.cos(a)) : 1e9);
      const ry = Math.min(cy - margin, Math.abs(Math.sin(a)) > 0.001 ? Math.abs((cy - margin) / Math.sin(a)) : 1e9);
      const r = Math.min(rx, ry);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;

      // save/restore por flecha: tocar setTransform aquí borraría la escala del
      // devicePixelRatio que el renderizador dejó puesta.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = s.kind === 'boss' ? '#ff4d6d' : rgba(s.skin.head, 0.9);
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-6, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
});

function bossName(wave) {
  const names = ['Uroboros', 'Nidhogg', 'Apofis', 'Jörmungandr', 'Vasuki', 'Tifón', 'Leviatán'];
  return names[(Math.floor(wave / BOSS_EVERY) - 1) % names.length];
}
