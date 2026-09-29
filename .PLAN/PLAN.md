# PLAN: Ballena jorobada saltando en el mar (Three.js)

Versión 0.31 · 29/09/2026

Estado: `[x]` hecho · `[~]` en curso · `[ ]` pendiente

Documentación: cada punto terminado lleva aquí un resumen breve; el detalle está en `.PLAN\docs`.

## Objetivo

Escena en tiempo real en el navegador con Three.js: una ballena jorobada nada bajo el agua, sube y ejecuta un salto (breach) completo, cae de espalda y genera salpicaduras, espuma y ondas. La cámara puede estar sobre o bajo el agua, con cielo fotorrealista parametrizado por fecha, hora y ubicación.

Referencias visuales (5 imágenes en `.PLAN\referencias`):
- Salto con el cuerpo al 60-80 % fuera del agua, girando sobre su eje y con las pectorales abiertas.
- Cortinas de agua que caen desde el cuerpo y las aletas, spray fino y una columna de espuma en la base.
- Dorso negro, vientre y surcos ventrales blancos, pectorales largas (≈1/3 del cuerpo) con el borde festoneado y blancas por debajo, tubérculos en la cabeza, percebes.
- Mar abierto azul intenso, oleaje medio y cielo claro con cúmulos bajos.

## Stack

| Área | Elección | Motivo |
|---|---|---|
| Proyecto | Vite + JavaScript (ES modules, sin TypeScript) | Arranque rápido y HMR, sin paso de compilación de tipos |
| Render | Three.js `WebGPURenderer` + TSL; *fallback* WebGL2 al final (Fase 8.5) | Compute shaders para la FFT del océano, partículas en GPU y nubes |
| UI de parámetros | lil-gui (o Tweakpane) | Ajuste en vivo y presets en JSON |
| Modelo 3D | Blender 5.1.1 → glTF/GLB (meshopt + texturas KTX2) | Formato nativo de Three.js con esqueleto y animaciones |
| Animación | `AnimationMixer` con *crossfade* entre clips | Mezcla nadar ↔ saltar |

---

## [~] Fase 0: Preparación

- [x] **Fase 0.1** Decisiones tomadas (28/09/2026):
  - Especie: ballena jorobada. Renderer: WebGPU como objetivo principal. Durante el desarrollo se trabaja y valida solo en WebGPU; el fallback a WebGL se hace al final, en la Fase 8.5 (decidido el 28/09/2026). Objetivo: tiempo real en navegador de escritorio. Vite + JavaScript (sin TypeScript, decidido el 28/09/2026).
  - Modelo: se parte del modelo descargado y se crea una versión optimizada; el trabajo en Blender se automatiza con scripts bpy (Blender 5.1.1).
  - Rutas:
    - Plan: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Repos\26_903_Whale\.PLAN` (con las referencias en `.PLAN\referencias`)
    - Repositorio: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Repos\26_903_Whale`, vinculado a https://github.com/roberto-ferrero/26_903_Whale (sustituye al repo local de prueba `_Repos\26_903_Whale_1stTest`)
    - Blender: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender`
    - Modelo descargado (base, no se modifica): `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Downloads\humpback-whale-animated\Whale.blend` (texturas en `...\Textures\Textures`)
    - Modelo optimizado: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender\Claude modelo`
- [x] **Fase 0.2** Crear el repositorio y la estructura de carpetas:
  ```
  /public/models  GLB exportados
  /src/core       renderer, loop, cámara, GUI, presets
  /src/sky        atmósfera, sol, nubes
  /src/ocean      oleaje, shading, interacción
  /src/fx         salpicaduras, espuma, burbujas, partículas
  /src/underwater efectos subacuáticos
  /src/whale      carga, animación, lógica del salto
  /src/post       post-procesado
  ```
- [~] **Fase 0.3** Tablero de referencias: fotos (hecho, en `.PLAN\referencias`), vídeos de saltos a cámara lenta para el *timing* y medidas anatómicas.

**Hecho cuando:** el repo arranca con `npm run dev` y muestra un cubo con la GUI. ✔ Cumplido el 28/09/2026 (commit `545cbc0`).

---

## [x] Fase 1: Modelo de la ballena en Blender

