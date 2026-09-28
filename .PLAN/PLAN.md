# PLAN: Ballena jorobada saltando en el mar (Three.js)

Versión 0.5 · 28/09/2026

## Objetivo

Escena en tiempo real en el navegador con Three.js: una ballena jorobada nada bajo el agua, sube y ejecuta un salto (breach) completo, cae de espalda y genera salpicaduras, espuma y ondas. La cámara puede estar sobre o bajo el agua, con cielo fotorrealista parametrizado por fecha, hora y ubicación.

Referencias visuales (5 imágenes aportadas por Roberto):
- Salto con el cuerpo al 60-80 % fuera del agua, girando sobre su eje y con las pectorales abiertas.
- Cortinas de agua que caen desde el cuerpo y las aletas, spray fino y una columna de espuma en la base.
- Dorso negro, vientre y surcos ventrales blancos, pectorales largas (≈1/3 del cuerpo) con el borde festoneado y blancas por debajo, tubérculos en la cabeza, percebes.
- Mar abierto azul intenso, oleaje medio y cielo claro con cúmulos bajos.

## Stack

| Área | Elección | Motivo |
|---|---|---|
| Proyecto | Vite + TypeScript | Arranque rápido, HMR y tipos para un proyecto grande |
| Render | Three.js `WebGPURenderer` + TSL (con *fallback* WebGL2) | Compute shaders para la FFT del océano, partículas en GPU y nubes |
| UI de parámetros | lil-gui (o Tweakpane) | Ajuste en vivo y presets en JSON |
| Modelo 3D | Blender 5.1.1 → glTF/GLB (meshopt + texturas KTX2) | Formato nativo de Three.js con esqueleto y animaciones |
| Animación | `AnimationMixer` con *crossfade* entre clips | Mezcla nadar ↔ saltar |

---

## Fase 0: Preparación

