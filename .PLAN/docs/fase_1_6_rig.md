# Fase 1.6 · Rig y punto de anclaje

28/09/2026 · Blender 5.1.1 · script `fase_1_6_rig.py`

## Resumen

- **El esqueleto del modelo se mantiene: no hace falta reconstruirlo.** Tiene 47 huesos deformantes, simetría izquierda/derecha exacta (0 mm) y 4 influencias por vértice normalizadas en los 3 LODs (hecho en la 1.4).
- **Nuevo hueso `Root`** (no deformante) en el **centro de masas**, padre de toda la jerarquía. Es el **punto de anclaje** desde el que se moverá y girará la ballena entera (trayectoria del salto en la 1.7). Añadirlo no cambia las animaciones (0,013 mm).
- **Centro de masas:** al 39,5 % de la longitud desde el morro. La piel encierra 26,8 m³, unas 27 t con la densidad del agua de mar, coherente con una jorobada de 14 m (25-30 t).
- **Visor:** ayudas nuevas para el esqueleto y para el punto de anclaje (ver [visor_modelo.md](visor_modelo.md)).

## Revisión del esqueleto

| Requisito del plan | Estado | Comentario |
|---|---|---|
| Columna de 12-16 huesos | 11 + `Root` | `MasterBone` → `Spine.003` → `Spine.004` → `Spine.005` → `Head` y `MasterBone.006` → `Spine` → `.001` → `.002` → `.008` → `.007`. Basta para ondular; ampliar la cadena obligaría a repesar y a rehacer las 7 animaciones |
| Cabeza y mandíbula | ✔ | `Head`, `UpperJaw`, `LowerJaw` (la mandíbula gira hasta 30° en los clips) |
| Pectorales | ✔ | 6 huesos por lado (`Fin.L` … `Fin.L.005`) |
| Caudal (pedúnculo y lóbulos) | ✔ | 5 huesos por lóbulo (`Tail.L` … `Tail.L.004`), sobre `Spine.007` |
| Máx. 4 influencias | ✔ | Hecho en la 1.4: máximo 4 y suma 1,0 en LOD0, LOD1 y LOD2 |
| Simetría | ✔ | Cabeza de cada hueso `.L` frente a su `.R` reflejado en X: diferencia máxima 0,0 mm |

### Rango de movimiento en los 7 clips

Ángulo máximo respecto al reposo y desplazamiento máximo de cada hueso, recorriendo todos los clips cada 2 fotogramas:

| Hueso o grupo | Rotación máx. | Desplazamiento máx. | Nota |
|---|---:|---:|---|
| `MasterBone` | 59° | 3,24 m | **Raíz de la animación original:** es lo que sube y gira en los saltos |
| `Spine.003`-`Spine.005`, `Head` | 9-18° | — | |
| `LowerJaw` / `UpperJaw` | 30° / 13° | 0,61 m / — | Boca (`MouthOpen`, saltos) |
| Lengua (8 huesos) | 1-11° | 0,14 m | Se mueve con la boca: se mantiene |
| `Eye.L` / `Eye.R` | 91° | — | Giran (parpadeo o mirada): se mantienen |
| `Fin.*` / `.001` / `.004` / `.005` | 22° / 28° / 7° / 7° | 0,05 m | |
| `Fin.*.002`, `Fin.*.003` | < 0,5° | — | Casi estáticos en los clips actuales; útiles para `pec_slap` (1.7) |
| `UpperFin`, `UpperFin.001` (dorsal) | 0° | — | Estáticos; se mantienen por si se animan |
| `MasterBone.006` … `Spine.007` | 10-24° | — | Ondulación del cuerpo |
| `Tail.*` / `.001` | 71° / 67° | — | Aleteo de la caudal |
| `Tail.*.002`-`.004` | 24-27° | — | |

Conclusión: **no se elimina ningún hueso.** 48 articulaciones (con `Root`) es poco para Three.js, y la lengua y los ojos sí se animan.

## Hueso `Root` (punto de anclaje)

