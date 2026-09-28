# Fase 1.8 · Exportación y validación

28/09/2026 · Blender 5.1.1 (`export_glb.py`) · gltfpack 1.3 nativo · glTF-Validator (Khronos) 2.0.0-dev.3.10

## Resumen

- **GLB final: 10,1 MB** (antes 19,6 MB):
  - Malla y animación comprimidas con meshopt y cuantizadas: 0,5 MB.
  - Texturas en **KTX2 UASTC**: en la GPU llegan como BC7 (1 byte por píxel, con mipmaps), unos 27 MB de memoria frente a unos 107 MB con PNG.
- **Mapa de mojado** en KTX2: 3,9 → 2,0 MB.
- **Validador de Khronos: 0 errores.** Las 10 comprobaciones propias del proyecto están en verde.
- **En el navegador** (WebGPU): las texturas llegan comprimidas, sin errores en consola, y la secuencia del salto dispara los mismos eventos (`surface_exit` 7,27 s · `apex` 8,33 s · `impact` 9,17 s).
- **Dos comandos** reproducen todo desde el GLB exportado por Blender: `npm run pack:model` y `npm run validate:model`.
- **Decisión: UASTC también para el color.** ETC1S es un 28 % más pequeño (7,3 MB), pero tiñe de verde la piel oscura de la cabeza (comparado en el visor con la misma cámara que el PNG). UASTC se ve igual que el PNG.

## Proceso

```
1. Blender  →  _Blender\Claude modelo\export\whale.glb + whale_wet_2k.png
   "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background "_Blender\Claude modelo\Whale_opt.blend" ^
     --python "_Blender\scripts\export_glb.py" -- "_Blender\Claude modelo\export\whale.glb"
2. Empaquetar →  public/models/whale.glb + whale_wet_2k.ktx2
   npm run pack:model
3. Validar
   npm run validate:model
```

- **`export_glb.py`:** exporta los 3 LODs, el esqueleto de 48 huesos, los 10 clips y los `extras`, con **tangentes MikkTSpace** (las mismas con las que se horneó el normal map) y 4 influencias por vértice.
- **`tools/pack-model.mjs`** ejecuta el `gltfpack` **nativo**. La versión npm no trae el codificador BasisU. El binario está en `_Blender\tools\gltfpack\gltfpack.exe`: release oficial v1.3 de meshoptimizer, descargada con permiso de Roberto el 28/09/2026. Su ruta se puede cambiar con la variable `GLTFPACK`. El script hace dos cosas:
  1. **Empaqueta el GLB:** `gltfpack -cc -kn -km -ke -tu`.
  2. **Convierte el mapa de mojado:** `gltfpack` solo convierte texturas que estén dentro de un glTF, así que el script lo envuelve en un glTF mínimo (como textura de datos lineales, UASTC) y recoge el `.ktx2` resultante.
- **`tools/validate-model.mjs`:** validador de Khronos más las comprobaciones del proyecto.

| Opción de `gltfpack` | Para qué |
|---|---|
| `-cc` | meshopt de nivel alto (`EXT_meshopt_compression`) y cuantización (`KHR_mesh_quantization`) |
| `-kn` | Conserva los nodos con nombre: `Whale_LOD0/1/2`, `Root` y los huesos |
| `-km` | Conserva los materiales con nombre (`Humpback`, `Barbs`, `Cornea`), que usa el visor |
| `-ke` | Conserva los `extras` de nodos y materiales (`wet_map`, `anchor`, `clip_events`) |
| `-tu` | Texturas KTX2 con **UASTC** (`KHR_texture_basisu`) |

## Comparación de variantes

| Variante | Tamaño | Color de la piel oscura | Memoria GPU (texturas) |
|---|---:|---|---:|
| Blender, PNG sin comprimir | 19,58 MB | Referencia | ≈ 107 MB (RGBA8 + mipmaps) |
| meshopt + PNG | 17,02 MB | Igual | ≈ 107 MB |
| meshopt + ETC1S (color) / UASTC (normal y ORM) | 7,29 MB | **Tinte verdoso** en la cabeza | ≈ 27 MB (BC7) |
| meshopt + ETC1S calidad 10 (color) / UASTC | 7,34 MB | Casi igual que la anterior | ≈ 27 MB |
| **meshopt + UASTC en todas** (elegida) | **10,10 MB** | **Igual que el PNG** | ≈ 27 MB (BC7) |

