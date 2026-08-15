/*
 * Sierpe — predicción local y reconciliación del cliente.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * prediction.js — Tu serpiente se mueve YA; la verdad llega después.
 *
 * ── El problema ──
 *
 * Si el cliente espera a que el anfitrión le confirme dónde está, entre mover el
 * dedo y ver girar la serpiente pasa un viaje de ida y vuelta entero: 50 ms en
 * el mejor caso, 200 ms en datos móviles. A 158 u/s eso son hasta 32 unidades de
 * retraso, cuatro veces el grosor de una serpiente delgada. Es injugable.
 *
 * La solución: el cliente simula SU PROPIA serpiente en cuanto lee la entrada, y
 * cuando llega el paquete del anfitrión corrige la diferencia. El anfitrión
 * sigue siendo la autoridad; la predicción solo adelanta lo que va a decir.
 *
 * ── Las tres decisiones que importan ──
 *
 * 1. HACIA DELANTE se reutiliza `snake.step()`, el mismo código que corre el
 *    anfitrión. Duplicar la integración sería la forma más segura de que las
 *    dos versiones se separaran con el tiempo.
 *
 * 2. HACIA ATRÁS (reaplicar entradas tras una corrección) se usa un integrador
 *    ESCALAR que solo reconstruye cabeza, ángulo, masa y grosor. Ver
 *    `pasoEscalar()` para el porqué: reaplicar con `step()` exigiría guardar el
 *    espinazo entero de cada tick y volver a recorrer 212 nodos por tick
 *    reaplicado, veinte veces por segundo.
 *
 * 3. La corrección suave NO toca el estado lógico. Se guarda como un
 *    desplazamiento visual que decae. Ver `actualizar()`.
 *
 * ── El cuerpo ──
 *
 * El cuerpo es una cadena de remolque: cada nodo persigue al anterior a
 * distancia fija. Eso significa que mover la cabeza deforma el cuerpo entero, y
 * que un salto de la cabeza se propaga como un latigazo hasta la cola.
 *
 * Por eso la corrección suave es un desplazamiento de DIBUJO aplicado a la
 * serpiente completa: al trasladar cabeza y cuerpo por igual, la forma no se
 * altera y la serpiente se desliza entera como una pieza rígida hasta
 * coincidir con la verdad. Si en su lugar se moviera solo la cabeza lógica y se
 * dejara que `_followChain()` absorbiera el error, cada paquete —veinte por
 * segundo— metería una ondulación en el cuerpo.
 *
 * En la corrección dura sí se acepta el salto: se resiembra el cuerpo estirado
 * detrás de la cabeza, como al nacer. Es lo correcto porque los únicos errores
 * de ese tamaño son teletransportes reales (reaparición), y sin resembrar
 * `_followChain()` dejaría el cuerpo apuntando al lugar ANTERIOR durante varios
 * segundos.
 *
 * ── Uso previsto ──
 *
 *   const pred = new Prediccion({ snake: miSerpiente });
 *   // en cada paso de simulación:
 *   pred.registrarEntrada(tick, angulo, turbo);
 *   canal.send(encodeInput(tick, angulo, turbo));
 *   // al recibir un paquete de estado:
 *   pred.reconciliar(miSerpiente, estadoDeMiSerpiente, snap.ackInput);
 *   // en cada fotograma dibujado:
 *   pred.actualizar(dtReal);
 *   const p = pred.posicionVisual(miSerpiente);   // cámara y dibujo
 *
 * Módulo puro: sin DOM, sin WebRTC, sin Vue. Se puede probar en Node.
 */

import { CFG, STEP, radiusForMass, turnRateForRadius } from '../config.js';
import { damp, turnToward, wrapAngle } from '../engine/math.js';

/**
 * Valores por defecto, deducidos de la física del juego y de la cuantización
 * del protocolo. Cada número está justificado; no son gustos.
 */
