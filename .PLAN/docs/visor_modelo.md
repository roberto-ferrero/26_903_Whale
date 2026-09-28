# Visor del modelo en el navegador

28/09/2026 · Three.js r186 (`WebGPURenderer`) · lil-gui 0.21

## Resumen

- La ballena de las fases 1.1-1.5 ya se ve en el navegador: `npm run dev` y abrir http://localhost:5173.
- Incluye los 3 LODs, los 7 clips de animación, el material de piel con **mojado** en TSL, ayudas visuales y un panel lil-gui con las opciones.
- El GLB sale de una **exportación preliminar** (parte de la Fase 1.8): texturas PNG y sin compresión (18,9 MB). La versión final con KTX2 y compresión de malla llegará en la 1.8.
- El modelo **no se versiona** (licencia de CGTrader): `public/models/*` está en `.gitignore`. Hay que generarlo y copiarlo a mano (ver abajo).

## Cómo ponerlo en marcha

1. Exportar el GLB desde la copia de trabajo:
   ```
   "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background "_Blender\Claude modelo\Whale_opt.blend" ^
     --python "_Blender\scripts\export_glb.py" -- "_Blender\Claude modelo\export\whale.glb"
   ```
   El script también copia `whale_wet_2k.png` junto al GLB.
2. Copiar `whale.glb` y `whale_wet_2k.png` a `_Repos\26_903_Whale\public\models\`.
3. En `_Repos\26_903_Whale`, ejecutar `npm run dev`.

Si falta el GLB, el visor lo indica en pantalla con estas mismas instrucciones.

## Contenido del GLB exportado

| Elemento | Valor |
|---|---|
| Mallas | `Whale_LOD0` (39 196 tris), `Whale_LOD1` (14 997), `Whale_LOD2` (4 998); 3 primitivas cada una (piel, córnea, barbs) |
| Esqueleto | 1 skin de 47 huesos compartido por los 3 LODs; 4 influencias por vértice |
| Animaciones | `Idle`, `JumpLeft`, `JumpRight`, `JumpStraight`, `MouthOpen`, `Swim1`, `Swim2` (141 canales cada una) |
| Materiales | `Humpback`: baseColor, ORM (metallicRoughness + occlusion), normal, `KHR_materials_specular`, `extras.wet_map` · `Barbs`: `alphaMode: MASK` · `Cornea`: `KHR_materials_transmission` |
| Tamaño | 18,9 MB (texturas PNG embebidas) |

El exportador avisa de que la imagen ORM se usa en dos nodos. Es lo esperado: una sola textura sirve para `metallicRoughnessTexture` y para `occlusionTexture`.

## Estructura del código

| Archivo | Función |
|---|---|
| `src/main.js` | Arranque: visor, carga de la ballena, controladores, GUI y bucle |
| `src/core/viewer.js` | `WebGPURenderer`, escena, cámara con OrbitControls, entorno PMREM (`RoomEnvironment`), sol y luz hemisférica, ajuste de tamaño |
| `src/core/helpers.js` | Rejilla, ejes, esqueleto, caja envolvente de la malla deformada, plano de agua, dirección del sol y persona de 1,8 m |
| `src/core/stats.js` | Panel de FPS, draw calls, triángulos, LOD activo y tiempo del clip |
| `src/core/gui.js` | Panel lil-gui (en español) y guardar/restablecer ajustes en `localStorage` |
| `src/whale/whale.js` | Carga del GLB, paso a materiales de nodos, mojado en TSL, control de LOD y de animaciones |

Detalles técnicos:

- **Materiales de nodos.** GLTFLoader crea `MeshPhysicalMaterial` y `MeshStandardMaterial`; `whale.js` los convierte a `MeshPhysicalNodeMaterial` y `MeshStandardNodeMaterial` para poder usar TSL.
- **Mojado en la piel:** `roughnessNode = mix(ORM.g, WET.r, mojado · (0,6 + 0,4 · WET.g))` y el color se oscurece hasta un 12 % (ajustable).
- **LOD manual.** Se usa la distancia de la cámara al centro de la ballena (por defecto LOD1 a 40 m y LOD2 a 120 m) y se muestra un solo LOD. No se usa `THREE.LOD`, porque reparentar mallas con piel que comparten esqueleto da problemas.
- **Mallas con piel** con `frustumCulled = false`: su caja estática no sigue a la animación, y en los saltos la ballena desaparecería al salir de ella.
- **Tamaño de la ventana.** El bucle comprueba el tamaño cada fotograma (`ensureSize`). Si la página se carga con la ventana oculta no siempre llega un `resize`, y el canvas se quedaba en 0×0 (me pasó en las pruebas).

## Panel de opciones

| Carpeta | Opciones |
|---|---|
| **Animación** | Clip, reproducir/pausa, velocidad (0-3×), bucle, fundido entre clips (s), tiempo (arrastrar para moverse por el clip), pose de reposo |
| **Modelo** | LOD (Auto, LOD0, LOD1, LOD2), distancias de cambio, **mojado** (0-1), oscurecer al mojar, normal map on/off e intensidad, intensidad de AO, alambre, pelos ("barbs") on/off |
| **Iluminación** | Tone mapping (AgX, ACES, Neutral, Reinhard, ninguno), exposición, luz de entorno, sol (intensidad, color, elevación, azimut), luz hemisférica, color de fondo |
| **Ayudas** | Rejilla de 1 m y su altura, ejes, esqueleto, caja envolvente, plano de agua (nivel y opacidad), dirección del sol, persona de 1,8 m, estadísticas |
| **Cámara** | Vistas (tres cuartos, lateral, frontal, superior, inferior, cabeza, cola), campo de visión, giro automático y su velocidad |
| Raíz | Guardar ajustes y Restablecer |

Coordenadas en Three.js: metros, Y arriba, **morro hacia +Z** y cola hacia −Z. El nivel de agua por defecto (−0,30 m) es el plano `Water` del .blend original escalado a 14 m; los saltos del modelo parten de ahí.

## Pruebas realizadas

Probado en el navegador integrado con el backend WebGPU:

- Carga del GLB y de las texturas.
- Cambio de clip (`Swim1` → `JumpRight`), esqueleto, plano de agua, mojado a 1, LOD2 forzado (4 998 tris) y alambre.
- Consola sin errores tras corregir el tamaño 0.
- `npm run build` sin errores. El bundle pesa 1,04 MB (285 kB con gzip); se trocea más adelante.

**FPS sin medir:** el navegador integrado estaba oculto durante la prueba y limita los fotogramas (marcaba 1-4 fps). Hay que comprobar el rendimiento en un navegador normal. Con 40 k triángulos y 7-10 draw calls debería ir sobrado.
