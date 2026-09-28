# Fase 1.7 · Animaciones y secuencia del salto

28/09/2026 · Blender 5.1.1 (`fase_1_7_clips.py`) · Three.js (`src/whale/breach.js`)

## Resumen

- **Decisión (Roberto, 28/09/2026):** la **trayectoria del salto se define por código en Three.js**, moviendo y girando el hueso `Root` (centro de masas, Fase 1.6) con parámetros ajustables. Blender solo aporta la animación del **cuerpo**.
- **Clips nuevos**, horneados en Blender y añadidos a los 7 originales:
  - `swim_idle`: copia de `Swim1`.
  - `swim_fast`: `Swim2` 1,53 veces más rápido y con columna y caudal un 25 % más amplias.
  - `breach_body`: el cuerpo de `JumpRight` sin la subida ni el giro global de `MasterBone`, con los tiempos de sus eventos en `extras`.
- **Secuencia en el visor** (carpeta "Salto (secuencia)"): nado profundo → ascenso acelerando → arco balístico con giro sobre el eje → caída de espalda → inmersión → recuperación, en bucle o una sola vez.
- **Eventos:** `surface_exit` (la cabeza sale del agua), `apex` e `impact` (el centro de masas vuelve al agua).
- **Comprobado contra las referencias:** en el punto más alto, **entre el 72 % y el 79 % de la piel está fuera del agua**, según la velocidad de salida (objetivo: 60-80 %). El tiempo en el aire es de 1,65 s y la caída es de espalda.
- `dive` y `pec_slap` (opcionales en el plan) quedan pendientes.

## Clips (Blender)

`fase_1_7_clips.py` hornea pose a pose (24 fps) sobre la instantánea de la 1.6 y deja cada clip nuevo en su pista NLA:

| Clip | Origen | Duración | Qué cambia |
|---|---|---:|---|
| `swim_idle` | `Swim1_Anim` | 3,71 s (90 f) | Copia; bucle cerrado, sin desplazamiento |
| `swim_fast` | `Swim2_Anim` | 2,42 s (59 f) | Remuestreado 1,53 veces más rápido y rotaciones de 19 huesos (`Spine*`, `Tail*`, `MasterBone.006`) amplificadas ×1,25 respecto al reposo. Sigue siendo un bucle cerrado |
| `breach_body` | `JumpRight_Anim` | 5,96 s (144 f) | `MasterBone` fijo en reposo: sin la subida de hasta 3,2 m ni el giro de hasta 59° del original. Queda solo la flexión del cuerpo, las aletas y la boca |

- **Eventos de `breach_body`** (propiedad `events` de la acción, exportada a `extras` en glTF): `surface_exit` 2,625 s (f63), `apex` 3,625 s (f87) e `impact` 5,083 s (f122), estimados en la auditoría (1.1).
- **Pistas de `Root` en el GLB:** el exportador glTF muestrea todos los huesos, así que los clips traen pistas constantes para `Root`. `whale.js` las quita al cargar; si no, el mixer pisaría la trayectoria.

## Trayectoria (Three.js, `breach.js`)

Se mueve el centro de masas (`Root`) en el plano vertical YZ; la ballena mira hacia +Z. El salto cruza la superficie en z = 0.

| Fase | Duración (por defecto) | Posición del centro de masas | Orientación | Clip |
|---|---|---|---|---|
| Nado profundo | 3 s | Recta a 12 m de profundidad, 2 m/s | Horizontal | `swim_idle` |
| Ascenso | 4,5 s | Curva de Hermite desde el nado hasta la superficie, llegando a 8,5 m/s y 72° | Tangente a la curva | `swim_fast`; `breach_body` arranca 1,76 s antes de la salida |
| En el aire | 1,65 s (= 2·v·sen θ / g) | **Parábola balística** con g = 9,81 m/s²; ápice a 3,33 m sobre el agua, avance de 4,3 m | Inclinación de 72° → −8° y **giro de 160°** sobre el eje | `breach_body`, reescalado ×1,49 para que su salida e impacto coincidan con la parábola |
| Impacto e inmersión | 2,5 s | Hermite desde el impacto (misma velocidad) hasta 6 m bajo el agua | Inclinación −8° → −15°; mantiene el giro | `breach_body` hasta su final |
| Recuperación | 5 s | Hermite de vuelta a la profundidad de nado | Se endereza (giro → 0°, inclinación → 0°) | `swim_idle` (fundido de 1,5 s) |