export const UMBRALES_POR_DEFECTO = {
  /**
   * Zona muerta, en unidades. Por debajo no se corrige nada.
   *
   * El protocolo manda la posición en 16 bits con precisión de media unidad, así
   * que TODO paquete llega con hasta 0,25 u de error de redondeo que no es un
   * fallo de predicción y no se puede eliminar. A eso se suma la deriva por el
   * ángulo cuantizado (ver `umbralAngulo`). Corregir por debajo de 0,5 u sería
   * perseguir ruido de codificación: la serpiente vibraría sin motivo.
   */
  umbralMuerto: 0.5,

  /**
   * Frontera entre corrección suave y salto seco, en unidades.
   *
   * El error legítimo más grande que produce una predicción sana es equivocarse
   * en el turbo durante un viaje de ida y vuelta completo: con 200 ms de ping son
   * 12 pasos, y la diferencia entre nadar y acelerar es (306 − 158) / 60 = 2,47 u
   * por paso, o sea unas 30 u. Ese caso debe resolverse suavemente.
   *
   * 96 u deja un factor de tres sobre ese peor caso razonable y sigue siendo
   * pequeño frente a cualquier discontinuidad real: reaparecer mueve miles de
   * unidades. Son además unos tres diámetros de la serpiente más gorda, el punto
   * en el que deslizar la corrección ya se vería peor que aceptarla de golpe.
   */
  umbralDuro: 96,

  /**
   * Ritmo de desvanecimiento del desplazamiento visual, en 1/s.
   *
   * Con 10/s el error se reduce a la mitad cada 69 ms y desaparece al 99 % en
   * 460 ms. La cota inferior la pone la frecuencia de paquetes: llegan cada
   * 50 ms, y en ese hueco se resuelve el 39 % de la corrección, suficiente para
   * que las correcciones sucesivas converjan en vez de acumularse. La cota
   * superior la pone el ojo: más rápido y el desvanecimiento vuelve a parecer un
   * salto, que es justo lo que se quería evitar.
   */
  tasaDecaimiento: 10,

  /**
   * Tope de la velocidad aparente de la corrección, en u/s.
   *
   * Sin tope, un error de 90 u decayendo al 10/s se mueve a 886 u/s en el primer
   * fotograma: la serpiente parece patinar de lado más rápido de lo que puede
   * nadar, y el ojo lo lee como un fallo. Limitarlo a 320 u/s —justo por encima
   * de la velocidad con turbo, 306— hace que la corrección nunca supere lo que
   * el jugador ya acepta como movimiento posible.
   */
  velocidadMaxCorreccion: 320,

  /**
   * Divergencia angular a partir de la cual se adopta el ángulo del anfitrión,
   * en radianes.
   *
   * Normalmente NO se usa el ángulo recibido: viene en 8 bits, 1,4° de
   * resolución, y el propio protocolo documenta que solo sirve para orientar los
   * ojos. Nuestro ángulo predicho sale de las mismas entradas con precisión
   * completa, así que es MEJOR que el transmitido, y sembrar la reaplicación con
   * el cuantizado inyectaría hasta 0,7° de error en cada paquete.
   *
   * Pero si el anfitrión aplicó algo que el cliente no conoce —un multiplicador
   * de giro de una carta, un rebote—, el ángulo sí diverge de verdad. 0,25 rad
   * (14°) es veinte veces el ruido de cuantización: por debajo se ignora, por
   * encima manda el anfitrión.
   */
  umbralAngulo: 0.25,

  /**
   * Entradas guardadas. 128 pasos son 2,1 s a 60 Hz, diez veces el peor viaje
   * de ida y vuelta esperado. El anillo se reserva entero al construir, así que
   * el coste es fijo y no hay una sola asignación por tick.
   */
  capacidad: 128,
};

/* ═══════════════ Historial circular ═══════════════ */

/**
 * Cada ranura guarda la entrada de un tick y la pose que la predicción produjo
 * al aplicarla. La pose es lo que permite medir el error contra el paquete del
 * anfitrión: sin ella solo sabríamos dónde estamos AHORA, no dónde creíamos
 * estar en el tick que el anfitrión acaba de confirmar.
 */
function ranuraVacia() {
  return {
    tick: -1,
    angulo: 0,
    turbo: false,
    pose: false,       // ¿se llegó a simular este tick?
    x: 0,
    y: 0,
    angle: 0,
    mass: 0,
    radius: 0,
  };
}

/* ═══════════════ Integrador escalar ═══════════════ */

/**
 * Avanza un paso reproduciendo EXACTAMENTE la aritmética de `Snake.step()`,
 * pero solo sobre las magnitudes escalares: cabeza, ángulo, masa y grosor.
 *
 * ── Por qué no se reutiliza `snake.step()` aquí ──
 *
 * Reaplicar con `step()` obligaría a restaurar el estado completo de la
 * serpiente en el tick confirmado, y el estado completo incluye el espinazo:
 * hasta 212 nodos, 424 números. Guardar eso en cada uno de los 128 ticks del
 * historial son 54.000 números en vuelo y una copia por tick; y cada
 * reconciliación volvería a recorrer la cadena entera por cada tick reaplicado
 * —12 ticks × 212 nodos, veinte veces por segundo— para tirar todos los
 * resultados intermedios menos el último.
 *
 * No hace falta. El cuerpo es una función del recorrido de la cabeza: basta
 * corregir la cabeza y dejar que la cadena la siga UNA vez al final, que es
 * justo el mismo argumento por el que el protocolo no transmite cuerpos. Y para
 * la serpiente local el cuerpo es además puramente cosmético: quien decide sus
 * colisiones es el anfitrión.
 *
 * CUIDADO AL MANTENER: esto es la única duplicación de lógica del módulo y es
 * deliberada. Si cambia el orden o la fórmula de `Snake.step()` —el suavizado
 * del grosor ANTES del giro, el coste del turbo ANTES del avance— hay que
 * cambiarlo aquí. Cualquier discrepancia se ve como una corrección constante
 * que nunca converge.
 */
