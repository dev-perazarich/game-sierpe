/*
 * Sierpe — interpolación de entidades remotas.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * interpolation.js — Convierte paquetes discretos en movimiento continuo.
 *
 * El anfitrión envía estado 20 veces por segundo, pero el cliente dibuja a 60.
 * Sin interpolación, las serpientes ajenas avanzarían a saltos de 8 px.
 *
 * ── Por qué se dibuja el pasado ──
 *
 * El cliente no representa "ahora", sino un instante ligeramente atrasado
 * (INTERP_DELAY). Así siempre tiene dos paquetes que rodean el momento a
 * dibujar y puede interpolar entre ellos en lugar de extrapolar, que es lo que
 * produce esos tirones hacia atrás cuando llega el paquete real.
 *
 * El retraso debe cubrir el intervalo entre paquetes más el temblor de la red.
 * Con 20 Hz (50 ms) y jitter típico, 100 ms es un valor conservador y estable.
 * Solo afecta a los DEMÁS: tu propia serpiente va predicha y sin retraso.
 */

export const INTERP_DELAY = 0.10;      // segundos de retraso de representación
const MAX_BUFFER = 32;                 // paquetes guardados por entidad
const EXTRAPOLATE_LIMIT = 0.25;        // más allá, se congela en vez de inventar
const DRIFT_GAIN = 0.08;               // corrección del cabezal por paquete
const RATE_LIMIT = 0.12;               // ±12 % de velocidad de reproducción

export class InterpolationBuffer {
  /**
   * @param {number} step  duración del paso de simulación del anfitrión
   */
  constructor(step = 1 / 60) {
    /** @type {Map<number, {samples: Array, last: number}>} */
    this.entities = new Map();
    this.step = step;

    // ── Cabezal de reproducción, en TIEMPO DEL ANFITRIÓN ──
    //
    // Antes se sellaba cada paquete con la hora de llegada al cliente. Eso
    // desplaza todo por media latencia y el error CRECE con el ping: medido,
    // 22 px con solo 40 ms de ida y vuelta. Lo correcto es situar cada muestra
    // en el instante que representa —el tick del anfitrión— y reproducir con
    // un cabezal que va INTERP_DELAY por detrás del último paquete recibido.
    //
    // Así la latencia solo decide cuánto se va por detrás, no la precisión.
    this.playhead = 0;
    this.rate = 1;
    this.latestHostTime = 0;
    this.started = false;
    this.lastPacketAt = 0;
  }

  /** Reloj propio, avanzado por el bucle del cliente. */
  advance(dt) {
    if (!this.started) return;
    this.playhead += dt * this.rate;
  }

  /**
   * Incorpora un paquete de estado.
   * @param {number} recvTime  momento local de recepción (solo para estadísticas)
   */
  push(snapshot, recvTime) {
    this.lastPacketAt = recvTime;
    const hostTime = snapshot.tick * this.step;

    if (hostTime > this.latestHostTime) this.latestHostTime = hostTime;

    if (!this.started) {
      this.playhead = this.latestHostTime - INTERP_DELAY;
      this.started = true;
      this.rate = 1;
    } else {
      // Corrección suave de deriva: en lugar de saltar el cabezal —que se vería
      // como un tirón—, se acelera o frena la reproducción un poco hasta
      // recuperar el retraso objetivo.
      const objetivo = this.latestHostTime - INTERP_DELAY;
      const error = objetivo - this.playhead;
      if (Math.abs(error) > INTERP_DELAY * 4) {
        this.playhead = objetivo;      // desfase enorme: no vale corregir poco a poco
        this.rate = 1;
      } else {
        this.rate = clampRate(1 + error * DRIFT_GAIN / INTERP_DELAY);
      }
    }

    for (const s of snapshot.snakes) {
      let e = this.entities.get(s.id);
      if (!e) {
        e = { samples: [], last: recvTime };
        this.entities.set(s.id, e);
      }
      e.last = recvTime;

      // Los paquetes pueden llegar desordenados: se inserta manteniendo el
      // orden temporal en lugar de asumir que el último es el más reciente.
      const sample = { t: hostTime, ...s };
      const arr = e.samples;
      if (arr.length === 0 || hostTime > arr[arr.length - 1].t) {
        arr.push(sample);
      } else {
        let i = arr.length - 1;
        while (i >= 0 && arr[i].t > hostTime) i--;
        if (i >= 0 && arr[i].t === hostTime) continue;   // duplicado
        arr.splice(i + 1, 0, sample);
      }
      if (arr.length > MAX_BUFFER) arr.shift();
    }
  }

