/**
 * snakeRenderer.js — El cambio central del rediseño visual.
 *
 * Antes: un arc() relleno por segmento, alternando dos colores por paridad de
 * índice. De ahí el aspecto de collar de cuentas y el parpadeo del patrón cuando
 * la serpiente crecía o encogía.
 *
 * Ahora: un único trazo continuo construido con una curva suavizada sobre el
 * espinazo, dibujado en varias pasadas superpuestas (halo, cuerpo, luz interior,
 * patrón). El tema activo decide qué pasadas se usan y con qué anchos, así que
 * las tres direcciones visuales comparten este mismo código.
 */

import { rgba, mixHex, clamp } from '../engine/math.js';
import { glowSprite, tinted, drawSprite } from './sprites.js';

/**
 * Construye un Path2D suavizado a partir del espinazo (array plano x,y,x,y…).
 * Se usa Catmull-Rom convertida a Bézier cúbica: pasa por todos los puntos y no
 * necesita tangentes explícitas.
 */
export function buildSpinePath(spine, decimate = 1) {
  const pts = [];
  const stride = decimate * 2;
  for (let i = 0; i < spine.length; i += stride) {
    pts.push(spine[i], spine[i + 1]);
  }
  // La punta de la cola siempre entra, aunque el diezmado la salte.
  const lastX = spine[spine.length - 2];
  const lastY = spine[spine.length - 1];
  if (pts[pts.length - 2] !== lastX || pts[pts.length - 1] !== lastY) {
    pts.push(lastX, lastY);
  }

  const path = new Path2D();
  const n = pts.length / 2;
  if (n < 2) {
    path.moveTo(pts[0] ?? 0, pts[1] ?? 0);
    return path;
  }

  path.moveTo(pts[0], pts[1]);
  if (n === 2) {
    path.lineTo(pts[2], pts[3]);
    return path;
  }

  for (let i = 0; i < n - 1; i++) {
    const p0 = idx(pts, i - 1, n), p1 = idx(pts, i, n);
    const p2 = idx(pts, i + 1, n), p3 = idx(pts, i + 2, n);
    path.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y,
    );
  }
  return path;
}

function idx(pts, i, n) {
  const k = clamp(i, 0, n - 1) * 2;
  return { x: pts[k], y: pts[k + 1] };
}

/**
 * Dibuja una serpiente completa.
 * @param {object} theme  módulo de tema activo
 * @param {number} lod    0 = detalle completo, 1 = lejana/reducida
 */