export function pasoEscalar(sim, entrada, dt) {
  const s = CFG.snake;

  // Espejo de Snake.step(): el grosor persigue a la masa, y el giro usa el
  // grosor YA suavizado de este paso.
  sim.radius = damp(sim.radius, radiusForMass(sim.mass), s.radiusEase, dt);

  const maxTurn = turnRateForRadius(sim.radius) * sim.turnMul * dt;
  sim.angle = turnToward(sim.angle, entrada.angulo, maxTurn);

  // canBoost() se evalúa ANTES de descontar, igual que en el original.
  let turbo = entrada.turbo;
  if (turbo && sim.mass > s.minMass) {
    sim.mass = Math.max(s.minMass, sim.mass - s.boostMassPerSec * dt);
  } else {
    turbo = false;
  }

  const sp = (turbo ? s.boostSpeed : s.baseSpeed) * sim.speedMul * dt;
  sim.x += Math.cos(sim.angle) * sp;
  sim.y += Math.sin(sim.angle) * sp;
  sim.recorrido += sp;
  return sim;
}

/* ═══════════════ Predicción ═══════════════ */

export class Prediccion {
  /**
   * @param {object}  opciones
   * @param {object}  opciones.snake   serpiente local (puede fijarse después)
   * @param {object}  opciones.mundo   se pasa tal cual a Snake.step()
   * @param {number}  opciones.paso    duración del paso de simulación
   */
  constructor(opciones = {}) {
    const cfg = { ...UMBRALES_POR_DEFECTO, ...opciones };

    this.snake = opciones.snake ?? null;
    this.paso = opciones.paso ?? STEP;

    // Snake.step(dt, world) declara `world` pero no lo usa en ninguna línea de
    // su cuerpo (comprobado en src/entities/Snake.js): el paso de la serpiente
    // es independiente del mundo, y por eso la predicción puede ejecutarlo sin
    // tener un World construido. Se guarda y se pasa igualmente por si algún día
    // deja de ser cierto.
    this.mundo = opciones.mundo ?? null;

    this.umbralMuerto = cfg.umbralMuerto;
    this.umbralDuro = cfg.umbralDuro;
    this.tasaDecaimiento = cfg.tasaDecaimiento;
    this.velocidadMaxCorreccion = cfg.velocidadMaxCorreccion;
    this.umbralAngulo = cfg.umbralAngulo;
    this.capacidad = Math.max(8, cfg.capacidad | 0);

    this._aro = new Array(this.capacidad);
    for (let i = 0; i < this.capacidad; i++) this._aro[i] = ranuraVacia();

    this.ultimoTick = -1;
    this.tickConfirmado = -1;

    // Desplazamiento visual pendiente. Es lo ÚNICO que separa lo que se dibuja
    // de lo que se simula. Ver actualizar().
    this._desp = { x: 0, y: 0 };

    // ¿Hay alguien desvaneciendo desde el bucle de dibujo? Lo decide la primera
    // llamada a actualizar(); mientras tanto se desvanece por paso de simulación.
    this._decaeExterno = false;

    // Estado de trabajo de la reaplicación, reservado una vez: reconciliar()
    // corre veinte veces por segundo y no debe alimentar al recolector.
    this._sim = {
      x: 0, y: 0, angle: 0, mass: 0, radius: 0,
      speedMul: 1, turnMul: 1, recorrido: 0,
    };
    this._salida = { tipo: 'ninguna', error: 0, dura: false, reaplicados: 0 };
    this._pos = { x: 0, y: 0 };

    this.stats = this._statsVacias();
  }

  _statsVacias() {
    return {
      reconciliaciones: 0,        // paquetes que produjeron corrección
      reconciliacionesGrandes: 0, // las que superaron umbralDuro
      muestras: 0,                // errores medidos (incluye los de zona muerta)
      sumaError: 0,
      errorMedio: 0,
      errorMaximo: 0,
      ultimoError: 0,
      entradasPerdidas: 0,        // ticks sin entrada guardada al reaplicar
      sinReferencia: 0,           // acuses sin pose predicha con que compararse
      historialDesbordado: 0,     // confirmaciones más viejas que el historial
      correccionesAngulo: 0,
    };
  }