En la GPU de escritorio el visor transcodifica a BC7 (formato 36492) todas las texturas: 2048² y 12 niveles de mipmap, excepto las "barbs", que son de 512² y 10 niveles.

## Validación (`npm run validate:model`)

| Comprobación | Resultado |
|---|---|
| Validador de Khronos | **0 errores**, 16 avisos, 7 informativos |
| 3 LODs (`Whale_LOD0/1/2`) | ✔ |
| 1 esqueleto de 48 articulaciones | ✔ |
| Hueso `Root` con `extras.anchor` | ✔ |
| Clips `swim_idle`, `swim_fast`, `breach_body` (10 clips en total) | ✔ |
| Eventos de `breach_body` | ✔ (copia en `Root`, ver abajo) |
| Piel: baseColor, ORM, normal y oclusión | ✔ |
| Piel: `extras.wet_map` | ✔ |
| Barbs: `alphaMode: MASK` | ✔ |
| Malla comprimida (meshopt) | ✔ |
| Texturas KTX2 (`KHR_texture_basisu`) | ✔ |

Avisos que quedan, todos sin efecto:

- **`IMAGE_UNRECOGNIZED_FORMAT` y `VALUE_NOT_IN_LIST 'image/ktx2'` (10):** esta versión del validador no reconoce `image/ktx2` como tipo de imagen, aunque la extensión `KHR_texture_basisu` lo permite expresamente.
- **`NODE_SKINNED_MESH_NON_ROOT` (3):** las mallas con piel cuelgan de `WhaleRig`, como las exporta siempre Blender. En glTF la posición de una malla con piel la dan los huesos.
- **`NODE_SKINNED_MESH_LOCAL_TRANSFORMS` (3):** `gltfpack` guarda en el nodo la escala de descuantización y, para mallas con piel, la incorpora también a las matrices de enlace del esqueleto. Comprobado en el visor: la ballena mide 13,96 m.

Los avisos de tangentes (`MESH_PRIMITIVE_GENERATED_TANGENT_SPACE`) desaparecieron al exportar las tangentes desde Blender.

## Incidencias resueltas

1. **`gltfpack` quita los `extras` de las animaciones** aunque se use `-ke`, y se perdían los eventos de `breach_body`. Ahora `fase_1_7_clips.py` los copia también en el hueso `Root` (`extras.clip_events`), y el visor y el validador leen cualquiera de las dos copias.
2. **La versión npm de `gltfpack` no codifica KTX2** ("node.js builds do not support BasisU"). Se usa el binario nativo; la versión npm queda como dependencia de desarrollo por si solo se necesita meshopt.
3. **Tinte verdoso con ETC1S:** resuelto usando UASTC para el color (ver la comparación).

## Visor

- `src/whale/whale.js` usa `GLTFLoader` con `KTX2Loader` (transcodificador en `public/basis/`, copiado de Three.js, licencia MIT, sí se versiona) y `MeshoptDecoder`.
- El mapa de mojado se carga como `.ktx2`, y se admite `.png` si se cambia la URL.
- `public/models/*` sigue **sin versionarse** por la licencia de CGTrader. Tras clonar el repo hay que generar los dos archivos con el proceso de arriba.

## Archivos

| Archivo | Contenido |
|---|---|
| `_Blender\scripts\export_glb.py` | Exportación desde Blender (con tangentes) |
| `_Blender\tools\gltfpack\gltfpack.exe` | gltfpack 1.3 nativo (fuera del repo) |
| `_Blender\Claude modelo\export\` | `whale.glb` (19,6 MB), `whale_wet_2k.png` y variantes de prueba: `whale_meshopt.glb`, `whale_ktx2*.glb` |
| `tools/pack-model.mjs` · `npm run pack:model` | Empaquetado final |
| `tools/validate-model.mjs` · `npm run validate:model` | Validación |
| `public/models/whale.glb` (10,1 MB), `public/models/whale_wet_2k.ktx2` (2,0 MB) | Modelo final (sin versionar) |
| `public/basis/basis_transcoder.{js,wasm}` | Transcodificador KTX2 |

## Pendiente (fuera de la 1.8)

- La propiedad `wet_map` del material sigue diciendo `whale_wet_2k.png`, que es el nombre de la imagen de origen; el visor carga el `.ktx2` desde su propia URL. Se puede alinear la próxima vez que se regenere el modelo desde la Fase 1.5.
- Distancias de LOD y perfiles de calidad: Fase 8.
