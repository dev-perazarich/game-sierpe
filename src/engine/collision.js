/**
 * collision.js — Una sola pasada global de colisiones.
 *
 * El código anterior evaluaba cada choque dos veces (una desde el bucle del
 * jugador y otra desde el del bot), con resultados que podían contradecirse.
 * Aquí se recoge todo en una lista de muertes y se resuelve al final, así que
 * el orden de iteración deja de importar.
 *
 * También pasa de "¿está el centro cerca?" a distancia punto-segmento sobre el
 * trazo recorrido en el paso, que es lo que hace falta al tener delta time: a
 * 306 px/s el desplazamiento por paso ya no es despreciable frente al radio.
 */

import { distToSegment2 } from './math.js';

export const CAUSE = {
  BODY:  'body',
  HEAD:  'head',
  EDGE:  'edge',
  ZONE:  'zone',
  SPIKE: 'spike',
};

/**
 * @param {Array<Snake>} snakes  serpientes vivas
 * @param {SpatialHash} hash     hash ya poblado con los nodos del cuerpo
 * @returns {Array<{victim, killer, cause}>}
 */
// Reutilizados entre ticks. La resolución es síncrona y quien llama consume
// `deaths` antes de la siguiente llamada, así que compartirlos es seguro.
const _deaths = [];
const _dying = new Set();
const _headPairs = new Set();
const _scratch = [];

export function resolveCollisions(snakes, hash, opts = {}) {
  const deaths = _deaths;
  const dying = _dying;
  const headPairs = _headPairs;
  const scratch = _scratch;
  deaths.length = 0;
  dying.clear();
  headPairs.clear();

  for (const s of snakes) {
    if (!s.alive || dying.has(s.id) || s.invuln > 0) continue;

    const h = s.head;
    const prev = s.prevHead || h;
    const rs = s.radius;

    // Radio de consulta: alcance del barrido más el radio máximo posible del rival.
    const sweep = Math.hypot(h.x - prev.x, h.y - prev.y);
    const queryR = rs + sweep + 34;
    const mx = (h.x + prev.x) * 0.5;
    const my = (h.y + prev.y) * 0.5;

    hash.query(mx, my, queryR, scratch);

    let hit = null;
    for (let i = 0; i < scratch.length; i++) {
      const node = scratch[i];
      const other = node.snake;
      if (other === s) continue;
      if (!other.alive || dying.has(other.id)) continue;
      if (other.team !== null && other.team === s.team && !opts.friendlyFire) continue;

      const reach = rs + node.r;
      const d2 = distToSegment2(node.x, node.y, prev.x, prev.y, h.x, h.y);
      if (d2 > reach * reach) continue;

      if (node.isHead) {
        // Choque frontal: se registra el par una sola vez, con clave canónica.
        const a = Math.min(s.id, other.id), b = Math.max(s.id, other.id);
        const key = a * 100000 + b;
        if (headPairs.has(key)) continue;
        headPairs.add(key);
        if (other.invuln > 0) continue;

        const diff = s.mass - other.mass;
        const tie = Math.abs(diff) < Math.max(2, s.mass * 0.04);
        if (tie) {
          pushDeath(deaths, dying, s, other, CAUSE.HEAD);
          pushDeath(deaths, dying, other, s, CAUSE.HEAD);
        } else if (diff > 0) {
          pushDeath(deaths, dying, other, s, CAUSE.HEAD);
        } else {
          pushDeath(deaths, dying, s, other, CAUSE.HEAD);
        }
        if (dying.has(s.id)) { hit = 'done'; break; }
        continue;
      }

      // Cabeza contra cuerpo: muere quien choca. Las púas invierten el resultado.
      if (other.spikeTimer > 0) {
        hit = { killer: other, cause: CAUSE.SPIKE };
        break;
      }
      hit = { killer: other, cause: CAUSE.BODY };
      break;
    }

    if (hit && hit !== 'done') {
      pushDeath(deaths, dying, s, hit.killer, hit.cause);
    }
  }

  return deaths;
}

function pushDeath(deaths, dying, victim, killer, cause) {
  if (dying.has(victim.id)) return;
  if (victim.shield > 0) {
    victim.shield--;
    victim.invuln = Math.max(victim.invuln, 0.9);
    return;
  }
  dying.add(victim.id);
  deaths.push({ victim, killer, cause });
}

/**
 * Pool de nodos del hash de colisión.
 *
 * Antes cada nodo era un objeto literal nuevo. Con 50 serpientes largas son unos
 * 6.000 objetos por tick, 360.000 por segundo: el recolector de basura acababa
 * provocando picos de 18 ms que se ven como tirones. Ahora los nodos se
 * reutilizan y la memoria se estabiliza.
 */
const nodePool = [];
let nodeCount = 0;

export function resetNodePool() {
  nodeCount = 0;
}

function takeNode() {
  let n = nodePool[nodeCount];
  if (n === undefined) {
    n = { x: 0, y: 0, r: 0, snake: null, isHead: false };
    nodePool[nodeCount] = n;
  }
  nodeCount++;
  return n;
}

/** Inserta los nodos del cuerpo de una serpiente en el hash. */
export function insertSnake(hash, snake) {
  const spine = snake.spine;
  const r = snake.radius;
  const gapNodes = 2 * 2; // se saltan los primeros nodos: son la propia cabeza
  const total = spine.length;

  // Nodo cabeza, marcado aparte para poder resolver choques frontales.
  const head = takeNode();
  head.x = spine[0]; head.y = spine[1];
  head.r = r; head.snake = snake; head.isHead = true;
  hash.insert(head.x, head.y, head);

  for (let i = gapNodes; i < total; i += 2) {
    const n = takeNode();
    n.x = spine[i];
    n.y = spine[i + 1];
    n.r = snake.widthAt(i / total);
    n.snake = snake;
    n.isHead = false;
    hash.insert(n.x, n.y, n);
  }
}