  /** La serpiente local nace al entrar en la sala, no al construir esto. */
  establecerSerpiente(snake) {
    this.snake = snake ?? null;
    this.reiniciar();
    return this.snake;
  }

  /* ── Entrada ──────────────────────────────────────────────────────────── */

  _ranura(tick) {
    const c = this.capacidad;
    return this._aro[((tick % c) + c) % c];
  }

  /**
   * Guarda la entrada del tick y la aplica de inmediato a la serpiente local.
   *
   * El envío al anfitrión es cosa del transporte; aquí solo se predice. La pose
   * resultante se anota en la ranura para poder medir después el error contra la
   * verdad que confirme ese mismo tick.
   */
  registrarEntrada(tick, angulo, turbo) {
    const e = this._ranura(tick);
    e.tick = tick;
    e.angulo = angulo;
    e.turbo = !!turbo;
    e.pose = false;

    if (tick > this.ultimoTick) this.ultimoTick = tick;

    // Solo se adelanta la serpiente si esta instancia la tiene fijada. Quien
    // prefiera llevar el paso a mano llama después a aplicarPaso(); la pose se
    // anota igual por cualquiera de las dos vías y nunca se avanza dos veces.
    const snake = this.snake;
    if (snake && snake.alive) this.aplicarPaso(snake, e, this.paso);

    // Respaldo del desvanecimiento: si el bucle de dibujo no llama a
    // actualizar(), la deuda visual se desvanece igualmente al ritmo de la
    // simulación. Sin esto, una integración que solo use el estado lógico
    // acumularía desplazamiento para siempre.
    if (!this._decaeExterno) this._decaer(this.paso);
    return e;
  }

  /**
   * Avanza la serpiente local un paso con una entrada dada.
   *
   * Se delega en `snake.step()` a propósito: es literalmente el mismo código que
   * ejecutará el anfitrión sobre esta misma entrada, así que la predicción no
   * puede desviarse por una fórmula reescrita. El giro limitado por el radio, el
   * suavizado del grosor, el coste del turbo y el avance salen de allí sin
   * copiarse.
   *
   * `boosting` se asigna en crudo, sin comprobar canBoost(): step() ya lo apaga
   * solo si no hay masa, y replicar esa comprobación aquí sería una segunda
   * versión de la misma regla.
   *
   * Los orbes que devuelve step() al soltar cola se DESCARTAN. La comida la
   * gobierna el anfitrión y llega por su propio mensaje; crearlos también aquí
   * los duplicaría en pantalla y luego desaparecerían al llegar la foto real.
   */
  aplicarPaso(snake, entrada, dt = this.paso) {
    if (!snake || !snake.alive) return null;
    if (typeof snake.aimAngle === 'function') snake.aimAngle(entrada.angulo);
    else snake.targetAngle = entrada.angulo;
    snake.boosting = entrada.turbo;
    snake.step(dt, this.mundo);
    this._anotarPose(entrada, snake);
    return snake;
  }

  /**
   * Guarda en el historial la pose que produjo la entrada de ese tick.
   *
   * Es la pieza que hace posible medir el error: cuando llega un paquete que
   * confirma el tick N, hay que comparar la verdad con lo que se predijo PARA N,
   * no con dónde está la cabeza ahora, que va un viaje de ida y vuelta por
   * delante. Sin esta anotación el error medido sería el avance de esos ~12
   * pasos —unas 30 u con 200 ms de ping— y la reconciliación creería estar
   * fallando siempre.
   *
   * Se anota desde aplicarPaso() y no desde registrarEntrada() para que funcione
   * igual tanto si esta clase lleva el paso como si lo lleva quien la usa.
   */
  _anotarPose(entrada, snake) {
    const tick = entrada?.tick;
    if (!Number.isFinite(tick)) return;
    const e = this._ranura(tick);
    if (e.tick !== tick) {
      // aplicarPaso() usado sin registrarEntrada() previo: se completa la ranura
      // para que la entrada siga estando disponible al reaplicar.
      e.tick = tick;
      e.angulo = entrada.angulo;
      e.turbo = !!entrada.turbo;
      if (tick > this.ultimoTick) this.ultimoTick = tick;
    }
    e.x = snake.head.x;
    e.y = snake.head.y;
    e.angle = snake.angle;
    e.mass = snake.mass;
    e.radius = snake.radius;
    e.pose = true;
  }

