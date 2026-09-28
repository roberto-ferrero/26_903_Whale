# Fase 1.3 · Limpieza y normalización

28/09/2026 · Blender 5.1.1 · scripts `fase_1_3_limpieza.py` y `fase_1_3_escala_bake_src.py`

## Resumen

- La ballena mide ahora **14,00 m** (antes 19,14 m). El factor de escala ×0,731271 se aplicó en Blender a la malla, al reposo de los huesos y a las **107 019 claves de posición** de las 7 animaciones. La fuente de horneado (alta poligonal) se escaló igual.
- **Eliminado:**
  - El grupo de vértices `shrinkwrap`, que no correspondía a ningún hueso.
  - El atributo de color `Col`, que ningún material usaba.
  - La acción `RestPosee` (un solo fotograma, con su pista NLA).
  - Los nodos de material sin conectar y los datos huérfanos.
- **Compatible con glTF:**
  - Transformaciones de los objetos en identidad; la malla es hija de `WhaleRig`.
  - Huesos en cuaterniones; unidades en metros.
  - Morro hacia −Y en Blender, que en glTF y Three.js queda hacia +Z.
- **Verificado:** en las 35 poses de control, los vértices deformados coinciden con el original × 0,731271, con un error máximo de 0,86 mm (el redondeo del JSON de control). Las 9 texturas cargan con rutas relativas.
- **Pospuesto a propósito:**
  - Triangular los 20 n-gons y limitar a 4 influencias (ver "Decisiones").
  - Renombrar los clips, que es tarea de la 1.7.

## Pasos

### 1. Escala a 14 m (decisión de Roberto: en Blender)

| Dato | Antes | Después |
|---|---:|---:|
| Longitud (Y) | 19,145 m | **14,000 m** |
| Envergadura con pectorales (X) | 9,398 m | 6,872 m |
| Altura (Z) | 4,529 m | 3,312 m |
| Pectoral (aprox.) | 4,8 m | 3,5 m |
| Envergadura de la caudal | 5,76 m | 4,21 m |
| Bounding box en reposo | (−4,70, −9,30, −1,66) → (4,70, 9,85, 2,87) | (−3,44, −6,80, −1,21) → (3,44, 7,20, 2,10) |

Cómo se hizo:

- **Escala de los datos, no de los objetos.** La malla `Whale` es hija de `WhaleRig`. Si se escalan los dos objetos y se aplica la escala, la hija hereda la del padre y acaba escalada dos veces. En la primera ejecución salió a 10,24 m (×0,731²); lo detecté y lo corregí. Ahora se escalan directamente los datos con `Mesh.transform(S)` y `Armature.transform(S)`, respecto al origen del mundo, y los objetos quedan sin escala.
- **Animaciones:** las posiciones de los huesos (`pose.bones[...].location`) están en el espacio local de cada hueso, que escala con el reposo, así que se multiplican por el factor. Son 1 128 curvas: 141 por acción × 8 acciones, contando `RestPosee` antes de borrarla. Las rotaciones (cuaterniones) y las escalas de hueso no cambian.
- **Fuente de horneado:** `Whale_bake_src.blend` se escaló con el mismo factor y respecto al mismo origen. La alta mide 13,99 m, igual que antes guardaba la misma proporción con la baja (19,13 frente a 19,15), así que alta y baja siguen alineadas para hornear en la 1.4.

### 2. Datos sobrantes eliminados

| Elemento | Motivo |
|---|---|
| Grupo de vértices `shrinkwrap` | No es un hueso; se exportaría como un peso inútil. Tras quitarlo, el máximo de influencias baja de 10 a 9 y los vértices con más de 4, de 1 942 a 1 443 |
| Atributo de color `Col` | Ningún material lo lee; en glTF añadiría un `COLOR_0` innecesario |
| Acción `RestPosee` y su pista NLA | Un solo fotograma; el exportador la convertiría en un clip vacío. El reposo ya está en el esqueleto |
| Nodos sin conexión y huérfanos | Limpieza general |

### 3. Comprobaciones para glTF