- **Orientación:** `M = inclinación(X) · giro(Z)`. Se aplica sobre la orientación de reposo de `Root` en el espacio del mundo y se pasa al espacio de su padre. Como `Root` está en el centro de masas, los giros son alrededor de él.
- **Sincronía del cuerpo:** `ritmo = (impact − surface_exit) / tiempo en el aire` del clip. El clip empieza en `t_salida − surface_exit / ritmo` y se reproduce con `timeScale = ritmo`.
- **Cámara lenta:** la velocidad y la pausa de la carpeta Animación afectan a la vez a la trayectoria y a los clips.
- **Repetición:** al terminar el ciclo, la ballena vuelve bajo el agua al punto de partida (a 12 m de profundidad y 30 m antes de la salida).

### Parámetros (panel "Salto (secuencia)" → "Trayectoria")

| Parámetro | Por defecto | Rango |
|---|---:|---|
| Profundidad de nado | 12 m | 3-40 |
| Velocidad de nado | 2 m/s | 0,5-5 |
| Nado previo | 3 s | 0-15 |
| Duración del ascenso | 4,5 s | 1,5-12 |
| **Velocidad de salida** | **8,5 m/s** | 3-14 |
| **Ángulo de salida** | **72°** | 30-89 |
| **Giro sobre su eje** | **160°** | 0-270 |
| Sentido del giro | Derecha | Derecha / Izquierda |
| Inclinación al caer | −8° | −60-30 |
| Duración de la inmersión | 2,5 s | 0,8-6 |
| Profundidad tras el impacto | 6 m | 1-15 |
| Duración de la recuperación | 5 s | 1-15 |

Además: iniciar, detener y relanzar la secuencia, repetir, ver la trayectoria (curva con marcadores de salida, ápice e impacto) y una vista lateral del salto. Hay lecturas de fase, último evento, tiempo en el aire y altura máxima. Al iniciar se activa el plano de agua. En el panel de estadísticas aparecen la fase, el tiempo del ciclo y el último evento.

## Validación

Ciclo completo en el navegador, avanzado a mano a 1/30 s (el navegador integrado estaba oculto y limita los fotogramas):

| Comprobación | Resultado |
|---|---|
| Duración del ciclo | 16,65 s |
| Fases y clips | Nado (`swim_idle`) 0 s → Ascenso (`swim_fast`) 3,0 s → En el aire (`breach_body`) 7,53 s → Inmersión 9,17 s → Recuperación (`swim_idle`) 11,67 s |
| Eventos | `surface_exit` 7,27 s (la cabeza sale 0,26 s antes que el centro de masas) · `apex` 8,33 s · `impact` 9,17 s |
| Altura del centro de masas | Máx. 3,03 m (= 3,33 m sobre el agua a −0,30 m), igual que la teoría |
| Imagen | A 7,75 s sale casi vertical; en el ápice está girada, mostrando los surcos blancos y con las pectorales abiertas; a 9,0 s cae casi horizontal y de espalda |

Fracción de la piel fuera del agua en el ápice (vértices del LOD0 deformados sobre el nivel del agua), con ángulo de 72°:

| Velocidad de salida | Altura del centro de masas | Fuera del agua |
|---:|---:|---:|
| 6,5 m/s | 1,95 m | 72 % |
| 7,0 m/s | 2,26 m | 74 % |
| 7,5 m/s | 2,59 m | 76 % |
| 8,0 m/s | 2,95 m | 77 % |
| **8,5 m/s** (por defecto) | **3,33 m** | **79 %** |

Todas dentro del 60-80 % de las fotos de referencia. Valores publicados para jorobadas: salida a 7-9 m/s y 1,5-2 s en el aire.

## Archivos

| Archivo | Contenido |
|---|---|
| `_Blender\scripts\fase_1_7_clips.py` | Creación de `swim_idle`, `swim_fast` y `breach_body` |
| `_Blender\Claude modelo\Whale_opt.blend` | Con los 10 clips; entrada: `versiones\Whale_opt_f1_6.blend` |
| `_Blender\Claude modelo\verificacion\clips_f1_7.json` | Informe de los clips |
| `public/models/whale.glb` | Re-exportado (19,1 MB, 10 clips; sin versionar) |
| `src/whale/breach.js` | Trayectoria, sincronía de clips, eventos y vista previa |
| `src/whale/whale.js` | Quita las pistas de `Root`, lee los eventos de `extras`, LOD por distancia al centro de masas y opciones de reproducción por clip |

## Pendiente

- **`dive` y `pec_slap` (opcionales):** `dive` se puede hacer casi entero por trayectoria (inclinación abajo y caudal fuera) reutilizando `swim_fast`. `pec_slap` necesita un clip de pectoral nuevo en Blender.
- **Fase 5.7:** conectar los eventos (`breach.on(...)`) a salpicaduras y ondas.
- **Ajuste fino:** la curva de inclinación y giro en el aire y la transición a la recuperación, comparándolas con vídeos a cámara lenta (Fase 0.3, pendiente).
