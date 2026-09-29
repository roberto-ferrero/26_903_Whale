# Ballena jorobada saltando en el mar (Three.js · WebGPU)

Escena en tiempo real de una ballena jorobada que sale del agua, salta e impacta. Incluye:

- cielo físico con nubes volumétricas;
- océano FFT;
- salpicaduras, espuma, burbujas y ondas generadas por la ballena;
- cámara bajo el agua con god rays y cáusticas;
- secuencia cinematográfica con cámaras automáticas, posprocesado y audio procedural.

Está hecho con Three.js r186 (`WebGPURenderer` + TSL) y Vite. El plan de trabajo y la documentación de cada fase están en [`.PLAN/`](.PLAN/PLAN.md).

## Requisitos

- **Navegador con WebGPU:** Chrome o Edge 113+, Safari 26+, Firefox 141+ (Windows). Sin WebGPU arranca en **modo WebGL2** con calidad reducida: olas de Gerstner en lugar de FFT, sin salpicaduras ni ondas de la ballena. Para probar ese modo, añade `?webgl` a la URL.
- **Node.js** 20 o superior.
- **El modelo de la ballena**, que **no está en el repositorio** (ver abajo).

### El modelo (no incluido)

El modelo de CGTrader tiene licencia *Royalty Free*, que no permite redistribuir los archivos, así que `public/models/` está en `.gitignore`. Hay que generar `whale.glb` y `whale_wet_2k.ktx2` con el proceso de [`.PLAN/docs/fase_1_8_exportacion.md`](.PLAN/docs/fase_1_8_exportacion.md) (Blender 5.1 + `npm run pack:model`) y copiarlos a `public/models/`. Sin ellos, la aplicación muestra un aviso.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm install` | Instala las dependencias |
| `npm run dev` | Servidor de desarrollo (con herramientas de captura y medida en `window.whaleViewer`) |
| `npm run build` | Build de producción en `dist/` (rutas relativas: funciona en cualquier subruta) |
| `npm run preview` | Sirve `dist/` para probar el build |
| `npm run pack:model` | Empaqueta el GLB (meshopt + texturas KTX2) |
| `npm run validate:model` | Valida el GLB (Khronos glTF-Validator) |
| `npm run gen:clouds` | Regenera las texturas de ruido de las nubes |
| `npm run test:ocean` | Pruebas del espectro y la FFT del océano |

## Uso

- **Secuencia completa:** carpeta *Secuencia* → «▶ Reproducir secuencia» (tecla **P**): nada → respira (soplido) → nada → salta → nada → respira → nada → respira, con cámaras automáticas.
- **Teclado:** **Espacio** pausa · **.** avanza un fotograma · **J** salta ahora · **R** respira ahora · **B** muestra u oculta las ayudas de depuración · **C** cambia de modo de cámara · **P** reproduce o para la secuencia.
- **Por defecto:** panel replegado, sin ayudas en pantalla, agua tropical clara, y profundidad de campo y motion blur activados (perfil Alto).
- **Calidad:** carpeta *Calidad*, con los perfiles Bajo, Medio, Alto (por defecto), Ultra y Automático (baja o sube según los fps).
- **Presets y URL:** carpeta *Presets y URL*. Hay 10 presets (mediodía, atardecer, tormenta, noche, mar en calma, mar agitado…), y todos los ajustes se guardan en la URL (`#modulo.clave=valor`) y se pueden exportar a JSON.
- **Vídeo:** carpeta *Grabar vídeo* (WebM, hasta 120 Mbit/s). Para cámara lenta, baja la velocidad en *Tiempo*.
- **Referencia completa de parámetros:** [`.PLAN/docs/parametros.md`](.PLAN/docs/parametros.md).

## Rendimiento

Medido a 1920×1080 en el equipo de desarrollo:

| Perfil | Sobre el agua | Bajo el agua |
|---|---|---|
| Bajo | 6,2 ms | 5,5 ms |
| Medio | 7,7 ms | 8,9 ms |
| Alto | 10,9 ms | 15,1 ms |
| Ultra | 15,9 ms | 34 ms (ahora con 20 pasos de god rays en vez de 28; sin volver a medir) |

El desglose por módulo está en [`.PLAN/docs/fase_8_entrega.md`](.PLAN/docs/fase_8_entrega.md).

## Despliegue

`npm run build` genera `dist/` con rutas relativas (`base: './'`), así que sirve tal cual en GitHub Pages, Netlify, Vercel o cualquier servidor estático. **Ojo:** `dist/` incluye el modelo (copiado de `public/models/`). Antes de publicarlo hay que confirmar que la licencia del modelo permite servirlo en una web pública.

## Estructura

```
src/core       renderer, reloj, parámetros, GUI, cámaras, secuencia, posprocesado, calidad, grabación
src/whale      carga del modelo, animación, máquina de estados y planificador del salto
src/sky        astronomía, atmósfera física, cielo y nubes volumétricas
src/ocean      espectro, FFT (compute), Gerstner y superficie del océano
src/water      sondas, ondas y espuma de la ballena, salpicaduras y burbujas
src/underwater posprocesado bajo el agua y partículas en suspensión
src/audio      audio procedural (WebAudio)
tools/         empaquetado del modelo, ruido de nubes y pruebas
.PLAN/         plan, documentación por fase y capturas
```
