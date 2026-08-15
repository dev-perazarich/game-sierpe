/**
 * profile.js — Perfil persistente, ajustes y estadísticas acumuladas.
 *
 * Es lo que da sentido a volver mañana, y es prácticamente gratis: una vez
 * existe el bus de eventos, registrar estadísticas es engancharse a él.
 */

import { load, save } from './storage.js';
import { dateKey } from '../engine/rng.js';
import { DIFFICULTY } from '../ai/personalities.js';

const DEFAULT_SETTINGS = {
  theme: 'panal',
  quality: 'auto',            // 'auto' | 'low' | 'medium' | 'high'
  difficulty: 'normal',
  sensitivity: 1,
  toggleBoost: false,
  deadzone: 26,
  touchMode: 'flecha',        // 'clasico' | 'flecha' | 'joystick'
  masterVolume: 0.7,
  sfxVolume: 0.8,
  ambientVolume: 0.4,
  muted: false,
  reducedMotion: false,
  highContrast: false,
  screenShake: true,
  showNames: true,
  showMinimap: true,
  minimapSize: 132,
  hudScale: 1,
  colorblindShapes: false,
  showFps: false,
};

const DEFAULT_APPEARANCE = {
  name: '',
  primary: '#4fd6c8',
  secondary: '#1b6f66',
  pattern: 'rayas',
  eyes: 'redondos',
  trail: 'chispas',
};

const DEFAULT_STATS = {
  games: 0,
  timePlayed: 0,
  bestLength: 0,
  totalKills: 0,
  totalEaten: 0,
  bestRoyalePlace: null,
  royaleWins: 0,
  bestNestWave: 0,
  bestFrenzyScore: 0,
  dominationWins: 0,
  dailyStreak: 0,
  dailyLastDate: null,
  dailyBestMedals: 0,
  modesPlayed: {},
};

export class Profile {
  constructor() {
    this.settings = load('settings', DEFAULT_SETTINGS, 1);
    this.appearance = load('appearance', DEFAULT_APPEARANCE, 1);
    this.stats = load('stats', DEFAULT_STATS, 1);
    this.unlocked = load('unlocked', { ids: [] }, 1);
    this.lastMode = load('lastMode', { id: 'classic' }, 1).id;

    // Derivados que consume el motor sin tener que leer strings cada vez.
    this.settings.themeObj = null;
    this.settings.difficultyValue = DIFFICULTY[this.settings.difficulty]?.value ?? 0.52;
  }

  saveSettings() {
    const { themeObj, difficultyValue, ...rest } = this.settings;
    save('settings', rest, 1);
    this.settings.difficultyValue = DIFFICULTY[this.settings.difficulty]?.value ?? 0.52;
  }

  saveAppearance() { save('appearance', this.appearance, 1); }
  saveStats()      { save('stats', this.stats, 1); }
  saveUnlocked()   { save('unlocked', this.unlocked, 1); }
  setLastMode(id)  { this.lastMode = id; save('lastMode', { id }, 1); }

  isUnlocked(id) {
    return this.unlocked.ids.includes(id);
  }

  unlock(id) {
    if (this.isUnlocked(id)) return false;
    this.unlocked.ids.push(id);
    this.saveUnlocked();
    return true;
  }

  /** Se llama al terminar cualquier partida. Devuelve los récords batidos. */
  recordGame({ modeId, results, world }) {
    const s = this.stats;
    const p = world.player;
    const records = [];

    s.games++;
    s.timePlayed += world.time;
    s.totalKills += p?.kills ?? 0;
    s.totalEaten += p?.eaten ?? 0;
    s.modesPlayed[modeId] = (s.modesPlayed[modeId] ?? 0) + 1;

    const peak = Math.round(p?.peakMass ?? 0);
    if (peak > s.bestLength) { s.bestLength = peak; records.push({ label: 'Longitud máxima', value: peak }); }

    switch (results.metric) {
      case 'royalePlace': {
        if (results.place && (s.bestRoyalePlace === null || results.place < s.bestRoyalePlace)) {
          s.bestRoyalePlace = results.place;
          records.push({ label: 'Mejor puesto', value: `#${results.place}` });
        }
        if (results.victory) s.royaleWins++;
        break;
      }
      case 'nestWave': {
        if (results.wave > s.bestNestWave) {
          s.bestNestWave = results.wave;
          records.push({ label: 'Oleada máxima', value: results.wave });
        }
        break;
      }
      case 'frenzyScore': {
        if (results.score > s.bestFrenzyScore) {
          s.bestFrenzyScore = results.score;
          records.push({ label: 'Récord de Frenesí', value: results.score });
        }
        break;
      }
      case 'dominationWins': {
        if (results.won) s.dominationWins++;
        break;
      }
      case 'dailyMedals': {
        this._recordDaily(results, records);
        break;
      }
    }

    this.saveStats();
    return records;
  }

  _recordDaily(results, records) {
    const s = this.stats;
    const today = results.dateKey ?? dateKey();
    if (s.dailyLastDate === today) {
      if (results.medals > s.dailyBestMedals) s.dailyBestMedals = results.medals;
      return;
    }
    // Racha: solo cuenta si completaste al menos un objetivo.
    if (results.medals > 0) {
      const yesterday = shiftDate(today, -1);
      s.dailyStreak = s.dailyLastDate === yesterday ? s.dailyStreak + 1 : 1;
      s.dailyLastDate = today;
      s.dailyBestMedals = results.medals;
      records.push({ label: 'Racha diaria', value: `${s.dailyStreak} días` });
    }
  }

  /* ── Fantasmas ─────────────────────────────────────────
   * Se guarda el mejor registro propio por fecha, y solo el de hoy: acumular
   * históricos llenaría localStorage sin que nadie los mire.
   */

  bestGhost(dateKey) {
    const doc = load('ghost', { date: null, record: null }, 1);
    return doc.date === dateKey ? doc.record : null;
  }

  /** @returns {boolean} true si el registro mejora al guardado */
  saveGhost(dateKey, record) {
    const previo = this.bestGhost(dateKey);
    if (previo && previo.score >= record.score) return false;
    save('ghost', { date: dateKey, record }, 1);
    return true;
  }

  summary() {
    const s = this.stats;
    return [
      { label: 'Partidas',           value: s.games },
      { label: 'Longitud máxima',    value: s.bestLength },
      { label: 'Eliminaciones',      value: s.totalKills },
      { label: 'Orbes comidos',      value: s.totalEaten },
      { label: 'Tiempo jugado',      value: formatDuration(s.timePlayed) },
      { label: 'Mejor puesto Cerco', value: s.bestRoyalePlace ? `#${s.bestRoyalePlace}` : '—' },
      { label: 'Victorias Cerco',    value: s.royaleWins },
      { label: 'Oleada máxima',      value: s.bestNestWave || '—' },
      { label: 'Récord Frenesí',     value: s.bestFrenzyScore || '—' },
      { label: 'Racha diaria',       value: s.dailyStreak ? `${s.dailyStreak} días` : '—' },
    ];
  }
}

function shiftDate(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

export { DEFAULT_SETTINGS, DEFAULT_APPEARANCE };