| Comprobación | Resultado |
|---|---|
| Transformaciones de `Whale` y `WhaleRig` | Identidad (posición 0, rotación 0, escala 1) |
| Jerarquía | `Whale` es hija de `WhaleRig`, con el modificador Armature apuntando a `WhaleRig` |
| Unidades | Métrico, metros, `scale_length` = 1 |
| Ejes | Arriba +Z y morro −Y en Blender; el exportador lo pasa a arriba +Y y morro +Z |
| Rotación de huesos | Todos en `QUATERNION` |
| Materiales | `Humpback`, `Cornea`, `Barbs` |
| Imágenes | 9, en `//textures/…`, todas cargan |
| Acciones | `Idle_Anim`, `Swim1_Anim`, `Swim2_Anim`, `MouthOpen_Anim`, `JumpStraight_Anim`, `JumpLeft_Anim`, `JumpRight_Anim` |

## Decisiones

- **N-gons (20): se dejan.** La Fase 1.4 aplicará la subdivisión nivel 1 para el LOD0, y la subdivisión convierte cualquier n-gon en quads limpios. Triangularlos ahora estropearía esa subdivisión. En la malla base, que será el LOD1, el exportador glTF triangula solo.
- **Influencias por vértice: se limitan después.** Al aplicar la subdivisión, los pesos de los vértices nuevos se interpolan y pueden sumar más influencias. Por eso el límite a 4 y la normalización se harán sobre cada LOD ya generado (final de la 1.4 o en la 1.6), y se comprobará cuánto cambia la deformación.
- **Instantáneas para repetir el proceso:** los scripts leen siempre la instantánea de la fase anterior (`versiones\Whale_opt_f1_2.blend` y `versiones\Whale_bake_src_f1_2.blend`) y escriben `Whale_opt.blend` y `Whale_bake_src.blend`. Así se pueden volver a ejecutar sin escalar dos veces. Además, el script no escala si la ballena ya mide 14 m.

## Incidencias resueltas

1. **Doble escala por la jerarquía.** El primer intento dejó la ballena en 10,24 m; se corrigió escalando los datos en lugar de los objetos.
2. **Rutas de textura rotas en la instantánea.** Al copiar el .blend a `versiones\`, sus rutas relativas pasan a apuntar a `versiones\textures\`. El script reescribe ahora cada imagen a `//textures/<fichero>` respecto al .blend de salida y comprueba que el archivo existe antes de guardar.
3. **`os.path.basename("//textures/x.png")` devuelve una cadena vacía en Windows,** porque interpreta `//` como ruta de red UNC. Se sustituyó por un `split('/')` manual.

## Verificación

`verify_model.py` sobre el resultado, comparado con `original.json` × 0,731271:

| Comprobación | Resultado |
|---|---|
| Vértices / caras / triángulos | 4 975 / 4 926 / 9 746 (sin cambios) |
| Grupos de vértices | 47, uno por hueso |
| Máx. influencias / vértices con más de 4 | 9 / 1 443 (se resolverá en la 1.4-1.6) |
| Huesos | 47 |
| Imágenes | 9 de 9 cargan |
| Poses comparadas | 35 (reposo y 4-5 fotogramas de cada clip) |
| Error máximo frente al original escalado | **0,86 mm**, dentro del redondeo del JSON (3 decimales) |

## Archivos

En `_Blender\Claude modelo\`; no se versionan por la licencia.

| Archivo | Contenido |
|---|---|
| `Whale_opt.blend` | Resultado de la 1.3 (3,7 MB) |
| `Whale_bake_src.blend` | Alta poligonal escalada a 14 m |
| `versiones\Whale_opt_f1_2.blend`, `versiones\Whale_bake_src_f1_2.blend` | Instantáneas de la 1.2, entrada de los scripts |
| `verificacion\whale_opt_f1_3.json`, `verificacion\f1_3\*.png` | Datos y renders de la verificación |

## Cómo reproducir

```
set BL="C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
set M=D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender\Claude modelo
%BL% --background "%M%\versiones\Whale_opt_f1_2.blend" --python _Blender\scripts\fase_1_3_limpieza.py -- "%M%\Whale_opt.blend" 14
%BL% --background "%M%\versiones\Whale_bake_src_f1_2.blend" --python _Blender\scripts\fase_1_3_escala_bake_src.py -- "%M%\Whale_bake_src.blend" 0.731271
%BL% --background "%M%\Whale_opt.blend" --python _Blender\scripts\verify_model.py -- "%M%\verificacion\whale_opt_f1_3.json" Whale WhaleRig
```

Copia de los scripts en [`scripts/fase_1_3/`](scripts/fase_1_3/).