  /* ── Reconciliación ───────────────────────────────────────────────────── */

  /**
   * Incorpora la verdad del anfitrión para un tick ya confirmado.
   *
   * @param {object} snake               serpiente local
   * @param {object} estadoAutoritativo  {x, y, angle, mass, alive} del paquete
   * @param {number} tickConfirmado      último tick de entrada procesado (ackInput)
   * @returns {object} resumen reutilizado: {tipo, error, dura, reaplicados}
   */
  reconciliar(snake, estadoAutoritativo, tickConfirmado) {
    const r = this._salida;
    r.tipo = 'ninguna';
    r.error = 0;
    r.dura = false;
    r.reaplicados = 0;

    const est = estadoAutoritativo;
    if (!snake || !est) return r;

    // ── Acuse ya superado ──
    //
    // El canal de estado es {ordered:false, maxRetransmits:0}, así que un paquete
    // puede adelantar a otro más nuevo y dejar un acuse retrasado. Procesarlo no
    // solo no aporta nada: hace daño. Las entradas de ese hueco ya las descartó
    // limpiarHistorial() al procesar el acuse más reciente, de modo que el bucle
    // de reaplicación arranca sin semilla y se SALTA esos pasos en vez de
    // repetirlos; la cabeza retrocede justo lo que el anfitrión ya había nadado.
    //
    // Descartarlo no puede perder una muerte: el anfitrión solo aumenta
    // `ultimoTickEntrada` (host.js rechaza las entradas viejas), así que un
    // acuse atrasado viene de una instantánea generada ANTES que la ya
    // procesada, y la muerte es persistente hasta que reaparecer llame a
    // reiniciar(), que devuelve tickConfirmado a -1.
    if (tickConfirmado < this.tickConfirmado) return r;
    this.tickConfirmado = tickConfirmado;

    // Muerte: la decide el anfitrión y no hay nada que predecir ni que suavizar.
    // Se coloca el cadáver donde él dice y se tira el desplazamiento pendiente;
    // la animación de muerte tapa cualquier salto. Marcar `alive` es cosa de
    // quien gestiona la conexión: aquí no se decide quién vive.
    if (est.alive === false) {
      this._colocar(snake, est.x, est.y, est.angle, est.mass, snake.radius, 0, true);
      this._desp.x = 0;
      this._desp.y = 0;
      this.limpiarHistorial(tickConfirmado);
      r.tipo = 'muerte';
      r.dura = true;
      return r;
    }

    // ── a) Error entre lo que predijimos para ese tick y lo que ocurrió ──
    //
    // Sin la pose que predijimos PARA ese tick no hay nada con que medir. Medir
    // contra la cabeza de ahora no da el error: da el ADELANTO de la predicción,
    // un viaje de ida y vuelta de avance —hasta 5,1 u por paso con turbo— que es
    // el funcionamiento normal del módulo, no un fallo. Y ese número es el que
    // decide entre corrección suave y salto seco: con 21 pasos pendientes
    // declara más de 100 u y resiembra el cuerpo estirado sin motivo alguno.
    //
    // Se prefiere no corregir. El acuse siguiente llega 50 ms después y sí trae
    // referencia; perder una corrección es intrascendente comparado con inventar
    // un teletransporte.
    const conf = this._ranura(tickConfirmado);
    if (conf.tick !== tickConfirmado || !conf.pose) {
      this.stats.sinReferencia++;
      this.limpiarHistorial(tickConfirmado);
      return r;
    }
    const error = Math.hypot(conf.x - est.x, conf.y - est.y);

    this.stats.muestras++;
    this.stats.sumaError += error;
    this.stats.errorMedio = this.stats.sumaError / this.stats.muestras;
    if (error > this.stats.errorMaximo) this.stats.errorMaximo = error;
    this.stats.ultimoError = error;
    r.error = error;

    // ── Zona muerta: por debajo del ruido de cuantización no hay nada real que
    // corregir, y reaplicar sería trabajo para reproducir el mismo estado ──
    const dura = error >= this.umbralDuro;
    if (!dura && error < this.umbralMuerto) {
      this.limpiarHistorial(tickConfirmado);
      return r;
    }

    // ── Semilla de la reaplicación ──
    const sim = this._sim;
    sim.x = est.x;
    sim.y = est.y;
    sim.mass = est.mass;

    // El ángulo NO se toma del paquete salvo divergencia real. Llega en 8 bits
    // (1,4°) y el propio protocolo avisa de que solo sirve para los ojos: sobre
    // 12 pasos reaplicados, 0,7° de error de redondeo son 0,4 u de desvío
    // lateral que volveríamos a "corregir" en el paquete siguiente, para siempre.
    // Nuestro ángulo predicho viene de las mismas entradas sin cuantizar.
    const anguloPredicho = conf.angle;
    const desvio = Math.abs(wrapAngle(est.angle - anguloPredicho));
    if (desvio > this.umbralAngulo || dura) {
      sim.angle = est.angle;
      if (!dura) this.stats.correccionesAngulo++;
    } else {
      sim.angle = anguloPredicho;
    }

    // El grosor no se transmite: es una función suavizada de la masa y su
    // continuidad es local. Se retoma el nuestro de ese tick en lugar de
    // recalcularlo, que borraría el suavizado y re-espaciaría el cuerpo de golpe.
    sim.radius = conf.radius;

    // Los multiplicadores los concede el anfitrión y no viajan en el paquete de
    // estado. Se usan los locales: si el anfitrión otorga uno que aquí no consta,
    // el desajuste aparece como error de posición y se corrige por esa vía.
    sim.speedMul = snake.speedMul ?? 1;
    sim.turnMul = snake.turnMul ?? 1;
    sim.recorrido = 0;

    // La ranura del tick confirmado pasa a guardar la VERDAD, no lo que se
    // predijo: acabamos de aceptarla y es la mejor información que tenemos de
    // dónde estábamos en ese tick. Es la misma actualización que el bucle de
    // abajo hace con los ticks posteriores.
    //
    // Importa porque el anfitrión repite acuse: mientras no le llega una entrada
    // nueva sigue simulando, así que la instantánea siguiente trae el MISMO tick
    // confirmado y una posición algo más avanzada. Con la pose predicha original
    // ahí, esa segunda instantánea volvería a medir el error entero ya corregido
    // y lo sumaría por segunda vez; con la verdad, mide solo lo que el anfitrión
    // ha avanzado desde entonces, que es lo único nuevo que cuenta.
    conf.x = est.x;
    conf.y = est.y;
    conf.angle = sim.angle;
    conf.mass = est.mass;
    conf.radius = sim.radius;

    // ── d) Reaplicar las entradas posteriores al tick confirmado ──
    let desde = tickConfirmado + 1;
    const minimo = this.ultimoTick - this.capacidad + 1;
    if (desde < minimo) {
      desde = minimo;
      this.stats.historialDesbordado++;
    }

    let ultima = null;
    for (let t = desde; t <= this.ultimoTick; t++) {
      const e = this._ranura(t);
      const valida = e.tick === t;
      if (valida) ultima = e;
      else this.stats.entradasPerdidas++;

      // Hueco en el historial: se repite la última entrada conocida. El
      // anfitrión DEBE hacer lo mismo cuando pierde un paquete de entrada; si él
      // congela el giro y aquí se repite (o al revés), las dos simulaciones se
      // separan de forma sistemática y la corrección no converge nunca.
      const usar = valida ? e : ultima;
      if (!usar) continue;

      pasoEscalar(sim, usar, this.paso);
      r.reaplicados++;

      if (valida) {
        e.x = sim.x;
        e.y = sim.y;
        e.angle = sim.angle;
        e.mass = sim.mass;
        e.radius = sim.radius;
        e.pose = true;
      }
    }

    // ── b) y c) Aplicar el resultado ──
    const viejoX = snake.head.x;
    const viejoY = snake.head.y;

    // Posición lógica que se va a escribir. En la corrección suave puede acabar
    // separándose de `sim` para compensar el recorte de la deuda; ver abajo.
    let posX = sim.x;
    let posY = sim.y;
    let despX = 0;
    let despY = 0;

    if (!dura) {
      // El estado lógico pasa a ser el corregido, y la diferencia se guarda como
      // deuda de DIBUJO: la serpiente sigue viéndose donde estaba y camina hacia
      // la verdad en los fotogramas siguientes.
      despX = this._desp.x + (viejoX - sim.x);
      despY = this._desp.y + (viejoY - sim.y);

      // Cota de seguridad: por definición una deuda mayor que umbralDuro habría
      // entrado por el camino del salto seco. Limitarla evita que se acumule sin
      // fin si el desvanecimiento no llega a correr.
      //
      // Lo recortado hay que DEVOLVÉRSELO a la posición lógica. posicionVisual()
      // es cabeza + deuda: recortar solo la deuda traslada la diferencia entera
      // al dibujo y produce en un fotograma justo el salto que esta rama existe
      // para evitar. Compensando, el dibujo no se mueve ni un ápice y lo que
      // absorbe el recorte es el estado lógico, que el acuse siguiente vuelve a
      // corregir.
      const m = Math.hypot(despX, despY);
      if (m > this.umbralDuro) {
        const k = this.umbralDuro / m;
        posX += despX * (1 - k);
        posY += despY * (1 - k);
        despX *= k;
        despY *= k;
      }
    }

    this._colocar(snake, posX, posY, sim.angle, sim.mass, sim.radius, sim.recorrido, dura);

    this.stats.reconciliaciones++;
    if (dura) {
      // Error enorme: nada que disimular. Deslizar mil unidades sería peor que
      // el salto, y el cuerpo ya se ha resembrado detrás de la cabeza nueva.
      this.stats.reconciliacionesGrandes++;
      this._desp.x = 0;
      this._desp.y = 0;
      r.tipo = 'dura';
      r.dura = true;
    } else {
      this._desp.x = despX;
      this._desp.y = despY;
      r.tipo = 'suave';
    }

    this.limpiarHistorial(tickConfirmado);
    return r;
  }

