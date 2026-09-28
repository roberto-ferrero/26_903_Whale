# Fase 2 · Base del proyecto Three.js

28/09/2026 · Three.js r186 (`WebGPURenderer`) · lil-gui 0.21

## Resumen

- El visor de la Fase 1 pasa a ser la **base del proyecto**: módulos independientes, cada uno con un **estado plano** y una función **`apply()`**. Eso permite presets en JSON, guardar el estado en la URL y un panel con una carpeta por módulo.
- **"Hecho cuando" cumplido:** la ballena **nada y salta sola en una escena gris placeholder** (fondo gris, niebla, plano de agua y rejilla como fondo marino), con la GUI funcionando.
- **Novedades:**
  - Reloj de simulación con pausa, cámara lenta y avance fotograma a fotograma.
  - 6 presets y estado en la URL.
  - Cámaras orbital, de seguimiento y cinemática: 4 raíles más un director que corta según el estado de la ballena.
  - Máquina de estados con nado libre y salto en la dirección en la que va.
  - Vistas de buffer y línea de tiempo del salto en la que se puede hacer clic.
- **Atajos de teclado:** `Espacio` = pausa · `.` = avanzar un fotograma · `J` = saltar ahora · `C` = cambiar de modo de cámara.

## Estructura del código

| Archivo | Fase | Función |
|---|---|---|
| `src/main.js` | — | Crea los módulos, registra sus parámetros, atajos de teclado y bucle |
| `src/core/viewer.js` | 2.1 | `WebGPURenderer`, escena, cámara, OrbitControls, entorno PMREM, sol y luz hemisférica, tamaño de la ventana |
| `src/core/clock.js` | 2.1 | **Reloj de simulación**: `tick(realDt)` → `dt` simulado (pausa, `timeScale`, avance fotograma a fotograma) |
| `src/core/lighting.js` | 2.1 | Tone mapping, exposición, sol, hemisférica, entorno, fondo y niebla |
| `src/core/params.js` | 2.2 | **Registro de parámetros**: `snapshot`, `apply`, `reset`, URL (`readURL`/`writeURL`/`shareURL`) y presets |
| `src/presets/*.json` | 2.2 | Presets incluidos |
| `src/core/gui.js` | 2.2 | Panel lil-gui por módulos y carpeta de presets y URL |
| `src/core/cameras.js` | 2.3 | Órbita libre, seguimiento, cinemática por raíles, director y transiciones |
| `src/whale/whaleStates.js` | 2.4 | **Máquina de estados** y eventos; mueve `Root` y elige los clips |
| `src/whale/breachPlanner.js` | 2.4 | Plan de salto determinista desde cualquier posición y rumbo |
| `src/whale/whale.js` | 2.4 | Carga del GLB (KTX2 y meshopt), LOD y controlador de clips |
| `src/whale/look.js` | 2.2 | Aspecto de la ballena: mojado, normal map, AO, alambre, "barbs" |
| `src/core/debug.js` | 2.5 | Vistas de buffer y línea de tiempo |
| `src/core/helpers.js`, `stats.js`, `whale/skeletonHelpers.js`, `whale/anchor.js` | 2.5 | Ayudas, estadísticas, esqueleto y punto de anclaje |

`src/whale/breach.js` (la secuencia fija de la 1.7) se ha sustituido por `breachPlanner.js` y `whaleStates.js`.

## 2.1 Renderer, color y reloj

- **Color:** salida sRGB. Las texturas de color van en sRGB y las de datos (normal, ORM, mojado) en lineal. Tone mapping AgX por defecto, con ACES, Neutral, Reinhard o ninguno a elegir, y exposición ajustable.
- **Reloj:** el bucle mide el tiempo real con `THREE.Timer`, limitado a 0,1 s por fotograma, y el reloj lo convierte en tiempo simulado. Todo lo simulado usa el `dt` simulado: animaciones, máquina de estados y raíles de cámara. Los suavizados y transiciones de cámara usan el tiempo real, así que la cámara se puede mover con la simulación en pausa.
- **Controles** (carpeta "Tiempo"): pausa, velocidad de 0 a 3 (cámara lenta por debajo de 1), avanzar un fotograma con paso configurable y lectura del tiempo simulado.