| Dato | Valor |
|---|---|
| Posición | Centro de masas de la piel del LOD0 en reposo: (0, −1,255, 0,685) m en Blender, **(0, 0,685, 1,255) m en Three.js** |
| Método | Centroide de volumen (suma de tetraedros con el origen) de los triángulos de piel; el centroide de superficie da (0, −1,346, 0,517), parecido |
| Posición a lo largo del cuerpo | 39,5 % desde el morro |
| Orientación | Eje Y del hueso hacia el morro (+Z en Three.js); roll 0 |
| Deformante | No (no tiene pesos) |
| Hijos | `MasterBone` (el antiguo hueso raíz) |
| Propiedad | `anchor = "centro de masas (piel LOD0, reposo)"`, exportada en `extras` |

Por qué en el centro de masas: al saltar, una ballena gira alrededor de su centro de masas y este describe una parábola. Con el anclaje ahí, la trayectoria de la 1.7 (ascenso, arco balístico, giro de 90-180° y caída de espalda) se reduce a **mover y girar un solo hueso**, en Blender o por código en Three.js, sin tocar las animaciones horneadas del cuerpo.

**Por qué no cambia la animación:** las claves de pose de cada hueso son relativas a su propio reposo. Al insertar un padre en reposo sin moverlo, `MasterBone` conserva su reposo en el espacio del esqueleto. Verificado en 7 poses de los 7 clips: diferencia máxima de 0,013 mm.

**En el GLB** (re-exportado): 48 articulaciones en el skin, `Root` como primer nodo bajo `WhaleRig` y con `extras.anchor`. Tamaño: 18,9 MB.

## Ayudas añadidas al visor

- **Esqueleto:**
  - Líneas del esqueleto.
  - Articulaciones coloreadas por grupo (raíz, columna, cabeza, lengua, ojos, pectorales, dorsal, caudal), visibles a través del cuerpo.
  - Ejes locales de todos los huesos.
  - Nombres de los huesos, por grupo o todos, con los nombres originales de Blender.
  - Opacidad del cuerpo, para ver el esqueleto por dentro.
  - Hueso seleccionado resaltado con sus ejes y lectura de grupo, padre, posición en el mundo y rotación local.
- **Punto de anclaje:**
  - Hueso de anclaje: `Root` (centro de masas), `MasterBone` (raíz de la animación original), `Head` o `Spine.007`.
  - Marcador con ejes.
  - Estela de la trayectoria, con longitud ajustable y botón para borrarla.
  - Línea vertical hasta el nivel del agua.
  - Lectura de la posición y de la altura sobre el agua.
  - Cámara que lo sigue y botón para centrar la cámara en él.

Comprobado en el navegador con `JumpRight`: siguiendo `MasterBone`, el anclaje pasa de 1,04 m sobre el agua en reposo a **4,21 m en el ápice** (3,6 s) y vuelve a bajar. `Root` se queda en el centro de masas porque aún no tiene movimiento propio: eso llega en la 1.7.

## Archivos

| Archivo | Contenido |
|---|---|
| `_Blender\Claude modelo\Whale_opt.blend` | Rig con `Root` |
| `_Blender\Claude modelo\versiones\Whale_opt_f1_5.blend` | Entrada de la fase |
| `_Blender\Claude modelo\verificacion\rig_f1_6.json` | Informe: centro de masas, jerarquía, simetría, rangos de movimiento y pesos |
| `public/models/whale.glb` | Re-exportado con `Root` (sin versionar) |

## Cómo reproducir

```
set BL="C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
set M=D:\Trabajo\Proyectos_LEGION\26_903_Whale\_Blender\Claude modelo
%BL% --background "%M%\versiones\Whale_opt_f1_5.blend" --python _Blender\scripts\fase_1_6_rig.py -- "%M%\Whale_opt.blend" "%M%\verificacion\rig_f1_6.json"
%BL% --background "%M%\Whale_opt.blend" --python _Blender\scripts\export_glb.py -- "%M%\export\whale.glb"
```

Después, copiar `export\whale.glb` y `export\whale_wet_2k.png` a `public/models/`. Copia del script en [`scripts/fase_1_6/`](scripts/fase_1_6/).
