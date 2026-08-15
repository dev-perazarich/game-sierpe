# Sierpe

Arcade de serpientes para navegador: cinco modos de juego, bots con personalidad
propia y cuatro temas visuales intercambiables en caliente.

Sin dependencias que instalar, sin paso de compilación y sin telemetría. Se sirve
como archivos estáticos y ya funciona.

Inspirado en el género de serpientes multijugador (Slither.io, Snake.io), pero
con motor, IA, modos y arte escritos desde cero.

## Cómo se desarrolló

Este proyecto se programó con **Claude Code** como herramienta de escritura de
código, bajo dirección humana en arquitectura y diseño.

El reparto fue este: las decisiones de arquitectura y producto —prescindir de
paso de compilación, separar el estado autoritativo del renderizado, qué modos
construir, cómo debía sentirse la cámara y el giro, qué dirección visual seguir—
son mías, igual que la revisión y validación de cada resultado. La escritura del
código y las pruebas de verificación las produjo la IA a partir de esas
decisiones.

Se dice abiertamente por dos razones. La primera es que quien lea el código
merece saber cómo se escribió. La segunda es que explica el alcance: un proyecto
de este tamaño (~11.600 líneas, 53 módulos, seis modos y una IA de tres capas)
no habría sido viable en solitario en este plazo. La herramienta comprimió el
tiempo de implementación; no sustituyó los criterios de ingeniería con que se
tomaron las decisiones ni la verificación de que el resultado funciona.

---

## Arrancarlo en local

Los módulos ES nativos no funcionan abriendo el archivo con `file://`: hace falta
servir la carpeta por HTTP. Cualquiera de estas opciones vale:

```bash
# Python (viene con casi todo)
python -m http.server 8000

# Node
npx serve .

# VS Code
# extensión "Live Server" → clic derecho en index.html → Open with Live Server
```

Luego abre `http://localhost:8000`.

## Publicarlo

Es un sitio estático puro, así que no necesita configuración:

- **Vercel** — importa el repositorio, *Framework Preset* en `Other`, deja el
  comando de compilación y el directorio de salida vacíos.
- **GitHub Pages / Netlify / Cloudflare Pages** — sirve la raíz del repositorio.

---

## Modos de juego

| Modo | Duración | En qué consiste |
|---|---|---|
| **Clásico** | Sin límite | Mapa de 11.000×11.000 con 51 rivales. Crece todo lo que puedas. |
| **Cerco** | ≈ 7 min | Battle royale de 40 serpientes con zona que se contrae en seis fases. Sin reaparición. |
| **Dominio** | ≈ 8 min | Tres equipos, cinco nodos que capturar. Los bots aliados atienden tus marcas. |
| **Nido** | Hasta morir | Oleadas con jefes cada cinco rondas y una carta de mejora entre ronda y ronda. |
| **Frenesí** | 3 min | Máxima puntuación con multiplicadores de racha y zonas de bonificación. |
| **Desafío diario** | 3 min | Frenesí con semilla derivada de la fecha: el mismo mundo para todos ese día. |

## Los bots

La IA es lo que más trabajo tiene. Cada bot corre tres capas:

1. **Percepción** — un mapa de peligro angular de 24 rayos y detección de
   *cúmulos* de comida por densidad. Va al centro de masa del mejor montón, no al
   orbe suelto más cercano.
2. **Decisión** — seis estados que compiten por utilidad (`FARM`, `HUNT`,
   `ENCIRCLE`, `FLEE`, `COIL`, `SCAVENGE`), con histéresis para que no vibren
   entre ideas.
3. **Dirección** — *context steering* más una prueba de trazado que simula el
   camino con el radio de giro real y descarta lo que acaba en un cuerpo o en un
   borde.

Cinco rasgos sorteados por bot (agresividad, codicia, cautela, paciencia,
habilidad) hacen que dos rivales del mismo nivel jueguen distinto.

**La dificultad no hace trampas.** Subirla reduce la latencia de reacción
(320 ms → 80 ms) y el ruido de puntería (±0,18 → ±0,02 rad); nunca da más
velocidad ni turbo más barato. Enfrentando bots torpes contra hábiles en el mismo
mundo, los hábiles acumulan un 21 % más de masa y mueren un 15 % menos, corriendo
exactamente igual de rápido.

