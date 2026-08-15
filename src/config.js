/**
 * config.js — Toda constante ajustable del juego vive aquí.
 * Los modos pueden sobrescribir `world`, `orb` y `population` en su setup().
 */

export const STEP = 1 / 60;          // paso fijo de simulación (s)
export const MAX_FRAME = 0.25;       // tope de acumulador: evita la espiral de la muerte

export const CFG = {
  // Mundo por defecto. Cada modo lo redefine en su setup(); estos valores solo
  // son la base. Con la cámara clavada en la cabeza, la sensación de espacio
  // depende de esto y del zoom, así que se dimensionó para que cruzar el mapa
  // lleve minutos, no segundos.
  world: { w: 11000, h: 11000, edgeWarn: 260 },

  // Densidad de comida en orbes por cada millón de píxeles cuadrados.
  // Fijar densidad en vez de un número absoluto evita que un mapa grande quede
  // vacío y uno pequeño saturado.
  orbDensity: 38,

  snake: {
    baseSpeed:  158,   // px/s
    boostSpeed: 306,   // px/s
    startMass:  14,
    minMass:    9,     // por debajo no se puede acelerar

    boostMassPerSec: 6.2,
    boostOrbEvery:   0.11,   // s entre orbes soltados por la cola

    // rad/s. El radio del círculo que traza la cabeza es velocidad / esta cifra:
    // con 158 px/s, 7.4 rad/s da un círculo de 21 px y 3.3 rad/s uno de 48 px.
    // Los valores anteriores (5.4 y 1.85) daban 29 px y 85 px: girar sobre uno
    // mismo describía una curva demasiado abierta, sobre todo siendo grande.
    turnRateSmall: 7.4,      // rad/s siendo delgada
    turnRateBig:   3.3,      // rad/s siendo enorme

    radiusMin: 7,
    radiusMax: 30,
    massForMaxRadius: 950,
    radiusEase: 3.5,         // 1/s con que el grosor persigue a la masa

    bodyArcBase:    76,      // px de cuerpo con masa 0
    bodyArcPerMass: 2.0,
    bodyArcMax:     5400,

    // Resolución del "espinazo": puntos muestreados para render y colisión
    spineStepFactor: 0.85,   // × radio

    /**
     * Articulación máxima entre eslabones consecutivos del cuerpo, en radianes.
     *
     * Es lo que impide que la cadena colapse al girar cerrado, y fija de paso el
     * radio mínimo al que puede enrollarse el cuerpo:
     *     R_min = separación / (2·sin(maxBend/2)) ≈ 2 × el grosor
     * Subirlo permite ovillos más cerrados a riesgo de que el cuerpo se apelmace;
     * bajarlo hace el cuerpo más rígido y el arrastre más marcado.
     */
    maxBend: 0.42,
    headGap: 2,              // nodos del propio cuerpo ignorados junto a la cabeza
  },

  orb: {
    rMin: 3.2,
    rMax: 8.5,
    count: 620,
    valuePerRadius: 0.78,
    magnetRange: 52,
    magnetSpeed: 620,
    dropSpread: 26,
  },

  camera: {
    zoomMax: 1.0,
    zoomMin: 0.52,
    lookahead: 0,        // 0 = cabeza clavada en el centro. Ver camera.js.
    smoothPos: 9,
    smoothZoom: 2.4,
  },

  ai: {
    rays: 24,
    perceptionEvery: 3,      // pasos entre reconstrucciones del mapa de peligro
    traceSteps: 8,           // profundidad de la prueba anti-suicidio
    traceStepTime: 0.09,     // s simulados por paso de traza
    stateMinTime: 0.45,      // histéresis: tiempo mínimo en un estado
    stateMargin: 0.12,       // margen de utilidad para cambiar
    perceptionRadius: 620,
  },

  fx: {
    particleBudget: { low: 0, medium: 340, high: 900 },
    shakeDecay: 6.5,
    hitstop: 0.06,
  },

  scoring: {
    killMassShare: 0.35,     // fracción de la masa de la víctima que va al asesino
    deathOrbFraction: 0.62,  // fracción de la masa que se convierte en orbes
    deathOrbMax: 160,
  },
};

export const QUALITY_LEVELS = ['low', 'medium', 'high'];

export const BOT_NAMES = [
  'Cobra', 'Mamba', 'Víbora', 'Boa', 'Pitón', 'Anaconda', 'Naga', 'Sierpe',
  'Basilisco', 'Wyrm', 'Áspid', 'Krait', 'Tifón', 'Quetzal', 'Uroboros',
  'Lamia', 'Escila', 'Yormun', 'Cascabel', 'Taipán', 'Coralillo', 'Bitis',
  'Nidhogg', 'Apofis', 'Jörmun', 'Vasuki', 'Zahhak', 'Python', 'Serpens',
];

/** Masa → radio del cuerpo. Raíz cuadrada: crecer rápido al principio, lento después. */
export function radiusForMass(mass) {
  const s = CFG.snake;
  const t = Math.min(1, Math.sqrt(Math.max(0, mass) / s.massForMaxRadius));
  return s.radiusMin + (s.radiusMax - s.radiusMin) * t;
}

/** Masa → longitud de cuerpo dibujado, en píxeles de arco. */
export function bodyArcForMass(mass) {
  const s = CFG.snake;
  return Math.min(s.bodyArcMax, s.bodyArcBase + Math.max(0, mass) * s.bodyArcPerMass);
}

/**
 * Radio → velocidad de giro. Decisión de diseño central: ser grande cuesta agilidad,
 * lo que da contrajuego real a las serpientes pequeñas.
 */
/** Número de orbes que corresponde a un mundo, según la densidad objetivo. */
export function orbsForWorld(w, h, densityMul = 1) {
  return Math.round((w * h) / 1e6 * CFG.orbDensity * densityMul);
}

/**
 * Población de bots para un mundo. También por densidad: con la cámara clavada
 * en la cabeza ves una fracción pequeña del mapa, así que si los rivales no
 * escalan con el área, un mundo grande se siente desierto.
 */
export function botsForWorld(w, h, per1e6 = 0.42, min = 8, max = 60) {
  return Math.round(Math.min(max, Math.max(min, (w * h) / 1e6 * per1e6)));
}

export function turnRateForRadius(radius) {
  const s = CFG.snake;
  const t = (radius - s.radiusMin) / (s.radiusMax - s.radiusMin);
  return s.turnRateSmall + (s.turnRateBig - s.turnRateSmall) * Math.min(1, Math.max(0, t));
}