## 2.2 Parámetros, presets y URL

Módulos registrados, con su nombre en presets y URL:

| Módulo | Estado |
|---|---|
| `tiempo` | `timeScale`, `stepSize` |
| `ballena` | Máquina de estados (activada, salto automático e intervalo), nado (profundidad, velocidad, deriva, radio) y parámetros del salto |
| `camara` | Modo, plano, transición, cortes secos, suavizado, velocidad de raíles, FOV, giro automático |
| `luz` | Tone mapping, exposición, entorno, sol (intensidad, color, elevación, azimut), hemisférica, fondo y niebla |
| `modelo` | Mojado, normal map, AO, alambre, "barbs" |
| `lod` | Modo y distancias |
| `ayudas` | Agua (nivel, opacidad, color), rejilla, ejes, caja, sol, persona |
| `debug` | Vista de buffer, rango de profundidad, línea de tiempo |

- **URL:** solo se escriben los valores que difieren del valor por defecto, como `#tiempo.timeScale=0.5&camara.mode=Órbita+libre&luz.exposure=1.2`. Cada cambio en el panel actualiza la URL sin crear historial, y al abrir la página se aplica la URL.
- **Presets:** archivos JSON con la forma `{ "nombre", "descripcion", "valores": { módulo: { clave: valor } } }`. Al aplicar uno, primero se restablece todo y luego se aplican sus valores.

| Preset | Qué cambia |
|---|---|
| Escena gris (por defecto) | Nada: la escena placeholder |
| Mediodía despejado | Sol a 68°, luz blanca, fondo azul claro, niebla lejana |
| Atardecer | Sol a 6°, luz anaranjada, fondo cálido |
| Atardecer tormentoso | Sol a 4°, luz apagada, fondo gris oscuro, niebla densa |
| Salto a cámara lenta | Simulación al 35 %, cámara cinemática desde el barco, saltos cada 3 s |
| Inspección del modelo | Máquina de estados desactivada (ballena en reposo), órbita libre, sin agua ni niebla |

- **Panel "Presets y URL":** aplicar preset, guardar cambios en la URL (sí/no), copiar el enlace con los ajustes, exportar el estado actual como preset JSON (descarga) y restablecer todo.

Los presets de iluminación son provisionales: en la Fase 3 el cielo físico calculará la luz a partir de fecha, hora y lugar.

## 2.3 Cámaras

| Modo | Comportamiento |
|---|---|
| **Órbita libre** | OrbitControls sobre un punto fijo; 7 vistas predefinidas alrededor de la ballena, con transición |
| **Seguimiento** | La cámara y el objetivo acompañan a la ballena, con suavizado ajustable; se puede orbitar y hacer zoom a la vez |
| **Cinemática** | Raíles relativos a la ballena y a su rumbo: **Barco** (a 30 m por el costado, 2,5 m sobre el agua, deslizándose), **Aérea** (órbita a 38 m y 20 m de altura), **Ras de agua** (delante, a 0,4 m del agua), **Bajo el agua** (costado, 4 m por debajo de la superficie) |
| **Director** (plano cinemático) | Elige el raíl según el estado: nadar → aérea, preparar → bajo el agua, saltar → barco, caer → ras de agua, recuperar → aérea. Transición suave o **cortes secos** |

Los cambios de modo o de plano interpolan posición y objetivo con una curva *smoothstep*; la duración es configurable. La tecla `C` pasa al siguiente modo.

## 2.4 Máquina de estados de la ballena