export function drawSnake(ctx, snake, theme, { quality = 'high', lod = 0, time = 0 } = {}) {
  const spine = snake.spine;
  if (spine.length < 4) return;

  const skin = snake.skin;
  const r = snake.radius;
  const body = theme.body;

  // Diezmado: en calidad baja o para serpientes lejanas se usan menos puntos.
  // Visualmente es casi idéntico y cuesta un tercio.
  const decimate = lod > 0 ? 3 : quality === 'low' ? 3 : quality === 'medium' ? 2 : 1;
  const path = buildSpinePath(spine, decimate);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const boostPulse = snake.boosting ? 1 + Math.sin(time * 22) * 0.06 : 1;

  // ── Pasada 0: sombra proyectada ──
  if (quality !== 'low') {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = r * 2 * boostPulse + 3;
    ctx.filter = 'blur(4px)';
    ctx.stroke(path);
    ctx.restore();
  }

  // ── Pasada 1: halo exterior ──
  if (body.glow > 0 && quality !== 'low') {
    ctx.save();
    ctx.globalCompositeOperation = body.glowBlend ?? 'lighter';
    ctx.strokeStyle = rgba(skin.glow, body.glowAlpha * (snake.boosting ? 1.5 : 1));
    ctx.lineWidth = r * 2 * (1 + body.glow) * boostPulse;
    if (quality === 'high' && body.glowBlur) {
      ctx.filter = `blur(${body.glowBlur}px)`;
    }
    ctx.stroke(path);
    ctx.restore();
  }

  // ── Pasada 2: contorno (lo usa el tema cartoon) ──
  if (body.outline > 0) {
    ctx.strokeStyle = body.outlineColor ?? '#000';
    ctx.lineWidth = r * 2 + body.outline * 2;
    ctx.stroke(path);
  }

  // ── Pasada 3: cuerpo ──
  ctx.strokeStyle = buildBodyStroke(ctx, snake, theme, skin);
  ctx.lineWidth = r * 2 * boostPulse;
  ctx.stroke(path);

  // ── Pasada 4: luz interior / especular ──
  if (body.innerLight > 0 && quality !== 'low') {
    ctx.save();
    ctx.globalCompositeOperation = body.innerBlend ?? 'lighter';
    const pulse = body.innerPulse ? 0.72 + Math.sin(time * 2.4 + snake.id) * 0.28 : 1;
    ctx.strokeStyle = rgba(skin.head, body.innerAlpha * pulse);
    ctx.lineWidth = r * 2 * body.innerLight;
    ctx.stroke(path);
    ctx.restore();
  }

  // ── Pasada 5: highlight superior (efecto 3D) ──
  if (quality === 'high') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#ffffff', 0.12);
    ctx.lineWidth = r * 1.1;
    ctx.stroke(path);
    ctx.restore();
  }

  // ── Pasada 6: patrón ──
  if (skin.pattern && skin.pattern !== 'liso' && quality !== 'low') {
    drawPattern(ctx, path, snake, theme, skin, time);
  }

  // ── Púas activas ──
  if (snake.spikeTimer > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#ff5c3a', 0.5 + Math.sin(time * 18) * 0.2);
    ctx.lineWidth = r * 2 + 7;
    ctx.setLineDash([5, 9]);
    ctx.stroke(path);
    ctx.restore();
  }

  // ── Escudo ──
  if (snake.shield > 0 || snake.invuln > 0) {
    const a = snake.shield > 0 ? 0.5 : clamp(snake.invuln / 1.6, 0, 1) * 0.35;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#9fe8ff', a * (0.7 + Math.sin(time * 9) * 0.3));
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(snake.head.x, snake.head.y, r + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawHead(ctx, snake, theme, skin, time, quality);
}

function buildBodyStroke(ctx, snake, theme, skin) {
  if (skin.pattern === 'degradado') {
    const h = snake.head;
    const t = snake.spine;
    const tx = t[t.length - 2], ty = t[t.length - 1];
    const g = ctx.createLinearGradient(h.x, h.y, tx, ty);
    g.addColorStop(0, skin.head);
    g.addColorStop(1, skin.body2 ?? skin.dark);
    return g;
  }
  return skin.body;
}

/**
 * Los patrones son trazos discontinuos cuyo desfase avanza con el movimiento de
 * la serpiente. Eso produce la ilusión de escamas deslizándose por el cuerpo sin
 * coste extra: es un stroke más, no geometría nueva.
 */
function drawPattern(ctx, path, snake, theme, skin, time) {
  const r = snake.radius;
  const c2 = skin.body2 ?? skin.dark;
  ctx.save();

  switch (skin.pattern) {
    case 'rayas':
      ctx.strokeStyle = c2;
      ctx.lineWidth = r * 2;
      ctx.setLineDash([r * 0.9, r * 1.5]);
      ctx.lineDashOffset = -snake.traveled * 0.6;
      break;
    case 'bandas':
      ctx.strokeStyle = c2;
      ctx.lineWidth = r * 2;
      ctx.setLineDash([r * 2.6, r * 2.6]);
      ctx.lineDashOffset = -snake.traveled * 0.5;
      break;
    case 'escamas':
      ctx.strokeStyle = rgba(c2, 0.75);
      ctx.lineWidth = r * 1.15;
      ctx.setLineDash([r * 0.5, r * 0.75]);
      ctx.lineDashOffset = -snake.traveled * 0.7;
      break;
    case 'punteado':
      ctx.strokeStyle = rgba(skin.head, 0.9);
      ctx.lineWidth = r * 0.55;
      ctx.setLineDash([0.1, r * 1.9]);
      ctx.lineCap = 'round';
      ctx.lineDashOffset = -snake.traveled * 0.5;
      break;
    case 'pulso':
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(skin.head, 0.55);
      ctx.lineWidth = r * 1.4;
      ctx.setLineDash([r * 0.8, r * 5]);
      ctx.lineDashOffset = -time * 260;
      break;
    case 'diamantes':
      ctx.strokeStyle = rgba(c2, 0.8);
      ctx.lineWidth = r * 0.7;
      ctx.setLineDash([r * 0.4, r * 2.2]);
      ctx.lineCap = 'round';
      ctx.lineDashOffset = -snake.traveled * 0.8;
      break;
    case 'escamas3d':
      ctx.strokeStyle = rgba(skin.head, 0.5);
      ctx.lineWidth = r * 1.6;
      ctx.setLineDash([r * 1.1, r * 0.6]);
      ctx.lineDashOffset = -snake.traveled * 0.65;
      break;
    case 'zigzag':
      ctx.strokeStyle = rgba(c2, 0.85);
      ctx.lineWidth = r * 0.8;
      ctx.setLineDash([r * 0.6, r * 1.4, r * 0.6, r * 1.4]);
      ctx.lineCap = 'round';
      ctx.lineDashOffset = -snake.traveled * 1.2;
      break;
    case 'flores':
      ctx.strokeStyle = rgba(skin.head, 0.6);
      ctx.lineWidth = r * 0.5;
      ctx.setLineDash([0.1, r * 3.5]);
      ctx.lineCap = 'round';
      ctx.lineDashOffset = -snake.traveled * 0.4;
      break;
    case 'galaxia':
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(skin.head, 0.45);
      ctx.lineWidth = r * 0.45;
      ctx.setLineDash([0.1, r * 2.8]);
      ctx.lineCap = 'round';
      ctx.lineDashOffset = -time * 180;
      break;
    default:
      ctx.restore();
      return;
  }

  ctx.stroke(path);
  ctx.restore();
}

function drawHead(ctx, snake, theme, skin, time, quality) {
  const h = snake.head;
  const r = snake.radius;
  const a = snake.angle;
  const head = theme.head ?? {};

  // Halo de cabeza — sprite pre-renderizado, nunca un gradiente nuevo.
  if (quality !== 'low' && (head.glowSize ?? 0) > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sprite = tinted(glowSprite(128, 'soft'), skin.head);
    drawSprite(ctx, sprite, h.x, h.y, r * (head.glowSize ?? 5), head.glowAlpha ?? 0.5);
    ctx.restore();
  }

  // Cabeza con gradiente radial para efecto 3D
  ctx.save();
  const headGrad = ctx.createRadialGradient(
    h.x - Math.cos(a) * r * 0.25, h.y - Math.sin(a) * r * 0.25, r * 0.1,
    h.x, h.y, r * 1.04
  );
  headGrad.addColorStop(0, mixHex(skin.head, '#ffffff', 0.35));
  headGrad.addColorStop(0.7, skin.head);
  headGrad.addColorStop(1, mixHex(skin.head, '#000000', 0.35));
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 1.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (head.outline > 0) {
    ctx.strokeStyle = head.outlineColor ?? '#12140f';
    ctx.lineWidth = head.outline;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r * 1.04, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (head.highlight && quality === 'high') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sprite = tinted(glowSprite(64, 'tight'), '#ffffff');
    drawSprite(ctx, sprite, h.x - Math.cos(a) * r * 0.25, h.y - Math.sin(a) * r * 0.25, r * 1.5, 0.28);
    ctx.restore();
  }

  drawEyes(ctx, snake, theme, skin, time);
}

function drawEyes(ctx, snake, theme, skin, time) {
  const h = snake.head;
  const r = snake.radius;
  const a = snake.angle;
  const style = skin.eyes ?? 'redondos';
  const cfg = theme.eyes ?? {};

  // Parpadeo: ciclo largo con desfase por id, para que no parpadeen a la vez.
  const blinkCycle = (time * 0.6 + snake.id * 0.37) % 1;
  const blink = cfg.blink && blinkCycle > 0.97 ? 0.12 : 1;

  // El tema decide el tamaño y la separación: unos ojos grandes y juntos dan
  // cara de personaje, unos pequeños dan aspecto de criatura. Es la diferencia
  // visual más barata que existe entre temas.
  const scale = cfg.scale ?? 1;
  const spread = style === 'ciclope' || style === 'alien' ? 0 : (cfg.spread ?? 0.52);
  const offset = r * (style === 'ciclope' ? 0.28 : style === 'alien' ? 0.38 : (cfg.offset ?? 0.46));
  const eyeR = r * scale * (style === 'ciclope' ? 0.42 : style === 'alien' ? 0.38 : style === 'gato' ? 0.34 : style === 'demonio' ? 0.35 : 0.31);

  // Mirada: apunta hacia donde gira, lo que da intención al movimiento.
  const gaze = snake.targetAngle;
  const gazeOff = Math.max(-0.5, Math.min(0.5, ((gaze - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI));

  const angles = style === 'ciclope' || style === 'alien' ? [a] : [a - spread, a + spread];

  if (style === 'visor') {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(a);
    ctx.fillStyle = cfg.sclera ?? '#0d1117';
    ctx.beginPath();
    ctx.ellipse(r * 0.34, 0, r * 0.5, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin.glow;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(r * 0.4, 0, r * 0.3, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  for (const ea of angles) {
    const ex = h.x + Math.cos(ea) * offset;
    const ey = h.y + Math.sin(ea) * offset;

    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);

    if (style === 'gato') {
      // Ojos de gato: slit pupil vertical con brillo
      ctx.fillStyle = cfg.sclera ?? '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeR * 1.1, eyeR * blink * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cfg.pupil ?? '#101418';
      ctx.beginPath();
      ctx.ellipse(gazeOff * eyeR * 0.3, 0, eyeR * 0.22, eyeR * blink * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Brillo
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(-eyeR * 0.25, -eyeR * 0.3, eyeR * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'demonio') {
      // Ojos de demonio: rojos intensos con pupilas pequeñas
      ctx.fillStyle = '#ff2a2a';
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeR * 1.15, eyeR * blink * 1.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffff00';
      ctx.beginPath();
      ctx.arc(gazeOff * eyeR * 0.3, 0, eyeR * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'alien') {
      // Ojos de alien: grandes y negros
      ctx.fillStyle = cfg.sclera ?? '#111111';
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeR * 1.3, eyeR * blink * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(gazeOff * eyeR * 0.4, 0, eyeR * 0.55, 0, Math.PI * 2);
      ctx.fill();
      // Brillo pequeño
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(-eyeR * 0.2, -eyeR * 0.25, eyeR * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Ojos normales (redondos, rasgados, dormilon)
      ctx.fillStyle = cfg.sclera ?? '#ffffff';
      ctx.beginPath();
      if (style === 'rasgados') {
        ctx.ellipse(0, 0, eyeR * 1.25, eyeR * blink * 0.62, 0, 0, Math.PI * 2);
      } else if (style === 'dormilon') {
        ctx.ellipse(0, eyeR * 0.2, eyeR, eyeR * blink * 0.48, 0, 0, Math.PI * 2);
      } else {
        ctx.ellipse(0, 0, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
      }
      ctx.fill();

      if (cfg.outline > 0) {
        ctx.strokeStyle = cfg.outlineColor ?? '#12140f';
        ctx.lineWidth = cfg.outline;
        ctx.stroke();
      }

      // Pupila
      ctx.fillStyle = cfg.pupil ?? '#101418';
      ctx.beginPath();
      const px = eyeR * 0.36 + gazeOff * eyeR * 0.5;
      ctx.ellipse(px, 0, eyeR * 0.48, eyeR * 0.5 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

/** Nombre flotante. Se dibuja fuera de la transformación de zoom para que sea legible siempre. */
export function drawNameplate(ctx, snake, camera, theme, opts = {}) {
  const p = camera.worldToScreen(snake.head.x, snake.head.y);
  const y = p.y - (snake.radius * camera.zoom) - 14;

  ctx.save();
  ctx.font = `600 ${opts.size ?? 12}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const label = snake.name;
  if (opts.shadow !== false) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.62)';
    ctx.strokeText(label, p.x, y);
  }
  ctx.fillStyle = snake.isPlayer ? (theme.ui?.playerName ?? '#ffffff') : (theme.ui?.botName ?? 'rgba(226,238,246,0.82)');
  ctx.fillText(label, p.x, y);

  if (snake.isHunter) {
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#ff7a5c';
    ctx.fillText('◆ te busca', p.x, y - 13);
  }
  ctx.restore();
}
