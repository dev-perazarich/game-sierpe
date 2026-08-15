/**
 * abyss.js — Tema «Abismo».
 * Bioluminiscente, frío, elegante. Fondo de fosa oceánica con parallax de motas
 * suspendidas; los cuerpos son translúcidos con luz interna que late y los orbes
 * se leen como plancton.
 */

export default {
  id: 'abyss',
  name: 'Abismo',
  tagline: 'Bioluminiscente · frío · elegante',
  swatches: ['#04101C', '#0A2E45', '#1FA8A0', '#7FF3D8', '#E8B44A'],

  background: {
    base: '#04101C',
    gradient: [
      [0, 'rgba(8,32,52,0.55)'],
      [0.55, 'rgba(4,16,28,0)'],
      [1, 'rgba(1,7,14,0.75)'],
    ],
    gridSize: 104,
    gridColor: '#2ea6b8',
    gridAlpha: 0.055,
    gridWidth: 1,
    dots: true,
    dotColor: '#4fd6c8',
    dotAlpha: 0.07,
    dotSize: 1.4,
    vignette: 0.55,
    vignetteColor: '#01060c',
    edgeColor: '#ff5b6e',
    parallaxBlend: 'lighter',
    parallax: [
      { depth: 0.35, count: 90,  rMin: 0.7, rMax: 1.9, aMin: 0.10, aMax: 0.24, color: '#6fd9e8' },
      { depth: 0.6,  count: 60,  rMin: 1.1, rMax: 2.8, aMin: 0.12, aMax: 0.30, color: '#9ff0dd' },
      { depth: 0.85, count: 30,  rMin: 1.8, rMax: 4.2, aMin: 0.10, aMax: 0.26, color: '#e8b44a' },
    ],
  },

  body: {
    glow: 0.55,
    glowAlpha: 0.30,
    glowBlur: 6,
    glowBlend: 'lighter',
    outline: 0,
    innerLight: 0.42,
    innerAlpha: 0.55,
    innerBlend: 'lighter',
    innerPulse: true,
  },

  head: {
    glowSize: 6.5,
    glowAlpha: 0.42,
    highlight: true,
    outline: 0,
  },

  eyes: {
    sclera: '#eafcff',
    pupil: '#04222e',
    outline: 0,
    blink: true,
  },

  orbs: { blend: 'lighter', boost: 1.05 },

  particles: {
    trail: { size: 5, life: 0.75, gravity: -14 },
  },

  ui: {
    panel: 'rgba(6,22,36,0.78)',
    panelBorder: 'rgba(110,220,225,0.16)',
    playerName: '#9ff0dd',
    botName: 'rgba(198,228,238,0.78)',
    accent: '#4fd6c8',
    danger: '#ff5b6e',
    warn: '#e8b44a',
  },

  audio: { filterCutoff: 2400, reverb: 0.55, waveform: 'sine' },
};
