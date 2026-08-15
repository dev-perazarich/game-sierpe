/*
 * Sierpe — grabación y reproducción de fantasmas.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * ghost.js — Un "fantasma" es la partida de otra persona reproducida junto a la
 * tuya, para competir contra ella sin necesidad de que esté conectada.
 *
 * ── Por qué se graba la TRAYECTORIA y no las entradas ──
 *
 * La tentación es grabar solo las entradas: el mundo es determinista (misma
 * semilla → mismo mapa, mismos bots, mismos orbes), así que re-simular con las
 * mismas entradas debería reproducir la partida exacta ocupando unos bytes.
 *
 * No funciona entre dispositivos. ECMAScript no exige que Math.sin, Math.cos ni
 * Math.atan2 den resultados idénticos bit a bit entre implementaciones, y este
 * motor los usa en cada cálculo de ángulo. Dos navegadores distintos divergen a
 * los pocos segundos y el fantasma acaba en otro sitio, sin forma de detectarlo.
 *
 * Grabar la trayectoria cuesta unos 11 KB por partida de tres minutos y es
 * inmune al problema: lo que se reproduce son posiciones, no cálculos.
 *
 * ── Formato ──
 *
 * Muestreo a 10 Hz (el cuerpo se reconstruye con la misma cadena que usa el
 * juego, así que no hace falta más resolución). Por muestra: desplazamiento en
 * x e y como enteros de 16 bits con precisión de media unidad, y la masa como
 * entero de 16 bits. Seis bytes por muestra, codificado en base64 para que
 * viaje como texto.
 */

import { CFG } from '../config.js';

export const GHOST_VERSION = 1;
export const SAMPLE_HZ = 10;
const SAMPLE_DT = 1 / SAMPLE_HZ;
const POS_SCALE = 2;        // media unidad de precisión
const MASS_SCALE = 4;       // masa hasta ~16.000 en 16 bits

/* ═══════════════ Grabación ═══════════════ */

export class GhostRecorder {
  constructor(meta) {
    this.meta = meta;           // { seed, dateKey, mode, name, skin }
    this.samples = [];          // [{x, y, mass}]
    this.acc = 0;
    this.duration = 0;
    this.stopped = false;
  }

  /** Se llama en cada paso de simulación. */
  tick(dt, snake) {
    if (this.stopped) return;
    this.duration += dt;
    this.acc += dt;
    if (this.acc < SAMPLE_DT) return;
    this.acc -= SAMPLE_DT;

    // Muerto: se repite la última posición para que el fantasma se quede
    // quieto en lugar de desaparecer. Marca dónde falló, que es información
    // útil para quien compite contra él.
    const last = this.samples[this.samples.length - 1];
    if (!snake || !snake.alive) {
      if (last) this.samples.push({ x: last.x, y: last.y, mass: last.mass });
      return;
    }
    this.samples.push({ x: snake.head.x, y: snake.head.y, mass: snake.mass });
  }

  stop() { this.stopped = true; }

  /** @returns {object|null} registro serializable, o null si es demasiado corto */
  build(score) {
    if (this.samples.length < SAMPLE_HZ) return null;   // menos de un segundo
    return {
      v: GHOST_VERSION,
      seed: this.meta.seed,
      date: this.meta.dateKey,
      mode: this.meta.mode,
      name: (this.meta.name ?? '').slice(0, 18),
      skin: this.meta.skin,
      score: Math.round(score),
      duration: Math.round(this.duration * 100) / 100,
      count: this.samples.length,
      data: encodeSamples(this.samples),
    };
  }
}

/* ═══════════════ Codificación ═══════════════ */

const HEADER_BYTES = 6;
const SAMPLE_BYTES = 6;

function encodeSamples(samples) {
  const n = samples.length;
  // Cabecera con la muestra 0 completa; el resto van como desplazamientos.
  // Que la muestra 0 NO tenga delta importa: si lo tuviera, manipularla no
  // pasaría por la comprobación de velocidad, que solo puede mirar diferencias
  // entre muestras consecutivas.
  const buf = new ArrayBuffer(HEADER_BYTES + (n - 1) * SAMPLE_BYTES);
  const view = new DataView(buf);

  view.setUint16(0, clampU16(Math.round(samples[0].x * POS_SCALE)));
  view.setUint16(2, clampU16(Math.round(samples[0].y * POS_SCALE)));
  view.setUint16(4, clampU16(Math.round(samples[0].mass * MASS_SCALE)));

  // Se acumula sobre la posición RECONSTRUIDA, no sobre la original. Si se
  // calculan los deltas contra el valor real, cada uno introduce hasta media
  // unidad de error y el decodificador los va sumando: en tres minutos la
  // deriva medida llegaba a 15 px. Reproduciendo aquí lo que hará el
  // decodificador, el error queda acotado a la cuantización para siempre.
  let px = view.getUint16(0) / POS_SCALE;
  let py = view.getUint16(2) / POS_SCALE;

  for (let i = 1; i < n; i++) {
    const s = samples[i];
    const o = HEADER_BYTES + (i - 1) * SAMPLE_BYTES;
    const dx = clampI16(Math.round((s.x - px) * POS_SCALE));
    const dy = clampI16(Math.round((s.y - py) * POS_SCALE));
    view.setInt16(o, dx);
    view.setInt16(o + 2, dy);
    view.setUint16(o + 4, clampU16(Math.round(s.mass * MASS_SCALE)));
    px += dx / POS_SCALE;
    py += dy / POS_SCALE;
  }
  return bytesToBase64(new Uint8Array(buf));
}