- [x] **Fase 1.1 Auditoría del modelo descargado.** Mallas, triángulos, materiales, texturas, esqueleto, animaciones, escala, orientación y licencia; comparación con las imágenes de referencia.
  - Resultado (28/09/2026): el modelo sirve como base.
    - Malla de juego de 9,7 k triángulos (≈ 39 k con subdivisión nivel 1) y esqueleto de 47 huesos.
    - 7 clips horneados a 24 fps: nado, reposo, 3 saltos y boca abierta. Texturas 1K-4K con variantes de piel y rugosidad mojada/seca. Esculpido de 857 k triángulos para hornear.
  - A corregir:
    - Texturas con rutas rotas.
    - Escala de 19,1 m (en vez de ≈ 14 m) y pectorales algo cortas.
    - Hasta 10 influencias por vértice.
    - Saltos sin ascenso y con poco giro.
    - Faltan `swim_fast`, `dive`, `pec_slap` y los eventos.
  - Licencia: CGTrader, *Royalty Free License* (autor `goldenztuff`). Permite usarlo y modificarlo dentro del proyecto, pero no redistribuir los archivos: el .blend, las texturas y el GLB no se suben al repo público (`.gitignore`).
  - Detalle: [docs/fase_1_1_auditoria.md](docs/fase_1_1_auditoria.md).
