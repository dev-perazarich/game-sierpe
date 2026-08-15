/**
 * neon.js — Tema «Circuito».
 * La familia de lo que había antes, pero ejecutada en serio: halos en capas,
 * rejilla con profundidad, viñeta cerrada y un solo acento frente a un solo
 * color de peligro, para que la lectura del campo sea inmediata.
 */

export default {
  id: 'neon',
  name: 'Circuito',
  tagline: 'Neón · arcade · alto contraste',
  swatches: ['#0B0410', '#2A0B3D', '#FF2D95', '#00E5FF', '#FFE45C'],

  background: {
    base: '#0B0410',
    gradient: [
      [0, 'rgba(42,11,61,0.6)'],
      [0.5, 'rgba(11,4,16,0)'],
      [1, 'rgba(30,6,44,0.5)'],
    ],
    gridSize: 76,
    gridColor: '#b23cff',
    gridAlpha: 0.13,
    gridWidth: 1,
    dots: false,
    vignette: 0.68,
    vignetteColor: '#04000a',
    edgeColor: '#ff2d55',
    parallaxBlend: 'lighter',
    parallax: [
      { depth: 0.4, count: 55, rMin: 0.6, rMax: 1.6, aMin: 0.14, aMax: 0.32, color: '#00e5ff' },
      { depth: 0.7, count: 35, rMin: 1.0, rMax: 2.4, aMin: 0.12, aMax: 0.28, color: '#ff2d95' },
    ],
  },

  body: {
    glow: 0.95,
    glowAlpha: 0.42,
    glowBlur: 9,
    glowBlend: 'lighter',
    outline: 0,
    innerLight: 0.34,
    innerAlpha: 0.85,
    innerBlend: 'lighter',
    innerPulse: false,
  },

  head: {
    glowSize: 8,
    glowAlpha: 0.6,
    highlight: true,
    outline: 0,
  },

  eyes: {
    sclera: '#ffffff',
    pupil: '#0b0410',
    outline: 0,
    blink: false,
  },

  orbs: { blend: 'lighter', boost: 1.18 },

  particles: {
    trail: { size: 6, life: 0.5, gravity: 0 },
  },

  ui: {
    panel: 'rgba(18,6,28,0.82)',
    panelBorder: 'rgba(255,45,149,0.22)',
    playerName: '#00e5ff',
    botName: 'rgba(236,216,255,0.8)',
    accent: '#ff2d95',
    danger: '#ff2d55',
    warn: '#ffe45c',
  },

  audio: { filterCutoff: 4200, reverb: 0.22, waveform: 'square' },
};