- **Fase 0.1** Decisiones tomadas (28/09/2026):
  - Especie: ballena jorobada. Renderer: WebGPU con fallback WebGL2. Objetivo: tiempo real en navegador de escritorio. Vite + TypeScript.
  - Modelo: se parte del modelo descargado y se crea una versión optimizada; el trabajo en Blender se automatiza con scripts bpy (Blender 5.1.1).
  - Rutas:
    - Plan: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Repos\26_903_Whale\.PLAN` (con las referencias en `.PLAN\referencias`)
    - Repositorio: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Repos\26_903_Whale`, vinculado a https://github.com/roberto-ferrero/26_903_Whale (sustituye al repo local de prueba `_Repos\26_903_Whale_1stTest`)
    - Blender: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender`
    - Modelo descargado (base, no se modifica): `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Downloads\humpback-whale-animated\Whale.blend` (texturas en `...\Textures\Textures`)
    - Modelo optimizado: `D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender\Claude modelo`
- **Fase 0.2** Crear el repositorio y la estructura de carpetas:
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
- **Fase 0.3** Tablero de referencias: fotos, vídeos de saltos a cámara lenta para el *timing* y medidas anatómicas.

**Hecho cuando:** el repo arranca con `npm run dev` y muestra un cubo con la GUI.

---

## Fase 1: Modelo de la ballena en Blender

- **Fase 1.1 Auditoría del modelo descargado.** Mallas, triángulos, materiales, texturas, esqueleto, animaciones, escala, orientación y licencia; comparación con las imágenes de referencia.
- **Fase 1.2 Copia de trabajo.** `Whale_opt.blend` en `_Blender\Claude modelo`, con las texturas copiadas y rutas relativas (el original no se toca).
- **Fase 1.3 Limpieza y normalización.** Aplicar transformaciones, escala en metros, ejes compatibles con glTF y eliminar datos sobrantes.
- **Fase 1.4 Optimización de geometría.** Objetivo 20-40 k triángulos, LODs de 40 k / 15 k / 5 k y horneado a normal map del detalle perdido.
- **Fase 1.5 Texturas PBR glTF.** baseColor, normal y ORM a 2K, ajuste de color a las referencias y máscara de "mojado" para Three.js.
- **Fase 1.6 Rig.** Revisar y adaptar el esqueleto existente o reconstruirlo si no sirve; máximo 4 influencias por vértice.
  - Columna: cadena de 12-16 huesos desde la cabeza hasta el pedúnculo.
  - Cabeza y mandíbula.
  - Pectorales.
  - Caudal.
- **Fase 1.7 Animaciones.** Reutilizar las del modelo y crear las que falten:
  - `swim_idle`, `swim_fast` y `breach`.
  - `dive` y `pec_slap` (opcionales).
  - Eventos `surface_exit`, `apex` e `impact`.
- **Fase 1.8 Exportación y validación.** GLB (meshopt + KTX2) en `_Blender\Claude modelo` y copia a `public/models`; validación en un visor Three.js.
- **Fase 1.9 (opcional) Refinado.** Esculpido y texturas.

**Hecho cuando:** el GLB carga en Three.js y reproduce los clips con *crossfade* sin artefactos en la piel.

---

## Fase 2: Base del proyecto Three.js

- **Fase 2.1** Renderer, gestión de color, *tone mapping* (AgX o ACES), bucle con `clock` y reloj de simulación pausable y con control de velocidad (cámara lenta).
- **Fase 2.2** Sistema de parámetros: GUI por módulo, presets en JSON (por ejemplo "Mediodía despejado", "Atardecer tormentoso") y guardado en URL.
- **Fase 2.3** Cámaras: orbital libre, seguimiento de la ballena y cámara cinemática por raíles. Transición suave entre modos.
- **Fase 2.4** Carga de la ballena, `AnimationMixer`, máquina de estados (nadar → preparar → saltar → caer → nadar) y lectura de eventos de la animación.
- **Fase 2.5** Herramientas de depuración: stats, *wireframe*, visualizar buffers y timeline de la secuencia.

**Hecho cuando:** la ballena nada y salta en una escena gris placeholder con la GUI funcionando.

---

## Fase 3: Cielo fotorrealista

- **Fase 3.1 Posición del sol (y luna) por fecha, hora, latitud y longitud.** Algoritmo NOAA/SunCalc. Parámetros: fecha, hora, zona horaria, lat/lon y velocidad del tiempo.
- **Fase 3.2 Atmósfera física.** Primero el `Sky` de Three.js (Preetham) como prototipo y después dispersión precomputada con LUTs (modelo Hillaire/Bruneton): Rayleigh, Mie, ozono, turbidez. Amaneceres, atardeceres y crepúsculo correctos.
- **Fase 3.3 Noche.** Estrellas, luna con fase según la fecha y brillo del cielo nocturno.
- **Fase 3.4 Nubes volumétricas.** *Raymarching* con ruido Perlin-Worley 3D y mapa de clima 2D. Parámetros: cobertura, densidad, altitud base, grosor, tipo (cúmulo ↔ estrato), viento. Render a media resolución con reproyección temporal para rendimiento.
- **Fase 3.5 Iluminación derivada del cielo.** Luz direccional del sol con color atmosférico, *environment map* (PMREM) regenerado al cambiar la hora, sombras de nubes sobre el mar y *aerial perspective* (bruma en el horizonte).

**Hecho cuando:** mover la hora del día cambia cielo, nubes, luz y reflejos de forma coherente.

---

## Fase 4: Océano (superficie)

- **Fase 4.1 Geometría.** Malla con LOD (clipmap o cascadas concéntricas centradas en la cámara) hasta el horizonte.
- **Fase 4.2 Olas, prototipo.** Suma de ondas de Gerstner parametrizadas (amplitud, longitud, dirección, *steepness*) para validar el shading pronto.
- **Fase 4.3 Olas, versión final.** Espectro FFT (JONSWAP + componente de mar de fondo/swell) en compute shaders con 2-3 cascadas de escala. Parámetros:
  - Viento: velocidad, dirección y *fetch*.
  - Mar de fondo (swell): altura, periodo, dirección y dispersión.
  - *Choppiness* (crestas afiladas) y escala de detalle.
- **Fase 4.4 Shading.** Fresnel, reflejo del cielo y del sol, refracción con color según profundidad, *subsurface scattering* en crestas iluminadas por detrás, espuma de rompiente calculada con el jacobiano (whitecaps) y micro-normales para el brillo lejano.
- **Fase 4.5 Consulta de altura.** Función para saber la altura del agua en cualquier punto (en CPU o con lectura de GPU) para la cámara, la ballena y las partículas.

**Hecho cuando:** el mar se ve creíble desde varias alturas y los parámetros de viento y swell cambian el estado del mar de calma a mar agitado.

---

## Fase 5: Interacción ballena ↔ agua

- **Fase 5.1 Detección de cruce.** Puntos de muestreo sobre los huesos de la ballena que detectan en qué zonas y a qué velocidad atraviesa la superficie.
- **Fase 5.2 Ondas dinámicas.** Simulación local de ecuación de onda (*height field* 2D) centrada en la ballena y sumada al oleaje: anillos concéntricos en la salida y, sobre todo, en el impacto.
- **Fase 5.3 Salpicaduras (partículas GPU).** Tres capas: gotas grandes con física balística, spray fino y niebla/bruma. Emisión según velocidad y área de intersección, con iluminación por el sol y el cielo.
- **Fase 5.4 Cortinas de agua sobre el cuerpo.** Agua que cae desde el lomo y las aletas durante el salto, goteo desde los bordes de las pectorales y shader de piel mojada.
- **Fase 5.5 Espuma persistente.** Textura de espuma acumulada en el mundo, que se advecta y se disipa con el tiempo; mancha blanca en la zona de impacto.
- **Fase 5.6 Estela.** Estela en superficie cuando la ballena nada cerca de ella.
- **Fase 5.7 Sincronización.** Los eventos `surface_exit`, `apex` e `impact` de la animación disparan emisores e impulsos de ondas.

**Hecho cuando:** el salto se ve como en las fotos de referencia: columna de agua, cortinas que caen y un gran impacto con ondas.

---

## Fase 6: Cámara bajo el agua

- **Fase 6.1 Transición.** Detección de cámara bajo la superficie y línea de flotación en pantalla (media imagen arriba y media abajo, con menisco y gotas en la lente al salir).
- **Fase 6.2 Superficie vista desde abajo.** Ventana de Snell, reflexión total interna y refracción del cielo y del sol.
- **Fase 6.3 Niebla y absorción.** Atenuación por longitud de onda (el rojo desaparece primero) y *fades* por distancia y profundidad, con color parametrizable (océano abierto, agua costera verde...).
- **Fase 6.4 God rays.** Raymarching volumétrico usando la superficie animada como máscara de sombra (versión *screen-space* como opción de bajo coste).
- **Fase 6.5 Cáusticas.** Proyectadas sobre la ballena y sobre las partículas.
- **Fase 6.6 Burbujas.** Nubes de burbujas en la entrada y salida de la ballena, estela de burbujas y burbujas que suben y estallan en superficie.
- **Fase 6.7 Partículas en suspensión.** Nieve marina y plancton flotando con corrientes, iluminados por los god rays.
- **Fase 6.8 Post-procesado subacuático.** Distorsión leve, viñeta, desenfoque por distancia y aberración cromática sutil.

**Hecho cuando:** se puede bajar la cámara bajo el agua y ver a la ballena subir hacia la luz y romper la superficie desde abajo.

---

## Fase 7: Secuencia y composición final

- **Fase 7.1 Timeline.** Secuencia: nado profundo → ascenso → salto → impacto → ondas y espuma → vuelta a nadar. Repetible y con disparo manual desde la GUI.
- **Fase 7.2 Cámaras cinemáticas.** Planos predefinidos (desde barco, a ras de agua, bajo el agua, aéreo) con cortes o travellings, incluido el paso sobre/bajo agua durante el salto.
- **Fase 7.3 Post-procesado global.** TAA, bloom, profundidad de campo, motion blur, *color grading* y grano.
- **Fase 7.4 Audio (opcional).** Oleaje ambiente, impacto y ambiente subacuático apagado.

---

## Fase 8: Rendimiento y entrega

- **Fase 8.1** Presupuesto de rendimiento (objetivo: 60 fps en GPU de escritorio de gama media) y perfiles de calidad Bajo / Medio / Alto / Ultra.
- **Fase 8.2** Perfilado y optimización: resoluciones de nubes y god rays, cascadas FFT, número de partículas y LOD de la ballena.
- **Fase 8.3** Build de producción, despliegue (GitHub Pages, Netlify o Vercel) y documentación de parámetros.
- **Fase 8.4 (opcional)** Captura a vídeo en alta calidad a cámara lenta.

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
- **Compatibilidad WebGPU:** si hay que soportar navegadores o equipos antiguos, se mantiene el camino WebGL2 con menos calidad.
