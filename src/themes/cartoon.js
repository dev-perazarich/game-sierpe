/**
 * cartoon.js — Tema «Pradera».
 * Colores planos saturados, contorno oscuro grueso, ojos que parpadean. La
 * dirección más amable, y la que mejor aguanta jugar en móvil con luz ambiente,
 * porque no depende de halos sobre fondo negro para leerse.
 */

export default {
  id: 'cartoon',
  name: 'Pradera',
  tagline: 'Cartoon · cálido · legible',
  swatches: ['#2A4739', '#77B255', '#F5D547', '#EE6C4D', '#FDF6E3'],

  background: {
    base: '#2A4739',
    gradient: [
      [0, 'rgba(122,168,110,0.22)'],
      [0.6, 'rgba(42,71,57,0)'],
      [1, 'rgba(24,44,34,0.42)'],
    ],
    gridSize: 92,
    gridColor: '#8fc47a',
    gridAlpha: 0.10,
    gridWidth: 2,
    dots: true,
    dotColor: '#a8d98e',
    dotAlpha: 0.18,
    dotSize: 2.6,
    vignette: 0.34,
    vignetteColor: '#16281f',
    edgeColor: '#ee6c4d',
    parallaxBlend: 'source-over',
    parallax: [
      { depth: 0.5, count: 44, rMin: 2.0, rMax: 5.0, aMin: 0.06, aMax: 0.14, color: '#cfe8b4' },
      { depth: 0.8, count: 22, rMin: 3.0, rMax: 7.5, aMin: 0.05, aMax: 0.12, color: '#f5d547' },
    ],
  },

  body: {
    glow: 0,
    glowAlpha: 0,
    glowBlur: 0,
    outline: 3.2,
    outlineColor: '#1E3025',
    innerLight: 0.30,
    innerAlpha: 0.20,
    innerBlend: 'source-over',
    innerPulse: false,
  },

  head: {
    glowSize: 0,
    glowAlpha: 0,
    highlight: false,
    outline: 3.2,
    outlineColor: '#1E3025',
  },

  eyes: {
    sclera: '#FDF6E3',
    pupil: '#1E3025',
    outline: 1.8,
    outlineColor: '#1E3025',
    blink: true,
  },

  orbs: { blend: 'source-over', boost: 0.92 },

  particles: {
    trail: { size: 6, life: 0.45, gravity: 120 },
  },

  ui: {
    panel: 'rgba(30,48,37,0.88)',
    panelBorder: 'rgba(253,246,227,0.18)',
    playerName: '#F5D547',
    botName: 'rgba(253,246,227,0.86)',
    accent: '#77B255',
    danger: '#EE6C4D',
    warn: '#F5D547',
  },

  audio: { filterCutoff: 3000, reverb: 0.15, waveform: 'triangle' },
};
