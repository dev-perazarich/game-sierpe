/*
 * Sierpe — protocolo de red.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * protocol.js — Codificación binaria de los mensajes entre anfitrión y clientes.
 *
 * ── La decisión que hace viable todo esto ──
 *
 * NO se envían los cuerpos de las serpientes. Una serpiente larga tiene 212
 * nodos: mandarlos serían 848 bytes por serpiente y por paquete, y con 20
 * serpientes visibles a 20 Hz eso son 340 KB/s por cliente. Inviable para una
 * conexión doméstica.
 *
 * En su lugar se envía solo la cabeza (10 bytes) y cada cliente reconstruye el
 * cuerpo con la MISMA cadena que usa el anfitrión. Es lo mismo que hacen los
 * fantasmas del desafío diario, donde está medido: 0,34 px de error.
 *
 * Resultado: unos 200 bytes por paquete de estado en lugar de 17 KB.
 *
 * ── Cuantización ──
 *
 * Posición en 16 bits con precisión de media unidad: cubre mundos de hasta
 * 32.767 unidades, y el mayor mide 13.000. El ángulo va en 8 bits (1,4° de
 * resolución) porque solo afecta a hacia dónde miran los ojos: la orientación
 * real del cuerpo sale de las posiciones.
 */

export const MSG = {
  HELLO:    1,   // anfitrión → cliente, al entrar
  SNAPSHOT: 2,   // anfitrión → cliente, estado periódico
  ORBS:     3,   // anfitrión → cliente, comida visible
  EVENT:    4,   // anfitrión → cliente, muertes y avisos
  INPUT:    5,   // cliente → anfitrión
  JOIN:     6,   // cliente → anfitrión, al conectar
  BYE:      7,
};

export const PROTOCOL_VERSION = 1;

const POS_SCALE = 2;        // media unidad
const MASS_SCALE = 4;
const ANGLE_SCALE = 256 / (Math.PI * 2);

export const SNAKE_BYTES = 10;
export const ORB_BYTES = 6;

export const FLAG = {
  BOOSTING: 1 << 0,
  DEAD:     1 << 1,
  SPIKES:   1 << 2,
  SHIELD:   1 << 3,
};

/* ═══════════════ Utilidades de cuantización ═══════════════ */

const qPos = (v) => Math.max(0, Math.min(65535, Math.round(v * POS_SCALE)));
const dPos = (v) => v / POS_SCALE;
const qMass = (v) => Math.max(0, Math.min(65535, Math.round(v * MASS_SCALE)));
const dMass = (v) => v / MASS_SCALE;
const qAngle = (a) => {
  const t = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(t * ANGLE_SCALE) & 0xff;
};
const dAngle = (b) => b / ANGLE_SCALE;

/* ═══════════════ SNAPSHOT ═══════════════ */

/**
 * @param {number} tick        número de paso del anfitrión
 * @param {number} ackInput    último tick de entrada recibido de ESTE cliente
 * @param {Array}  snakes      serpientes que este cliente debe ver
 * @param {number} yourId      id de la serpiente del cliente
 */
