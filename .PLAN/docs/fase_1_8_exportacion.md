# Fase 1.8 · Exportación y validación

28/09/2026 · Blender 5.1.1 (`export_glb.py`) · gltfpack 1.3 · glTF-Validator (Khronos) 2.0.0-dev.3.10

> **Estado: en curso.** La compresión de malla (meshopt) y la validación están hechas. Las **texturas KTX2 esperan permiso** para descargar el `gltfpack` nativo (ver "Pendiente").

## Resumen

- **Proceso:** Blender (`export_glb.py`) → `whale.glb` (PNG, sin comprimir) → `gltfpack -cc` → `whale_meshopt.glb` → `public/models/whale.glb`.
- **Tamaño:** la geometría y la animación pasan de ≈ 2,7 MB a **0,5 MB** con meshopt y cuantización. El GLB mide ahora 17,0 MB, frente a 19,6 MB: **el 96 % son las 5 texturas PNG**, así que KTX2 es lo que falta para reducirlo de verdad.
- **Validador de Khronos: 0 errores.** Quedan 6 avisos, todos explicados (ver abajo).
- **Tangentes MikkTSpace:** ahora se exportan (`export_tangents=True`), las mismas con las que se horneó el normal map. Así el sombreado no depende de las tangentes que calcule el navegador, y desaparecen 6 avisos del validador.
- **Eventos:** `gltfpack` quita los `extras` de las animaciones aunque se use `-ke`, así que los eventos de `breach_body` también se guardan en el hueso `Root` (`extras.clip_events`), que sí se conserva. El visor lee cualquiera de las dos copias.
- **Visor:** carga GLB comprimidos, con `MeshoptDecoder` y `KTX2Loader` (transcodificador Basis en `public/basis/`, copiado de Three.js).
- **Comprobado en el navegador:** tamaño correcto (13,96 m con posiciones cuantizadas a 16 bits), texturas bien y la secuencia del salto con los mismos eventos: `surface_exit` 7,27 s, `apex` 8,33 s, `impact` 9,17 s.

## Proceso de exportación

```
set BL="C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
set M=D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender\Claude modelo
%BL% --background "%M%\Whale_opt.blend" --python _Blender\scripts\export_glb.py -- "%M%\export\whale.glb"
npx gltfpack -i "%M%\export\whale.glb" -o "%M%\export\whale_meshopt.glb" -cc -kn -km -ke
copy "%M%\export\whale_meshopt.glb" public\models\whale.glb
npm run validate:model
```

Opciones de `gltfpack`:

| Opción | Para qué |
|---|---|
| `-cc` | Compresión meshopt de nivel alto (`EXT_meshopt_compression`) y cuantización (`KHR_mesh_quantization`) |
| `-kn` | Conserva los nodos con nombre: `Whale_LOD0/1/2`, `Root` y los huesos |
| `-km` | Conserva los materiales con nombre (`Humpback`, `Barbs`, `Cornea`), que el visor usa |
| `-ke` | Conserva los `extras` de nodos y materiales (`wet_map`, `anchor`, `clip_events`) |

Resultado de `gltfpack`:

| Dato | Valor |
|---|---|
| Primitivas / triángulos / vértices | 9 / 59 191 / 32 234 (los 3 LODs) |
| Draw calls | 9 (se ve un LOD cada vez: 3) |
| Buffers | vértices 407 kB · índices 67 kB · piel 2 kB · animación 52 kB · **imágenes 16,4 MB** |
| JSON | 115 kB |

## Validación (`npm run validate:model`)

`tools/validate-model.mjs` pasa el **glTF-Validator oficial de Khronos** y añade comprobaciones propias del proyecto:

| Comprobación | Resultado |
|---|---|
| Validador de Khronos | **0 errores**, 6 avisos, 1 informativo |
| 3 LODs (`Whale_LOD0/1/2`) | ✔ |
| 1 esqueleto de 48 articulaciones | ✔ |
| Hueso `Root` con `extras.anchor` | ✔ |
| Clips `swim_idle`, `swim_fast`, `breach_body` (10 clips en total) | ✔ |
| Eventos de `breach_body` (`surface_exit`, `apex`, `impact`) | ✔ (copia en `Root`) |
| Piel: baseColor, ORM, normal y oclusión | ✔ |
| Piel: `extras.wet_map` | ✔ |
| Barbs: `alphaMode: MASK` | ✔ |
| Malla comprimida (meshopt) | ✔ |
| Texturas KTX2 (`KHR_texture_basisu`) | ✘ **pendiente** |

Avisos que quedan, todos sin efecto:

- **`NODE_SKINNED_MESH_NON_ROOT` (3):** las mallas con piel cuelgan de `WhaleRig`, como las exporta siempre Blender. En glTF la posición de una malla con piel la dan los huesos, no sus padres, así que no importa.
- **`NODE_SKINNED_MESH_LOCAL_TRANSFORMS` (3):** `gltfpack` guarda en el nodo la escala de descuantización. Para mallas con piel la incorpora también a las matrices de enlace del esqueleto; comprobado en el visor, la ballena mide 13,96 m, como debe.

## Pendiente: texturas KTX2

- **El problema:** la versión npm de `gltfpack` no incluye el codificador BasisU ("node.js builds do not support BasisU"). En el equipo no hay ningún codificador instalado (`toktx`, `basisu` ni `gltfpack` nativo).
- **La propuesta, a la espera de permiso:** descargar `gltfpack-windows.zip` (1,48 MB) de la release oficial v1.3 de meshoptimizer en GitHub a `_Blender\tools\gltfpack\` y ejecutar:
  ```
  gltfpack -i whale.glb -o whale_ktx2.glb -cc -kn -km -ke -tc -tu normal -tu attrib
  ```
  - **ETC1S** para el color, que comprime mucho.
  - **UASTC** para el normal map y el ORM, para no degradar el detalle.
- **El mapa de mojado:** se carga aparte (`whale_wet_2k.png`, 3,9 MB) y se convertiría también a KTX2 (el visor ya admite `.ktx2`) o, si no, a WebP.
- **Alternativa sin descargas:** texturas WebP desde Blender. Reducen el archivo, pero en la GPU ocupan lo mismo que ahora (≈ 107 MB con mipmaps, frente a ≈ 15-30 MB con KTX2).

## Archivos

| Archivo | Contenido |
|---|---|
| `_Blender\scripts\export_glb.py` | Exportación desde Blender, ahora con tangentes |
| `_Blender\scripts\fase_1_7_clips.py` | Copia los eventos también en el hueso `Root` |
| `_Blender\Claude modelo\export\whale.glb` / `whale_meshopt.glb` | Sin comprimir (19,6 MB) / meshopt (17,0 MB) |
| `tools/validate-model.mjs` + `npm run validate:model` | Validación (Khronos + proyecto) |
| `public/basis/basis_transcoder.{js,wasm}` | Transcodificador KTX2 de Three.js (MIT; se versiona) |
| `src/whale/whale.js` | `KTX2Loader` + `MeshoptDecoder`; eventos desde las animaciones o desde `Root` |
| `package.json` | Añade `gltfpack` y `gltf-validator` como dependencias de desarrollo |