  /**
   * Escribe el estado corregido en la serpiente y deja que el cuerpo la siga.
   *
   * Todo el acoplamiento con Snake vive AQUÍ, en una sola función, para que un
   * cambio en la serpiente tenga un único sitio que arreglar.
   *
   * ── Por qué NO se usa `setReplayPose()` ──
   *
   * Era la vía elegida, por ser la pública que ya emplean los fantasmas. Pero
   * fija `_radius = radiusForMass(masa)` SIN transición y solo después reconstruye
   * la cadena, y `nodeSpacing` escala con el grosor: el espinazo quedaba
   * re-espaciado con un grosor que la serpiente ya no declara. Reponer `_radius`
   * a continuación no lo deshacía —la cadena ya estaba estirada— así que la
   * serpiente terminaba con `radius` 12,78, `nodeSpacing` 10,86 y una separación
   * REAL de 16,18: 1,49× de desajuste, el cuerpo dibujado un 49 % más largo y
   * `_fitNodeCount()` contando 37 nodos donde tocaban 54.
   *
   * De sus efectos, los tres únicos que aquí valían —encadenar, ajustar el número
   * de nodos y recalcular los límites— son los que se llaman abajo, ya con el
   * grosor definitivo puesto. Los otros tres (ángulo deducido del desplazamiento,
   * `traveled` sumando el salto, grosor sin suavizar) había que deshacerlos uno a
   * uno de todos modos. Es la misma cadena que corre `Snake.step()`, en el mismo
   * orden y con el mismo grosor: no hay una segunda versión de nada.
   */
  _colocar(snake, x, y, angulo, masa, radio, recorrido, dura) {
    const recorridoPrevio = snake.traveled;

    // En un salto duro el grosor se fija sin transición, por el mismo motivo que
    // documenta Snake.respawn(): venimos de una discontinuidad, y arrastrar el
    // grosor suavizado sembraría el cuerpo con el que tenía antes de morir. En la
    // corrección suave se conserva el nuestro de ese tick: el grosor no se
    // transmite, es una función suavizada de la masa y su continuidad es local.
    const radioFinal = dura ? radiusForMass(masa) : radio;

    // La masa y el grosor van ANTES de tocar el cuerpo: de ellos salen bodyArc y
    // nodeSpacing, y de esos dos el espaciado y el número de nodos.
    snake.mass = masa;
    snake._radius = radioFinal;

    // Tras un teletransporte, _followChain() conserva la separación pero deja el
    // cuerpo apuntando hacia donde estaba antes: una serpiente recta señalando
    // el otro extremo del mapa hasta que nade lo suficiente. Resembrarla estirada
    // detrás de la cabeza es exactamente lo que hace nacer o reaparecer.
    if (dura) this._sembrarCuerpo(snake, x, y, angulo);

    snake.head.x = x;
    snake.head.y = y;
    snake.spine[0] = x;
    snake.spine[1] = y;

    // El ángulo es el de la reaplicación, no el del desplazamiento: el salto de
    // corrección no es la dirección de nado. `targetAngle` no se toca, que lo
    // gobierna la entrada del jugador.
    snake.angle = angulo;

    // `traveled` es el desfase del patrón del cuerpo y mide distancia NADADA.
    // Sumarle el salto haría que la textura pegara un tirón en cada paquete,
    // veinte veces por segundo. Se le suma solo lo que la reaplicación nadó.
    snake.traveled = recorridoPrevio + recorrido;

    // Misma secuencia y mismo orden que el final de Snake.step().
    snake._followChain();
    snake._fitNodeCount();
    snake._updateBounds();
  }

