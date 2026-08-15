/**
 * panal.js — Tema «Panal».
 *
 * El lenguaje visual clásico del género: fondo oscuro con textura de panal,
 * comida como puntos de luz saturados, y cuerpos gruesos de color plano con
 * brillo satinado y ojos grandes de dibujo animado.
 *
 * La diferencia con «Circuito» es dónde va la luz. Allí el cuerpo *emite*
 * (halos anchos, mezcla aditiva); aquí el cuerpo es materia sólida y la luz solo
 * la rozan un sombreado interior claro y un borde oscuro. Eso es lo que hace que
 * se lea como un tubo con volumen en lugar de como un tubo de neón.
 */

export default {
  id: 'panal',
  name: 'Panal',
  tagline: 'Clásico · colorido · legible',
  swatches: ['#12141C', '#242833', '#FF7A45', '#4FC3F7', '#B388FF'],

  background: {
    base: '#14161F',
    gradient: null,

    // Mosaico de panal en lugar de rejilla cuadrada.
    hexes: true,
    hexSize: 38,
    hexGap: 2.2,
    hexFill: 'rgba(255,255,255,0.035)',
    hexStroke: null,

    gridSize: 88,
    gridColor: '#ffffff',
    gridAlpha: 0,

    vignette: 0.42,
    vignetteColor: '#05060A',
    void: 'rgba(4,5,9,0.88)',
    edgeColor: '#FF3B4E',

    parallaxBlend: 'lighter',
    parallax: [
      { depth: 0.55, count: 40, rMin: 0.8, rMax: 2.0, aMin: 0.05, aMax: 0.12, color: '#9fb4d0' },
    ],
  },

  body: {
    // Halo mínimo: da separación del fondo sin convertir el cuerpo en neón.
    glow: 0.14,
    glowAlpha: 0.20,
    glowBlur: 0,
    glowBlend: 'source-over',

    // Borde oscuro: lo que da la silueta y hace legible el amontonamiento.
    outline: 2.2,
    outlineColor: 'rgba(0,0,0,0.42)',

    // Sombreado interior claro y opaco, no aditivo: se lee como volumen.
    innerLight: 0.52,
    innerAlpha: 0.22,
    innerBlend: 'source-over',
    innerPulse: false,
  },

  head: {
    glowSize: 3.4,
    glowAlpha: 0.20,
    highlight: true,
    outline: 2.2,
    outlineColor: 'rgba(0,0,0,0.42)',
  },

  eyes: {
    sclera: '#FFFFFF',
    pupil: '#0B0D12',
    outline: 0,
    blink: true,
    scale: 1.42,        // ojos grandes: es lo que da la cara del personaje
    spread: 0.60,
    offset: 0.50,
  },

  orbs: { blend: 'lighter', boost: 1.12 },

  particles: {
    trail: { size: 5, life: 0.5, gravity: 0 },
  },

  ui: {
    panel: 'rgba(14,16,23,0.78)',
    panelBorder: 'rgba(255,255,255,0.09)',
    playerName: '#FFFFFF',
    botName: 'rgba(226,232,240,0.86)',
    accent: '#FF7A45',
    danger: '#FF3B4E',
    warn: '#FFC14D',
  },

  audio: { filterCutoff: 3200, reverb: 0.2, waveform: 'triangle' },
};