- [x] **Fase 1.2 Copia de trabajo.** `Whale_opt.blend` en `_Blender\Claude modelo`, con las texturas copiadas y rutas relativas (el original no se toca).
  - Resultado (28/09/2026):
    - `Whale_opt.blend` (3,6 MB) contiene solo la malla `Whale`, el esqueleto `WhaleRig` y sus 8 acciones horneadas, añadidos desde el original sin modificarlo.
    - Las 17 texturas están copiadas en `textures\` (piel con percebes 2K/4K, rugosidad mojada y seca, "barbs"); las 9 enlazadas usan rutas relativas y cargan.
    - El esculpido de alta queda aparte, en `Whale_bake_src.blend`.
  - Verificado: los vértices deformados coinciden con el original en 35 poses (diferencia 0 m).
  - Detalle: [docs/fase_1_2_copia_trabajo.md](docs/fase_1_2_copia_trabajo.md).
- [x] **Fase 1.3 Limpieza y normalización.** Aplicar transformaciones, escala en metros, ejes compatibles con glTF y eliminar datos sobrantes. Escala a 14 m (×0,7313) **en Blender**, incluidas las claves de posición de los huesos (decidido el 28/09/2026).
  - Resultado (28/09/2026):
    - La ballena mide 14,00 m: se escalaron la malla, el reposo de los huesos y las 107 019 claves de posición, y también la alta poligonal para hornear.
    - Eliminados el grupo `shrinkwrap`, el atributo `Col`, la acción `RestPosee` y los datos huérfanos.
    - Transformaciones en identidad y ejes listos para glTF.
  - Verificado: las 35 poses de control coinciden con el original escalado (error máximo 0,86 mm).
  - Los n-gons y el límite de 4 influencias se dejan para después de aplicar la subdivisión (1.4/1.6).
  - Detalle: [docs/fase_1_3_limpieza.md](docs/fase_1_3_limpieza.md).
- [x] **Fase 1.4 Optimización de geometría.** Objetivo 20-40 k triángulos, LODs de 40 k / 15 k / 5 k y horneado a normal map del detalle perdido.
  - Resultado (28/09/2026):
    - LOD0 de 39 196 triángulos (subdivisión nivel 1 aplicada); LOD1 de 14 997 y LOD2 de 4 998, simplificados desde el LOD0 (a menos de 3,5 mm y de 1 cm de él).
    - Los tres comparten UVs, texturas y esqueleto.
    - Pesos limitados a 4 influencias y normalizados: error de deformación de 2,2 mm de media, sin artefactos visibles; lo máximo, 13 cm en la punta de la caudal.
    - No hace falta hornear: el normal map entregado ya reproduce el detalle del esculpido.
  - Detalle: [docs/fase_1_4_geometria.md](docs/fase_1_4_geometria.md).
- [x] **Fase 1.5 Texturas PBR glTF.** baseColor, normal y ORM a 2K, ajuste de color a las referencias y máscara de "mojado" para Three.js.
  - Resultado (28/09/2026):
    - Texturas glTF 2K: baseColor, ORM (AO, rugosidad seca, metal 0) y normal. Las "barbs" llevan RGBA con recorte de alfa.
    - `whale_wet_2k` para Three.js: R = rugosidad mojada, G = retención de agua, B = altura.
    - Ajuste de color leve: negros menos azules y algo más claros, y solo el 35 % de la AO en el color; el resto, en el ORM.
    - Materiales reconstruidos para el exportador glTF.
  - Detalle: [docs/fase_1_5_texturas.md](docs/fase_1_5_texturas.md).
- [x] **Fase 1.6 Rig.** Revisar y adaptar el esqueleto existente o reconstruirlo si no sirve; máximo 4 influencias por vértice (ya aplicado en la 1.4; queda revisar la caudal).
  - Resultado (28/09/2026):
    - Se mantiene el esqueleto: 47 huesos deformantes, simétricos, todos con movimiento salvo la dorsal y dos segmentos de pectoral; se conservan todos.
    - Nuevo hueso **`Root`** en el centro de masas (39,5 % desde el morro; 26,8 m³ ≈ 27 t) como **punto de anclaje** para la trayectoria del salto. No altera las animaciones (0,013 mm).
    - Visor con ayudas de esqueleto y de punto de anclaje.
  - Detalle: [docs/fase_1_6_rig.md](docs/fase_1_6_rig.md).
  - Columna: cadena de 12-16 huesos desde la cabeza hasta el pedúnculo.
  - Cabeza y mandíbula.
  - Pectorales.
  - Caudal.
- [x] **Fase 1.7 Animaciones.** Reutilizar las del modelo y crear las que falten:
  - `swim_idle`, `swim_fast` y `breach`.
  - `dive` y `pec_slap` (opcionales).
  - Eventos `surface_exit`, `apex` e `impact`.
  - Resultado (28/09/2026):
    - Clips nuevos en Blender: `swim_idle` (Swim1), `swim_fast` (Swim2 ×1,53 y amplitud ×1,25) y `breach_body` (cuerpo de JumpRight sin el movimiento global de MasterBone; eventos en `extras`).
    - **Trayectoria del salto por código en Three.js** (decisión de Roberto) sobre el hueso `Root`: nado profundo → ascenso → parábola balística con giro de 160° → caída de espalda → recuperación, con 12 parámetros en el panel.
    - Eventos `surface_exit`, `apex` e `impact`.
    - Validado: en el ápice, entre el 72 % y el 79 % del cuerpo fuera del agua (referencias: 60-80 %) y 1,65 s en el aire.
    - `dive` y `pec_slap` (opcionales) quedan pendientes.
  - Detalle: [docs/fase_1_7_animaciones.md](docs/fase_1_7_animaciones.md).
- [x] **Fase 1.8 Exportación y validación.** GLB (meshopt + KTX2) en `_Blender\Claude modelo` y copia a `public/models`; validación en un visor Three.js.
  - Resultado (28/09/2026):
    - **GLB final de 10,1 MB** (antes 19,6): malla y animación con meshopt (0,5 MB) y texturas **KTX2 UASTC**, que en la GPU son BC7 (≈ 27 MB frente a ≈ 107 MB con PNG). Mapa de mojado en KTX2 (2,0 MB).
    - UASTC también para el color: ETC1S teñía de verde la piel oscura.
    - Tangentes MikkTSpace exportadas.
    - Eventos copiados en el hueso `Root`, porque gltfpack quita los extras de las animaciones.
    - Validador de Khronos con **0 errores** y 10 de 10 comprobaciones del proyecto.
    - Visor con `KTX2Loader` y `MeshoptDecoder`, probado con la secuencia del salto.
    - Proceso reproducible: `npm run pack:model` (gltfpack nativo 1.3) y `npm run validate:model`.
  - Detalle: [docs/fase_1_8_exportacion.md](docs/fase_1_8_exportacion.md) y [docs/visor_modelo.md](docs/visor_modelo.md).
- [ ] **Fase 1.9 (opcional) Refinado.** Esculpido y texturas.

**Hecho cuando:** el GLB carga en Three.js y reproduce los clips con *crossfade* sin artefactos en la piel. ✔ Cumplido el 28/09/2026. La 1.9 (refinado, opcional) y `dive`/`pec_slap` (1.7, opcionales) quedan pendientes.

---

## [x] Fase 2: Base del proyecto Three.js

- [x] **Fase 2.1** Renderer, gestión de color, *tone mapping* (AgX o ACES), bucle con `clock` y reloj de simulación pausable y con control de velocidad (cámara lenta).
  - Hecho: `core/clock.js` (pausa, velocidad 0-3, avance fotograma a fotograma; todo lo simulado usa su `dt`) y `core/lighting.js` (tone mapping AgX/ACES/Neutral, exposición, sol, entorno, fondo y niebla).
- [x] **Fase 2.2** Sistema de parámetros: GUI por módulo, presets en JSON (por ejemplo "Mediodía despejado", "Atardecer tormentoso") y guardado en URL.
  - Hecho: `core/params.js` con 8 módulos registrados, 6 presets en `src/presets/`, URL con solo los cambios, copiar enlace, exportar preset y restablecer.
- [x] **Fase 2.3** Cámaras: orbital libre, seguimiento de la ballena y cámara cinemática por raíles. Transición suave entre modos.
  - Hecho: `core/cameras.js`: órbita (7 vistas), seguimiento suavizado y raíles barco, aérea, ras de agua y bajo el agua, más un director que corta según el estado; transiciones *smoothstep* o cortes secos.
- [x] **Fase 2.4** Carga de la ballena, `AnimationMixer`, máquina de estados (nadar → preparar → saltar → caer → nadar) y lectura de eventos de la animación.
  - Hecho: `whale/whaleStates.js` + `whale/breachPlanner.js`: nado libre con deriva y regreso al centro; salto (J o automático) planificado desde la posición y el rumbo actuales; eventos `state`, `surface_exit`, `apex` e `impact`; modo libre para revisar clips.
- [x] **Fase 2.5** Herramientas de depuración: stats, *wireframe*, visualizar buffers y timeline de la secuencia.
  - Hecho: `core/debug.js`: vistas albedo, normales, profundidad, AO y rugosidad; línea de tiempo del salto con clic para ir a un instante; estadísticas ampliadas y atajos de teclado.

**Hecho cuando:** la ballena nada y salta en una escena gris placeholder con la GUI funcionando. ✔ Cumplido el 28/09/2026. Detalle: [docs/fase_2_base.md](docs/fase_2_base.md).

---

## [x] Fase 3: Cielo fotorrealista

- [x] **Fase 3.1 Posición del sol (y luna) por fecha, hora, latitud y longitud.** Algoritmo NOAA/SunCalc. Parámetros: fecha, hora, zona horaria, lat/lon y velocidad del tiempo.
  - Hecho: `sky/astro.js`: sol NOAA y luna Meeus con fase; 6 lugares con ballenas jorobadas; validado con los solsticios en Madrid (73,02° y 26,14°, exactos) y con las fases de la luna de sept./oct. de 2026.
- [x] **Fase 3.2 Atmósfera física.** Primero el `Sky` de Three.js (Preetham) como prototipo y después dispersión precomputada con LUTs (modelo Hillaire/Bruneton): Rayleigh, Mie, ozono, turbidez. Amaneceres, atardeceres y crepúsculo correctos.
  - Hecho: `sky/atmosphere.js`: LUT *sky-view* de Hillaire en la GPU (Rayleigh, Mie, ozono, dispersión múltiple aproximada, sombra del planeta), recalculada solo cuando se mueve el sol. Es el modelo por defecto; Preetham se puede elegir en la GUI.
- [x] **Fase 3.3 Noche.** Estrellas, luna con fase según la fecha y brillo del cielo nocturno.
  - Hecho: 6000 estrellas que giran con el tiempo sidéreo, disco lunar con su fase y luz de luna.
- [x] **Fase 3.4 Nubes volumétricas.** *Raymarching* con ruido Perlin-Worley 3D y mapa de clima 2D. Parámetros: cobertura, densidad, altitud base, grosor, tipo (cúmulo ↔ estrato), viento. Render a media resolución con reproyección temporal para rendimiento.
  - Hecho: `sky/clouds.js` + `npm run gen:clouds`: octavas de dispersión múltiple, ½ resolución, acumulación temporal con reproyección (error 0,018 frente a 0,146 sin ella). Coste: 1,8 ms de GPU a 720p (antes 113 ms).
- [x] **Fase 3.5 Iluminación derivada del cielo.** Luz direccional del sol con color atmosférico, *environment map* (PMREM) regenerado al cambiar la hora, sombras de nubes sobre el mar y *aerial perspective* (bruma en el horizonte).
  - Hecho: sol teñido por la transmitancia y PMREM con cielo y nubes. Se corrigió un fallo de r186: el PMREM no actualiza la proyección de su cámara cúbica (far = 100). Además: sombra de nubes como nodo reutilizable para el océano y niebla que sigue la hora.

**Hecho cuando:** mover la hora del día cambia cielo, nubes, luz y reflejos de forma coherente. ✔ Cumplido el 28/09/2026. Detalle y capturas: [docs/fase_3_cielo.md](docs/fase_3_cielo.md).

---

## [x] Fase 4: Océano (superficie)

- [x] **Fase 4.1 Geometría.** Malla con LOD (clipmap o cascadas concéntricas centradas en la cámara) hasta el horizonte.
  - Hecho: una rejilla de 257² vértices hasta 25 km, con celdas de 0,35 m en el centro que crecen de forma geométrica. Cada vértice se ancla a una retícula del mundo con el paso de su celda (sin "nadar" ni grietas), lee un mip acorde a su celda y se curva con la Tierra.
- [x] **Fase 4.2 Olas, prototipo.** Suma de ondas de Gerstner parametrizadas (amplitud, longitud, dirección, *steepness*) para validar el shading pronto.
  - Hecho: `ocean/gerstner.js`, 8 ondas; queda como modo barato (2,0 ms por fotograma).
- [x] **Fase 4.3 Olas, versión final.** Espectro FFT (JONSWAP + componente de mar de fondo/swell) en compute shaders con 2-3 cascadas de escala. Parámetros:
  - Viento: velocidad, dirección y *fetch*.
  - Mar de fondo (swell): altura, periodo, dirección y dispersión.
  - *Choppiness* (crestas afiladas) y escala de detalle.
  - Hecho: `ocean/spectrum.js` + `ocean/fft.js`: JONSWAP/Mitsuyasu + swell, 3 cascadas de 256² (500, 97 y 19 m) y FFT en memoria compartida en 0,6 ms. Validado: la Hs coincide con la teoría y con Pierson-Moskowitz, y la GPU coincide con la CPU (error < 2·10⁻⁶ m).
- [x] **Fase 4.4 Shading.** Fresnel, reflejo del cielo y del sol, refracción con color según profundidad, *subsurface scattering* en crestas iluminadas por detrás, espuma de rompiente calculada con el jacobiano (whitecaps) y micro-normales para el brillo lejano.
  - Hecho: iluminación propia en TSL (PMREM del cielo y las nubes, GGX del sol, refracción con absorción según el espesor de agua, luz en las crestas y perspectiva aérea). La espuma, por jacobiano, está calibrada con la ley de Monahan.
- [x] **Fase 4.5 Consulta de altura.** Función para saber la altura del agua en cualquier punto (en CPU o con lectura de GPU) para la cámara, la ballena y las partículas.
  - Hecho: `ocean.heightAt(x, z)`, IFFT en CPU del mismo espectro (7 cm de error rms, sin latencia) y boyas de prueba.

**Hecho cuando:** el mar se ve creíble desde varias alturas y los parámetros de viento y swell cambian el estado del mar de calma a mar agitado. ✔ Cumplido el 28/09/2026 (presets 09 "Mar en calma" y 10 "Mar agitado"). Coste: 2,9 ms por fotograma a 720p. Detalle y capturas: [docs/fase_4_oceano.md](docs/fase_4_oceano.md).

---

## [x] Fase 5: Interacción ballena ↔ agua

- [x] **Fase 5.1 Detección de cruce.** Puntos de muestreo sobre los huesos de la ballena que detectan en qué zonas y a qué velocidad atraviesa la superficie.
  - Hecho: `water/interaction.js`: 22 sondas (esferas con el radio del cuerpo) con velocidad, profundidad, sección cortada e instante de salida; se pueden ver en la GUI.
- [x] **Fase 5.2 Ondas dinámicas.** Simulación local de ecuación de onda (*height field* 2D) centrada en la ballena y sumada al oleaje: anillos concéntricos en la salida y, sobre todo, en el impacto.
  - Hecho: `water/ripples.js`: 256² celdas de 0,5 m que siguen a la ballena, bordes de esponja y fuentes que imponen la velocidad del cuerpo; el pulso del impacto da cráter y anillo. El océano la suma a su altura y sus normales.
- [x] **Fase 5.3 Salpicaduras (partículas GPU).** Tres capas: gotas grandes con física balística, spray fino y niebla/bruma. Emisión según velocidad y área de intersección, con iluminación por el sol y el cielo.
  - Hecho: `water/splash.js`: 131 072 partículas en un búfer circular con emisores (sin atómicos), choque con la superficie del océano y luz a contraluz (Henyey-Greenstein).
- [x] **Fase 5.4 Cortinas de agua sobre el cuerpo.** Agua que cae desde el lomo y las aletas durante el salto, goteo desde los bordes de las pectorales y shader de piel mojada.
  - Hecho: láminas estiradas que se desprenden durante 2,2 s según la velocidad de salida, goteo de las puntas de las aletas y piel mojada automática (se seca en ~1 min).
- [x] **Fase 5.5 Espuma persistente.** Textura de espuma acumulada en el mundo, que se advecta y se disipa con el tiempo; mancha blanca en la zona de impacto.
  - Hecho: canal de espuma de la simulación, con fuentes, rotura, advección por la deriva del viento, difusión y τ = 25 s; el oleaje pequeño la rompe en manchas.
- [x] **Fase 5.6 Estela.** Estela en superficie cuando la ballena nada cerca de ella.
  - Hecho: las sondas que avanzan cortando la superficie hunden el agua y dejan espuma y spray.
- [x] **Fase 5.7 Sincronización.** Los eventos `surface_exit`, `apex` e `impact` de la animación disparan emisores e impulsos de ondas.
  - Hecho: `surface_exit` e `impact` lanzan ráfagas de gotas, spray y bruma y pulsos de ondas y espuma. `apex` no dispara nada propio: a partir de ahí solo siguen las cortinas, que dependen del tiempo desde la salida.

**Hecho cuando:** el salto se ve como en las fotos de referencia: columna de agua, cortinas que caen y un gran impacto con ondas. ✔ Cumplido el 28/09/2026. Coste: 0,4 ms (partículas) + 0,55 ms (ondas) de GPU y 0,7 ms de CPU. Detalle y capturas de la secuencia: [docs/fase_5_interaccion.md](docs/fase_5_interaccion.md).

---

## [x] Fase 6: Cámara bajo el agua

- [x] **Fase 6.1 Transición.** Detección de cámara bajo la superficie y línea de flotación en pantalla (media imagen arriba y media abajo, con menisco y gotas en la lente al salir).
  - Hecho: `underwater/underwater.js`: máscara por píxel con la altura real de la superficie en una "cúpula" a 0,5 m, menisco oscuro y gotas procedurales que resbalan y se secan en 4 s.
- [x] **Fase 6.2 Superficie vista desde abajo.** Ventana de Snell, reflexión total interna y refracción del cielo y del sol.
  - Hecho: cara inferior del océano con `refract` (n = 1,333) y Fresnel. Dentro de la ventana se ve el cielo y la ballena en el aire; fuera, reflexión total interna.
- [x] **Fase 6.3 Niebla y absorción.** Atenuación por longitud de onda (el rojo desaparece primero) y *fades* por distancia y profundidad, con color parametrizable (océano abierto, agua costera verde...).
  - Hecho: transmitancia por canal y luz dispersada según la profundidad. Tres tipos de agua: océano abierto, tropical clara y costera verde.
- [x] **Fase 6.4 God rays.** Raymarching volumétrico usando la superficie animada como máscara de sombra (versión *screen-space* como opción de bajo coste).
  - Hecho: 16 pasos (de 2 a 48) que leen las cáusticas de la superficie a lo largo del sol refractado; la versión barata es bajar los pasos.
- [x] **Fase 6.5 Cáusticas.** Proyectadas sobre la ballena y sobre las partículas.
  - Hecho: `ocean.causticNode` / `underLightNode` aplicados a la ballena (`outputNode`), las salpicaduras, las burbujas y la nieve marina.
  - Revisión del 29/09/2026: cáusticas con el hessiano de la superficie (1/|det(I + D·κ·H)|), que forman una red de líneas nítidas. También destellos y cáusticas en la cara inferior de la superficie, y god rays de 0 a 8 (5 por defecto). Solo con sol y sin sombra de nubes.
- [x] **Fase 6.6 Burbujas.** Nubes de burbujas en la entrada y salida de la ballena, estela de burbujas y burbujas que suben y estallan en superficie.
  - Hecho: partícula burbuja con velocidad terminal, bamboleo y estallido. Nubes en `impact` y `surface_exit`, huella al entrar y estela de aire atrapado.
- [x] **Fase 6.7 Partículas en suspensión.** Nieve marina y plancton flotando con corrientes, iluminados por los god rays.
  - Hecho: `underwater/snow.js`, 14 000 sprites anclados al mundo alrededor de la cámara, con corriente y la luz del agua con cáusticas.
- [x] **Fase 6.8 Post-procesado subacuático.** Distorsión leve, viñeta, desenfoque por distancia y aberración cromática sutil.
  - Hecho, solo en los píxeles bajo el agua.

**Hecho cuando:** se puede bajar la cámara bajo el agua y ver a la ballena subir hacia la luz y romper la superficie desde abajo. ✔ Cumplido el 28/09/2026. Coste: 6,2 ms por fotograma a 720p bajo el agua; lejos del agua no se usa el posprocesado. Detalle y secuencia: [docs/fase_6_bajo_el_agua.md](docs/fase_6_bajo_el_agua.md).

---

## [x] Fase 7: Secuencia y composición final

- [x] **Fase 7.1 Timeline.** Secuencia: nado profundo → ascenso → salto → impacto → ondas y espuma → vuelta a nadar. Repetible y con disparo manual desde la GUI.
  - Hecho: `core/sequence.js` con la carpeta *Secuencia* (tecla P): repetir, "Saltar ahora", duraciones y profundidades. Oculta las ayudas y restaura todo al parar.
- [x] **Fase 7.2 Cámaras cinemáticas.** Planos predefinidos (desde barco, a ras de agua, bajo el agua, aéreo) con cortes o travellings, incluido el paso sobre/bajo agua durante el salto.
  - Hecho: raíles nuevos «Hacia la luz (desde abajo)» y el travelling «Cruce de superficie»; director por fase con cortes secos. Las cámaras sobre el agua siguen la altura real de las olas.
- [x] **Fase 7.3 Post-procesado global.** TAA, bloom, profundidad de campo, motion blur, *color grading* y grano.
  - Hecho: `core/post.js` (TAA/FXAA, DOF con enfoque automático, motion blur limitado, bloom, corrección de color y grano; grafo reconstruible). Se corrigió la velocidad del océano, que arruinaba el motion blur.
- [x] **Fase 7.4 Audio (opcional).** Oleaje ambiente, impacto y ambiente subacuático apagado.
  - Hecho: `audio/audio.js`, WebAudio procedural: oleaje, impacto y chapoteo con retraso por distancia, filtro bajo el agua y canto de ballena.

**Hecho cuando** (la fase no tenía uno explícito): la secuencia completa se reproduce en bucle con cámaras automáticas, pasando sobre y bajo el agua. ✔ 29/09/2026. Detalle y la secuencia plano a plano: [docs/fase_7_secuencia.md](docs/fase_7_secuencia.md).

---

## [~] Fase 8: Rendimiento y entrega

- [x] **Fase 8.1** Presupuesto de rendimiento (objetivo: 60 fps en GPU de escritorio de gama media) y perfiles de calidad Bajo / Medio / Alto / Ultra.
  - Hecho: `core/quality.js` con Bajo, Medio, Alto (por defecto), Ultra y Automático (baja o sube según el tiempo de fotograma, con histéresis).
- [x] **Fase 8.2** Perfilado y optimización: resoluciones de nubes y god rays, cascadas FFT, número de partículas y LOD de la ballena.
  - Hecho: a 1080p, Alto va a 10,9 ms sobre el agua y 15,1 ms bajo el agua (cumple los 60 fps). Desglose por módulo (océano ~4 ms, posprocesado ~2,9, nubes ~2). Ultra bajo el agua reajustado (20 pasos de god rays).
- [~] **Fase 8.3** Build de producción, despliegue (GitHub Pages, Netlify o Vercel) y documentación de parámetros.
  - Hecho: build con `base: './'` probado con `vite preview`, `README.md` y `docs/parametros.md` (254 controles, generado desde la GUI).
  - Pendiente: el despliegue. El build incluye el modelo de CGTrader: hay que decidir el destino y confirmar la licencia antes de publicarlo.
- [x] **Fase 8.4 (opcional)** Captura a vídeo en alta calidad a cámara lenta.
  - Hecho: `core/recorder.js`, WebM VP9 de hasta 120 Mbit/s con un fotograma de vídeo por render. La cámara lenta sale de la velocidad del tiempo; el modo offline con WebCodecs queda como mejora.
- [x] **Fase 8.5 Fallback WebGL2.**
  - Detectar si hay WebGPU; si no, usar el backend WebGL2 de `WebGPURenderer` (`forceWebGL`) o avisar al usuario.
  - Revisar qué efectos basados en *compute* (FFT, partículas, nubes) necesitan una alternativa, una versión simplificada o desactivarse.
  - Perfil de calidad reducido y pruebas en navegadores sin WebGPU.
  - Hecho: `forceWebGL` sin `navigator.gpu` (o con `?webgl`). Sin compute: olas de Gerstner, sin salpicaduras ni ondas de la ballena; perfil Bajo y aviso. Probado con `?webgl` sin errores.

Detalle: [docs/fase_8_entrega.md](docs/fase_8_entrega.md).

---

## [x] Ampliaciones (peticiones durante el desarrollo)

- [x] ~~**Selector de renderizador en la GUI**~~ (29/09/2026): añadido y retirado a petición de Roberto (WebGL2 da un resultado demasiado pobre). El fallback automático sin WebGPU se mantiene.
- [x] **Peces sueltos y cardumen** (29/09/2026): `src/life/fish.js`.
  - Peces procedurales con coletazo en el vertex shader y luz con cáusticas bajo el agua.
  - Cardumen de 500 peces con boids (10 vecinos por pez, huida de la ballena): se organiza en ~10 s con polarización 0,96–0,99 y cuesta 0,54 ms de CPU.
  - Peces sueltos: desactivados de momento, a petición de Roberto.
  - Visibilidad: el cardumen va delante de la cámara (10 m), arrastrado por una corriente, para que se vea con la cámara de seguimiento.
  - Corregidas las estelas del TAA (los peces no escribían su velocidad real).
  - Funciona también en WebGL2.
  - Valores por defecto de Roberto: 500 peces de 0,14 m a 0,8 m/s, a 15 m de la cámara; separación 3,05, alineación 3,35 y cohesión 3,4.
  - Detalle: [docs/peces.md](docs/peces.md).
- [x] **Respiración, secuencia nueva y transiciones sin saltos** (29/09/2026): `src/whale/breathPlanner.js`.
  - Estados subir → respirar → bajar: sube en S, asoma el lomo y **sopla** (vapor, gotas y spray desde el espiráculo, con sonido) y se sumerge. La cola no sale del agua: brazada más corta junto a la superficie y cabeceo limitado.
  - Secuencia: nada → respira → nada → salta → nada → respira → nada → respira, con el plano nuevo *Soplido (cerca)*. En automático, el mismo ciclo. Tecla **R**.
  - Saltos corregidos: la orientación cambiaba de golpe al empezar el salto (la inclinación del giro al nadar). Ahora cada cambio de plan reparte la diferencia de pose en 1 s: 0 picos de giro en 150 s (antes, de 700 a 7400 m/s² en un fotograma).
  - **Respiración en arco (continua)**, el estilo por defecto:
    - no se para: avanza y gira a la vez;
    - arquea el cuerpo (cabeza flexionada, cola abajo) y asoma poco más que la nariz (~0,2-0,3 m de cabeza);
    - sopla y se sumerge en el mismo movimiento, siguiendo la ola local;
    - espiráculo adelantado 0,5 m;
    - exhala 0,5 s antes de asomar (burbujas bajo el agua) y, al sumergirse, suelta un reguero de burbujas que va disminuyendo; la cola no sale del agua;
    - el surtidor sale siempre, aunque una ola tape el espiráculo: sale desde la superficie y no se corta;
    - espuma y un anillo de gotas al romper la superficie, y espuma alrededor de la cabeza mientras sopla;
    - las burbujas siguen una corriente submarina propia (0,25 m/s, ajustable): antes se las llevaba el viento;
    - la versión anterior se conserva como estilo *En superficie*.
  - Detalle: [docs/respiracion.md](docs/respiracion.md).
- [x] **Valores por defecto y ayudas** (29/09/2026, petición de Roberto):
  - Panel replegado y ninguna ayuda en pantalla por defecto (ni ejes, ni marcadores, ni trayectoria, ni línea de tiempo, ni estadísticas).
  - La tecla **B** las muestra u oculta todas a la vez: ancla con su línea al agua, hueso seleccionado, trayectoria del salto, dirección del sol, línea de tiempo y estadísticas. Respirar pasa a la tecla **R**.
  - Persona de referencia (1,8 m) eliminada por completo.
  - Agua *Tropical clara* por defecto.
  - Profundidad de campo y motion blur activados en los perfiles Alto (por defecto) y Ultra.
  - Corregido: cualquier cambio de un parámetro de la ballena (o empezar la secuencia) la devolvía de golpe a su punto de partida.

---

## Orden de trabajo recomendado

La fase 1 (Blender) es la más larga y puede avanzar en paralelo con las fases 2 a 4: mientras se esculpe y se anima la ballena, el mar y el cielo se construyen con una ballena provisional (cápsula articulada). Las fases 5 y 6 necesitan ya la ballena animada.

```
Fase 0 ─► Fase 1 (Blender) ────────────────┐
      └─► Fase 2 ─► Fase 3 ─► Fase 4 ──────┴─► Fase 5 ─► Fase 6 ─► Fase 7 ─► Fase 8
```

## Riesgos

- **Calidad del modelo de la ballena.** Es el elemento que más se ve. El modelo descargado hay que validarlo (calidad, rig y licencia) en la Fase 1.1 y refinarlo en la Fase 1.9 si hace falta.
- **Coste en GPU** de nubes volumétricas + FFT + god rays a la vez: se mitiga con media resolución, reproyección temporal y perfiles de calidad.
- **Compatibilidad WebGPU:** el desarrollo es solo WebGPU. El fallback WebGL2 se deja para la Fase 8.5, con menos calidad; conviene no depender de funciones exclusivas de WebGPU sin prever una alternativa sencilla.