  /** Espejo de Snake._seedChain(): cuerpo estirado hacia atrás desde la cabeza. */
  _sembrarCuerpo(snake, x, y, angulo) {
    const sep = snake.nodeSpacing;
    const n = Math.max(2, Math.round(snake.bodyArc / sep));
    const s = snake.spine;
    s.length = 0;
    for (let i = 0; i < n; i++) {
      s.push(x - Math.cos(angulo) * i * sep, y - Math.sin(angulo) * i * sep);
    }
    snake.spineStep = sep;
    snake.head.x = x;
    snake.head.y = y;
  }

  /**
   * Descarta las entradas ANTERIORES a la que el anfitrión ha confirmado.
   *
   * La del propio tick confirmado se conserva: es la pose de referencia contra
   * la que reconciliar() mide el error, y el anfitrión repite acuse a menudo
   * —solo avanza `ultimoTickEntrada` cuando le LLEGA una entrada, y las manda
   * sesenta por segundo por un canal sin garantías, así que basta un hueco entre
   * dos instantáneas de 20 Hz—. Borrándola, el acuse repetido se quedaba sin
   * referencia y el módulo medía el adelanto de la predicción como si fuera
   * error: más de 100 u declaradas con 2,6 u reales, y un salto duro que
   * resembraba el cuerpo recto sin ningún motivo.
   */
  limpiarHistorial(tickConfirmado) {
    for (let i = 0; i < this.capacidad; i++) {
      const e = this._aro[i];
      if (e.tick >= 0 && e.tick < tickConfirmado) {
        e.tick = -1;
        e.pose = false;
      }
    }
  }