export function encodeSnapshot(tick, ackInput, snakes, yourId) {
  const n = Math.min(snakes.length, 255);
  const buf = new ArrayBuffer(12 + n * SNAKE_BYTES);
  const v = new DataView(buf);

  v.setUint8(0, MSG.SNAPSHOT);
  v.setUint8(1, n);
  v.setUint16(2, yourId);
  v.setUint32(4, tick);
  v.setUint32(8, ackInput);      // confirma hasta dónde se ha procesado

  for (let i = 0; i < n; i++) {
    const s = snakes[i];
    const o = 12 + i * SNAKE_BYTES;
    v.setUint16(o, s.netId);
    v.setUint16(o + 2, qPos(s.head.x));
    v.setUint16(o + 4, qPos(s.head.y));
    v.setUint8(o + 6, qAngle(s.angle));
    v.setUint16(o + 7, qMass(s.mass));
    let flags = 0;
    if (s.boosting) flags |= FLAG.BOOSTING;
    if (!s.alive) flags |= FLAG.DEAD;
    if (s.spikeTimer > 0) flags |= FLAG.SPIKES;
    if (s.shield > 0) flags |= FLAG.SHIELD;
    v.setUint8(o + 9, flags);
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  const n = v.getUint8(1);
  const out = {
    type: MSG.SNAPSHOT,
    yourId: v.getUint16(2),
    tick: v.getUint32(4),
    ackInput: v.getUint32(8),
    snakes: new Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = 12 + i * SNAKE_BYTES;
    const flags = v.getUint8(o + 9);
    out.snakes[i] = {
      id: v.getUint16(o),
      x: dPos(v.getUint16(o + 2)),
      y: dPos(v.getUint16(o + 4)),
      angle: dAngle(v.getUint8(o + 6)),
      mass: dMass(v.getUint16(o + 7)),
      boosting: (flags & FLAG.BOOSTING) !== 0,
      alive: (flags & FLAG.DEAD) === 0,
      spikes: (flags & FLAG.SPIKES) !== 0,
      shield: (flags & FLAG.SHIELD) !== 0,
    };
  }
  return out;
}

/* ═══════════════ ORBES ═══════════════ */

/**
 * Los orbes se envían como una foto de lo que hay en la vista del cliente, a
 * baja frecuencia, en lugar de sincronizarlos uno a uno.
 *
 * Sincronizar altas y bajas exigiría identificadores estables y un canal
 * fiable; la foto es idempotente, tolera pérdidas y cuesta poco: unos 70 orbes
 * visibles a 6 bytes son 420 bytes, y a 5 Hz eso son 2 KB/s. Comer se ve con
 * un retraso máximo de 200 ms, que la animación de absorción disimula.
 */
export function encodeOrbs(orbs) {
  const n = Math.min(orbs.length, 65535);
  const buf = new ArrayBuffer(4 + n * ORB_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, MSG.ORBS);
  v.setUint16(2, n);

  for (let i = 0; i < n; i++) {
    const orb = orbs[i];
    const o = 4 + i * ORB_BYTES;
    v.setUint16(o, qPos(orb.x));
    v.setUint16(o + 2, qPos(orb.y));
    v.setUint8(o + 4, Math.min(255, Math.round(orb.r * 8)));
    v.setUint8(o + 5, Math.round(orb.hue / 2) & 0xff);   // 0..360 → 0..180
  }
  return buf;
}

export function decodeOrbs(buf) {
  const v = new DataView(buf);
  const n = v.getUint16(2);
  const orbs = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = 4 + i * ORB_BYTES;
    orbs[i] = {
      x: dPos(v.getUint16(o)),
      y: dPos(v.getUint16(o + 2)),
      r: v.getUint8(o + 4) / 8,
      hue: v.getUint8(o + 5) * 2,
    };
  }
  return { type: MSG.ORBS, orbs };
}

/* ═══════════════ ENTRADA DEL CLIENTE ═══════════════ */

/**
 * La entrada es diminuta (8 bytes) y se manda en cada paso. Se incluye el tick
 * para que el anfitrión pueda confirmarlo y el cliente sepa hasta dónde
 * reconciliar su predicción.
 */
export function encodeInput(tick, angle, boosting) {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setUint8(0, MSG.INPUT);
  v.setUint8(1, boosting ? 1 : 0);
  v.setUint16(2, Math.round(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * (65536 / (Math.PI * 2))) & 0xffff);
  v.setUint32(4, tick);
  return buf;
}

export function decodeInput(buf) {
  const v = new DataView(buf);
  return {
    type: MSG.INPUT,
    boosting: v.getUint8(1) === 1,
    angle: v.getUint16(2) * ((Math.PI * 2) / 65536),
    tick: v.getUint32(4),
  };
}

/* ═══════════════ MENSAJES DE TEXTO ═══════════════ */

/**
 * Los mensajes poco frecuentes y de forma variable —entrar, presentación del
 * mundo, muertes— van en JSON. Optimizarlos no aportaría nada: ocurren una vez
 * por partida o unas pocas veces por minuto.
 */
export function encodeJson(type, payload) {
  return JSON.stringify({ t: type, ...payload });
}

export function decodeMessage(data) {
  if (typeof data === 'string') {
    try {
      const obj = JSON.parse(data);
      return { type: obj.t, ...obj };
    } catch {
      return null;
    }
  }
  const buf = data instanceof ArrayBuffer ? data : data.buffer;
  if (!buf || buf.byteLength < 1) return null;
  const type = new DataView(buf).getUint8(0);
  switch (type) {
    case MSG.SNAPSHOT: return decodeSnapshot(buf);
    case MSG.ORBS:     return decodeOrbs(buf);
    case MSG.INPUT:    return decodeInput(buf);
    default:           return null;
  }
}

/** Coste real de un paquete de estado, para poder razonar sobre el ancho de banda. */
export function snapshotBytes(snakeCount) {
  return 12 + snakeCount * SNAKE_BYTES;
}

export function orbsBytes(orbCount) {
  return 4 + orbCount * ORB_BYTES;
}