## Personalización

Editor con vista previa animada: dos colores libres, siete patrones, cinco tipos
de ojos y cuatro estelas de turbo. Los cosméticos se desbloquean jugando, con
logros concretos — nada se compra.

Cuatro temas visuales que se cambian sin recargar: **Panal** (clásico y
colorido), **Abismo** (bioluminiscente), **Circuito** (neón) y **Pradera**
(cartoon).

Ajustes de accesibilidad: reducción de movimiento (respeta también el ajuste del
sistema), alto contraste, distinción de equipos por forma además de color, escala
del HUD y tamaño del minimapa.

---

## Cómo está hecho

Vue 3 desde CDN para las pantallas y el HUD; Canvas 2D para el mundo. Todo el
código propio son módulos ES nativos, sin bundler.

```
index.html
css/            tokens · componentes · pantallas
src/
  config.js     todas las constantes ajustables
  engine/       bucle, mundo, cámara, entrada, colisión, hash espacial, RNG
  entities/     Snake, Orb, Pickup
  ai/           percepción, dirección, comportamientos, personalidades, director
  render/       renderizador, fondo, cuerpo, efectos, minimapa, sprites
  themes/       panal · abismo · circuito · pradera
  modes/        contrato común + los seis modos
  meta/         perfil, logros, cosméticos, almacenamiento
  audio/        sintetizador WebAudio (sin archivos de sonido)
  ui/           componentes Vue
```

Un par de decisiones que explican el resto del código:

- **Paso fijo a 60 Hz con acumulador e interpolación.** La simulación avanza
  siempre en pasos de 16,6 ms, así que el juego va igual a 60 que a 144 Hz.
- **El cuerpo es una cadena, no un rastro.** Cada nodo persigue al anterior a
  distancia fija, con límite de articulación. Eso produce el arrastre real de un
  remolque: al cerrar un cerco la cola recorta la curva por dentro en lugar de
  repetir el camino de la cabeza.
- **El estado autoritativo vive en `engine/world.js` y el renderizador solo lo
  lee.** Nada de `render/` muta una entidad, lo que deja la puerta abierta a
  añadir red más adelante sin tocar la capa visual.

### Ajustar el juego

Casi todo el balance está en [`src/config.js`](src/config.js):

| Constante | Qué controla |
|---|---|
| `turnRateSmall` / `turnRateBig` | Cuánto cierra el giro según el grosor |
| `maxBend` | Cuánto puede enrollarse el cuerpo (y cuánto arrastra la cola) |
| `boostMassPerSec` | Lo que cuesta acelerar |
| `orbDensity` | Comida por millón de píxeles cuadrados |
| `radiusEase` | Cómo de rápido engorda al comer |

El tamaño del mundo y la población de cada modo están en su archivo de
`src/modes/`.

---

## Estado

Jugable y completo en sus seis modos. El motor, la IA y los modos están
verificados con simulaciones sin navegador; el apartado visual está probado con
menos profundidad, así que si algo se ve raro en tu resolución o navegador, los
issues son bienvenidos.

Rendimiento medido: 1,3–3,0 ms de lógica por paso con 52 serpientes y 4.600
orbes, sobre un presupuesto de 4 ms.

## Licencia

**GNU Affero General Public License v3.0** — texto completo en [LICENSE](LICENSE).

Copyright © 2026 dev-perazarich

En corto, y sin que esto sustituya al texto legal:

- Puedes usar, estudiar, modificar y redistribuir este juego libremente.
- Si publicas una versión modificada, **debes publicar su código completo** bajo
  esta misma licencia.
- Eso incluye **alojarlo en un servidor**: aunque no distribuyas archivos, si
  ofreces el juego a través de una red tienes que ofrecer también su código. Es
  la diferencia entre la AGPL y la GPL corriente, y es deliberada — este es un
  juego de navegador.
- Hay que mantener el aviso de autoría.

El titular del copyright conserva todos sus derechos sobre la obra y puede
otorgar licencias comerciales distintas a quien las solicite. Si quieres usar
este código en un producto cerrado, abre un issue.