  /* ── Suavizado visual ─────────────────────────────────────────────────── */

  /**
   * Desvanece el desplazamiento pendiente. Se llama una vez por fotograma
   * DIBUJADO, con el dt real, no por paso de simulación: es una corrección de
   * presentación y debe verse igual a 60 que a 144 Hz.
   *
   * El decaimiento es exponencial —misma familia que `damp()`, independiente de
   * la tasa de refresco— con un tope de velocidad para que una corrección grande
   * no arranque con un patinazo.
   */
  actualizar(dt) {
    // A partir de la primera llamada, el desvanecimiento lo gobierna el bucle de
    // dibujo y se apaga el de respaldo por paso de simulación, para no
    // desvanecer dos veces.
    this._decaeExterno = true;
    this._decaer(dt);
  }

  _decaer(dt) {
    const d = this._desp;
    const mag = Math.hypot(d.x, d.y);
    if (mag < 1e-3) {
      d.x = 0;
      d.y = 0;
      return;
    }
    let restante = mag * Math.exp(-this.tasaDecaimiento * dt);
    const maxPaso = this.velocidadMaxCorreccion * dt;
    if (mag - restante > maxPaso) restante = mag - maxPaso;
    const k = restante / mag;
    d.x *= k;
    d.y *= k;
  }

  /** Deuda de corrección pendiente, en unidades de mundo. */
  get desplazamiento() {
    return this._desp;
  }

  get errorVisible() {
    return Math.hypot(this._desp.x, this._desp.y);
  }

  /**
   * Punto donde debe DIBUJARSE la cabeza. La cámara tiene que usar este mismo
   * punto: si siguiera a la cabeza lógica mientras la serpiente se dibuja
   * desplazada, el mundo resbalaría bajo una serpiente aparentemente quieta.
   *
   * El mismo desplazamiento se suma a todos los nodos del cuerpo al dibujar; así
   * la serpiente se traslada entera y su forma no se deforma.
   */
  posicionVisual(snake) {
    const s = snake ?? this.snake;
    this._pos.x = (s ? s.head.x : 0) + this._desp.x;
    this._pos.y = (s ? s.head.y : 0) + this._desp.y;
    return this._pos;
  }

  /* ── Estado y estadísticas ────────────────────────────────────────────── */

  /** Tras reaparecer o reconectar: el historial anterior ya no describe nada. */
  reiniciar() {
    for (let i = 0; i < this.capacidad; i++) {
      this._aro[i].tick = -1;
      this._aro[i].pose = false;
    }
    this.ultimoTick = -1;
    this.tickConfirmado = -1;
    this._desp.x = 0;
    this._desp.y = 0;
  }

  reiniciarEstadisticas() {
    this.stats = this._statsVacias();
  }

  /** Copia plana para el panel de depuración. */
  estadisticas() {
    return {
      ...this.stats,
      errorVisible: this.errorVisible,
      pendientes: this.ultimoTick - this.tickConfirmado,
    };
  }
}
