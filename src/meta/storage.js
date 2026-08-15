/**
 * storage.js — Persistencia local con versión.
 *
 * Todo va a localStorage, con un número de versión por documento para poder
 * migrar el formato más adelante sin borrarle el progreso a nadie. Cualquier
 * lectura fallida devuelve el valor por defecto en lugar de romper el arranque.
 */

const PREFIX = 'serpientes.';

export function load(key, fallback, version = 1) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return structuredCloneSafe(fallback);
    const doc = JSON.parse(raw);
    if (doc.__v !== version) return migrate(key, doc, version, fallback);
    return { ...structuredCloneSafe(fallback), ...doc.data };
  } catch {
    return structuredCloneSafe(fallback);
  }
}

export function save(key, data, version = 1) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ __v: version, data }));
    return true;
  } catch {
    // Cuota llena o modo privado: el juego sigue funcionando sin guardar.
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* sin efecto */ }
}

/**
 * Migración entre versiones. De momento solo hay v1, así que se conserva lo que
 * encaje y se rellena el resto con los valores por defecto: es lo más
 * conservador posible y nunca pierde datos silenciosamente.
 */
function migrate(key, doc, targetVersion, fallback) {
  const base = structuredCloneSafe(fallback);
  if (doc && typeof doc.data === 'object') {
    for (const k of Object.keys(base)) {
      if (k in doc.data) base[k] = doc.data[k];
    }
  }
  save(key, base, targetVersion);
  return base;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* cae al JSON */ }
  }
  return JSON.parse(JSON.stringify(value));
}