```
nadar ──(J o salto automático)──► preparar ──► saltar ──► caer ──► recuperar ──► nadar
         nado libre              ascenso      parábola    impacto e   vuelta a la
         (swim_idle)             (swim_fast)  (breach_body, reescalado) inmersión   profundidad (swim_idle)
```

- **Nadar:** avanza a la profundidad y velocidad indicadas. El rumbo deriva suavemente y, si la ballena se aleja más que el radio indicado, gira de vuelta hacia el centro; al girar se inclina. En modo automático salta tras el intervalo indicado (6 s por defecto).
- **Salto:** `planBreach()` calcula un plan determinista desde la posición y el rumbo del momento: la trayectoria de la Fase 1.7, girada hacia donde va la ballena. Terminada la recuperación, vuelve a nadar desde donde acabó el plan.
- **Eventos (`fsm.on`):** `state` (cada cambio de estado), `surface_exit` (la cabeza sale del agua), `apex` e `impact`. Son los que usarán las salpicaduras y ondas de la Fase 5.
- **Modo libre:** con la máquina de estados desactivada, la ballena queda en reposo y los clips se eligen a mano (carpeta "Animación (modo libre)").

**Validado:** 40 s simulados a paso fijo de 1/30 s:

| t (s) | Evento |
|---:|---|
| 6,03 | → preparar |
| 10,30 | `surface_exit` |
| 10,57 | → saltar |
| 11,37 | `apex` |
| 12,20 | → caer, `impact` |
| 14,70 | → recuperar |
| 19,70 | → nadar |
| 25,73 | → preparar (segundo salto automático) … hasta 39,40, → nadar |

Centro de masas: −12,3 m nadando y máximo de 3,0 m (3,33 m sobre el agua). Todo coincide con la Fase 1.7.

## 2.5 Depuración

- **Vistas de buffer:** sustituyen los materiales de la ballena por materiales de nodos de diagnóstico.
  - Final, **Albedo** (color sin luz), **Normales** (con normal map), **Profundidad** (con rango ajustable), **Oclusión (AO)** y **Rugosidad**.
  - Funcionan también sobre la malla con piel animada.
- **Línea de tiempo** (abajo):
  - Durante un salto muestra las fases con su color y duración, las marcas de `surface_exit`, `apex` e `impact`, el cursor y el último evento.
  - **Un clic salta a ese instante** del plan. Recoloca `Root`, elige el clip correcto con su tiempo y restaura los eventos ya ocurridos.
  - Nadando, muestra el tiempo que falta para el siguiente salto automático.
- **Estadísticas:** fps, draw calls, triángulos, LOD, plano de cámara, reloj (pausa o velocidad, tiempo), estado de la ballena y clip.
- **También:** alambre, esqueleto, punto de anclaje con estela y caja envolvente (de las fases 1.6 y 1.8). En `npm run dev`, `window.whaleViewer` da acceso a todos los módulos desde la consola.

## Pruebas (navegador integrado, WebGPU)

- Carga sin errores en consola; arranca en "Nadar" con cámara de seguimiento.
- Ciclo completo de la máquina de estados (tabla de arriba), repetido dos veces.
- Cámara cinemática con director: en el salto elige "Barco" y se ve la ballena cayendo de espalda, con la línea de tiempo coloreada.
- Preset "Atardecer tormentoso" aplicado, con la URL resultante correcta.
- URL con `tiempo.timeScale=0.5`, `camara.mode=Órbita libre` y `debug.view=Normales`: se aplican los tres.
- "Inspección del modelo": máquina de estados desactivada, ballena en reposo (`Root` en el centro de masas), sin agua ni niebla.
- Clic en la línea de tiempo: ápice → "saltar" con `breach_body` y centro de masas a 3,03 m; t = 1 s → "preparar" con `swim_fast`.
- Vistas de normales y profundidad sobre la malla con piel.
- `npm run build` sin errores.

**Pendiente de medir en un navegador normal:** los fps (el navegador integrado estaba oculto y limita los fotogramas).