  /**
   * Estado interpolado de una entidad en el instante de representación.
   * @returns {object|null} null si aún no hay datos suficientes
   */
  sample(id) {
    const e = this.entities.get(id);
    if (!e || e.samples.length === 0) return null;

    const target = this.playhead;
    const arr = e.samples;

    // Antes del primer paquete: aún no hay nada que mostrar.
    if (target <= arr[0].t) return { ...arr[0], interpolated: false };

    // Buscar el par que rodea al instante objetivo.
    for (let i = arr.length - 1; i > 0; i--) {
      const b = arr[i], a = arr[i - 1];
      if (target >= a.t && target <= b.t) {
        const span = b.t - a.t;
        const f = span > 1e-6 ? (target - a.t) / span : 0;
        return lerpState(a, b, f);
      }
    }

    // Por delante del último paquete: se ha perdido información. Se mantiene la
    // última posición conocida un momento y luego se congela. Extrapolar aquí
    // haría que las serpientes se fueran solas y luego saltaran hacia atrás.
    const last = arr[arr.length - 1];
    const ahead = target - last.t;
    if (ahead > EXTRAPOLATE_LIMIT) return { ...last, stale: true };
    return { ...last, stale: ahead > 0.12 };
  }

  /** Entidades sin noticias recientes: han salido de vista o se han ido. */
  prune(recvTime, timeout = 3) {
    for (const [id, e] of this.entities) {
      if (recvTime - e.last > timeout) this.entities.delete(id);
    }
  }

  ids() {
    return [...this.entities.keys()];
  }

  clear() {
    this.entities.clear();
    this.started = false;
    this.playhead = 0;
    this.latestHostTime = 0;
    this.rate = 1;
  }

  /** Cuánto va por detrás la representación respecto al anfitrión, en segundos. */
  get lag() {
    return this.started ? this.latestHostTime - this.playhead : 0;
  }
}

const clampRate = (r) => Math.max(1 - RATE_LIMIT, Math.min(1 + RATE_LIMIT, r));

function lerpState(a, b, f) {
  return {
    id: a.id,
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    mass: a.mass + (b.mass - a.mass) * f,
    angle: lerpAngle(a.angle, b.angle, f),
    boosting: b.boosting,
    alive: b.alive,
    spikes: b.spikes,
    shield: b.shield,
    interpolated: true,
  };
}

/** Interpolación angular por el camino corto: sin esto, cruzar 0 da un latigazo. */
function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

/**
 * Estimador de latencia y temblor de la red, para poder mostrarlos y para
 * ajustar el retraso de representación si hiciera falta.
 */
export class NetStats {
  constructor() {
    this.rtt = 0;
    this.jitter = 0;
    this.loss = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this._lastArrival = 0;
    this._expected = 0;
    this._received = 0;
    this._window = [];
  }

  onPacket(recvTime, bytes, tick) {
    this.bytesIn += bytes;
    if (this._lastArrival) {
      const gap = recvTime - this._lastArrival;
      this._window.push(gap);
      if (this._window.length > 40) this._window.shift();
      const media = this._window.reduce((a, b) => a + b, 0) / this._window.length;
      const varianza = this._window.reduce((a, b) => a + Math.abs(b - media), 0) / this._window.length;
      this.jitter = varianza;
    }
    this._lastArrival = recvTime;

    // Pérdida estimada a partir de los huecos en la numeración de ticks.
    if (this._expected && tick > this._expected) {
      this._received++;
      const perdidos = tick - this._expected;
      this.loss = this.loss * 0.9 + (perdidos > 0 ? 0.1 : 0);
    }
    this._expected = tick + 1;
  }

  onRtt(ms) {
    this.rtt = this.rtt ? this.rtt * 0.85 + ms * 0.15 : ms;
  }
}