export function decodeSamples(b64, count) {
  const bytes = base64ToBytes(b64);
  if (bytes.byteLength < HEADER_BYTES) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let x = view.getUint16(0) / POS_SCALE;
  let y = view.getUint16(2) / POS_SCALE;
  const out = [{ x, y, mass: view.getUint16(4) / MASS_SCALE }];

  for (let i = 1; i < count; i++) {
    const o = HEADER_BYTES + (i - 1) * SAMPLE_BYTES;
    if (o + SAMPLE_BYTES > bytes.byteLength) break;
    x += view.getInt16(o) / POS_SCALE;
    y += view.getInt16(o + 2) / POS_SCALE;
    out.push({ x, y, mass: view.getUint16(o + 4) / MASS_SCALE });
  }
  return out;
}

const clampU16 = (v) => Math.max(0, Math.min(65535, Math.round(v)));
const clampI16 = (v) => Math.max(-32768, Math.min(32767, v));

function bytesToBase64(bytes) {
  let s = '';
  // Por trozos: pasar 60.000 argumentos de golpe a fromCharCode desborda la pila.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ═══════════════ Reproducción ═══════════════ */

/**
 * Reproduce un registro sobre una serpiente que solo existe para verse.
 *
 * El fantasma NO participa en la simulación: no colisiona, no come y los bots
 * no lo perciben. Es una referencia visual, y mezclarlo con el mundo real
 * arruinaría el determinismo del desafío diario para todos los demás.
 */
export class GhostPlayer {
  constructor(record, snake) {
    this.record = record;
    this.snake = snake;
    this.samples = decodeSamples(record.data, record.count);
    this.time = 0;
    this.finished = false;
    this.snake.isGhost = true;
    this.snake.alive = true;
    if (this.samples.length) this._apply(this.samples[0]);
  }

  get duration() { return this.record.duration; }

  /** Distancia en puntuación respecto al jugador, para el marcador. */
  get score() { return this.record.score; }

  update(dt) {
    if (this.finished || !this.samples.length) return;
    this.time += dt;

    const f = this.time / SAMPLE_DT;
    const i = Math.floor(f);

    if (i >= this.samples.length - 1) {
      this._apply(this.samples[this.samples.length - 1]);
      this.finished = true;
      return;
    }

    // Interpolación entre muestras: a 10 Hz, sin esto el fantasma daría saltos.
    const a = this.samples[i];
    const b = this.samples[i + 1];
    const t = f - i;
    this._apply({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      mass: a.mass + (b.mass - a.mass) * t,
    });
  }

  _apply(s) {
    this.snake.setReplayPose(s.x, s.y, s.mass);
  }
}

/* ═══════════════ Validación ═══════════════ */

/**
 * Comprueba que un registro es coherente antes de aceptarlo.
 *
 * No es un antitrampas: un cliente puede fabricar una trayectoria válida y una
 * puntuación falsa, y sin servidor autoritativo eso no tiene solución. Lo que
 * sí hace es descartar lo imposible —velocidades por encima del máximo del
 * juego, duraciones que no cuadran, datos corruptos—, que filtra tanto los
 * errores honestos como el fraude perezoso.
 */
export function validateGhost(record, { maxDuration = 200 } = {}) {
  const fail = (razon) => ({ ok: false, razon });

  if (!record || record.v !== GHOST_VERSION) return fail('versión desconocida');
  if (typeof record.data !== 'string' || !record.data) return fail('sin datos');
  if (!Number.isFinite(record.count) || record.count < SAMPLE_HZ) return fail('demasiado corto');
  if (record.count > maxDuration * SAMPLE_HZ) return fail('demasiado largo');
  if (!Number.isFinite(record.score) || record.score < 0) return fail('puntuación inválida');

  let samples;
  try { samples = decodeSamples(record.data, record.count); }
  catch { return fail('datos corruptos'); }
  if (samples.length !== record.count) return fail('longitud inconsistente');

  // Velocidad máxima admisible, con margen por la cuantización y por los
  // potenciadores que aceleran.
  const maxStep = CFG.snake.boostSpeed * 1.35 * SAMPLE_DT + 4;
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dy = samples[i].y - samples[i - 1].y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return fail('posición inválida');
    if (Math.hypot(dx, dy) > maxStep) return fail(`velocidad imposible en la muestra ${i}`);
    if (!Number.isFinite(samples[i].mass) || samples[i].mass < 0) return fail('masa inválida');
  }

  const esperado = record.count / SAMPLE_HZ;
  if (Math.abs(record.duration - esperado) > 2) return fail('duración incoherente');

  return { ok: true, samples };
}

/** Tamaño aproximado del registro serializado, en KB. */
export function recordSizeKb(record) {
  return Math.round(JSON.stringify(record).length / 102.4) / 10;
}
