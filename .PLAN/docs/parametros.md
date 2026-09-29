# Referencia de parámetros

Generado desde la GUI el 2026-09-29 (`npm run dev` → `window.whaleViewer.gui`). Valores por defecto del perfil de calidad **Alto**.

Todos los parámetros ajustables (menos los de lectura y los botones) se guardan en los **presets** (JSON) y en la **URL** como `#modulo.clave=valor` (ver la tabla de claves al final).

## Calidad

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Perfil | lista | Alto | Bajo / Medio / Alto / Ultra / Automático | `profile` |
| Nivel activo *(lectura)* | texto | Alto |  | `active` |
| Tiempo por fotograma *(lectura)* | texto |  |  | `frameMs` |

## Secuencia

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| ▶ Reproducir secuencia (P) | botón |  |  | `toggle` |
| Saltar ahora | botón |  |  | `jump` |
| Respirar ahora | botón |  |  | `breathe` |
| Fase *(lectura)* | texto | — |  | `phase` |
| Progreso *(lectura)* | texto |  |  | `progress` |
| Repetir | sí/no | sí |  | `loop` |
| Cámaras automáticas | sí/no | sí |  | `autoCamera` |
| Nado profundo (s) | número | 8 | 2 – 60 | `deepTime` |
| Profundidad (m) | número | 14 | 6 – 40 | `deepDepth` |
| Nado entre respiraciones (s) | número | 6 | 2 – 60 | `swimTime` |
| Profundidad entre respiraciones (m) | número | 6 | 2 – 30 | `swimDepth` |
| Ondas y espuma (s) | número | 7 | 2 – 60 | `surfaceTime` |
| Nado en superficie (m) | número | 3 | 1 – 10 | `surfaceDepth` |

## Grabar vídeo

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| ● Grabar (WebM) | botón |  |  | `toggle` |
| Estado *(lectura)* | texto | listo |  | `status` |
| Fotogramas/s | lista | 60 | 30 / 60 | `fps` |
| Calidad (Mbit/s) | número | 40 | 5 – 120 | `bitrate` |

## Audio

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Sonido (clic para activar) | sí/no | no |  | `enabled` |
| Volumen | número | 0.6 | 0 – 1 | `volume` |
| Oleaje | número | 1 | 0 – 2 | `ocean` |
| Salto e impacto | número | 1 | 0 – 2 | `effects` |
| Canto de ballena (bajo el agua) | número | 0.6 | 0 – 2 | `song` |

## Tiempo

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Pausa (espacio) | sí/no | no |  | `paused` |
| Velocidad (cámara lenta < 1) | número | 1 | 0 – 3 | `timeScale` |
| Avanzar un fotograma (.) | botón |  |  | `step` |
| Paso (s) | número | 0.0333 | 0.0083 – 0.2 | `stepSize` |
| Tiempo simulado (s) *(lectura)* | número | 0 |  | `time` |

## Ballena · comportamiento

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Máquina de estados | sí/no | sí |  | `enabled` |
| ▲ Saltar ahora (J) | botón |  |  | `jump` |
| ● Respirar ahora (B) | botón |  |  | `breathe` |
| Salto automático | sí/no | sí |  | `autoJump` |
| Respiración automática | sí/no | sí |  | `autoBreath` |
| Nadar entre acciones (s) | número | 6 | 1 – 60 | `autoInterval` |
| Transición entre planes (s) | número | 1 | 0 – 3 | `blendTime` |
| Estado *(lectura)* | texto | Nadar |  | `label` |
| Último evento *(lectura)* | texto | — |  | `lastEvent` |
| Tiempo en el aire *(lectura)* | texto |  |  | `airTime` |
| Altura máxima *(lectura)* | texto |  |  | `apexHeight` |
| Ver trayectoria del salto | sí/no | sí |  | `showPath` |

## Ballena · comportamiento › Nado

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Profundidad (m) | número | 12 | 3 – 40 | `depth` |
| Velocidad (m/s) | número | 2 | 0.5 – 5 | `swimSpeed` |
| Deriva del rumbo (rad/s) | número | 0.12 | 0 – 0.5 | `wander` |
| Radio de vuelta al centro (m) | número | 45 | 10 – 200 | `radius` |

## Ballena · comportamiento › Salto (próximo)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Duración ascenso (s) | número | 4.5 | 1.5 – 12 | `ascentTime` |
| Velocidad de salida (m/s) | número | 8.5 | 3 – 14 | `exitSpeed` |
| Ángulo de salida (°) | número | 72 | 30 – 89 | `exitAngle` |
| Giro sobre su eje (°) | número | 160 | 0 – 270 | `roll` |
| Sentido del giro | lista | Derecha | Derecha / Izquierda | `rollSide` |
| Inclinación al caer (°) | número | -8 | -60 – 30 | `landingPitch` |
| Duración inmersión (s) | número | 2.5 | 0.8 – 6 | `submergeTime` |
| Profundidad tras impacto (m) | número | 6 | 1 – 15 | `submergeDepth` |
| Duración recuperación (s) | número | 5 | 1 – 15 | `recoverTime` |

## Ballena · comportamiento › Respiración (próxima)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Inclinación al subir (°) | número | 28 | 10 – 60 | `breathAngle` |
| Tiempo en superficie (s) | número | 4.5 | 1.5 – 12 | `breathSurfaceTime` |
| Hundimiento al respirar (m) | número | 0.7 | 0 – 2 | `breathRootDepth` |
| Inclinación al bajar (°) | número | 25 | 8 – 45 | `breathDiveAngle` |
| Altura del soplido (m) | número | 4 | 1 – 9 | `blowHeight` |
| Cantidad de soplido | número | 1 | 0 – 3 | `blowAmount` |
| Aleteo junto a la superficie | número | 0.25 | 0.1 – 1 | `surfaceStroke` |

## Animación (modo libre)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Clip | lista | swim_idle | breach_body / Idle / JumpLeft / JumpRight / JumpStraight / MouthOpen / Swim1 / Swim2 / swim_fast / swim_idle | `clip` |
| Bucle | sí/no | sí |  | `loop` |
| Fundido (s) | número | 0.6 | 0 – 2 | `fade` |
| Tiempo del clip (s) | número | 0 | 0 – 3.7333 | `time` |
| Pose de reposo | botón |  |  | `rest` |

## Cámara

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Modo (C) | lista | Seguimiento | Órbita libre / Seguimiento / Cinemática | `mode` |
| Plano cinemático | lista | Director (cortes) | Director (cortes) / Barco / Aérea / Ras de agua / Bajo el agua / Hacia la luz (desde abajo) / Cruce de superficie / Soplido (cerca) | `rail` |
| Plano actual *(lectura)* | texto |  |  | `shot` |
| Transición (s) | número | 1.5 | 0 – 5 | `transition` |
| Director: cortes secos | sí/no | no |  | `hardCuts` |
| Suavizado seguimiento | número | 4 | 0.5 – 15 | `followSmoothing` |
| Velocidad de los raíles | número | 1 | 0 – 4 | `railSpeed` |
| Campo de visión (°) | número | 40 | 10 – 90 | `fov` |
| Girar sola (órbita) | sí/no | no |  | `autoRotate` |
| Velocidad de giro | número | 1 | 0.1 – 10 | `rotateSpeed` |

## Cámara › Vistas (órbita)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Tres cuartos | botón |  |  | `Tres cuartos` |
| Lateral | botón |  |  | `Lateral` |
| Frontal | botón |  |  | `Frontal` |
| Superior | botón |  |  | `Superior` |
| Inferior | botón |  |  | `Inferior` |
| Cabeza | botón |  |  | `Cabeza` |
| Cola | botón |  |  | `Cola` |

## Modelo

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| LOD | lista | Auto | Auto / LOD0 / LOD1 / LOD2 | `mode` |
| Distancia LOD1 (m) | número | 40 | 5 – 200 | `dist1` |
| Distancia LOD2 (m) | número | 120 | 10 – 500 | `dist2` |
| Mojado | número | 0 | 0 – 1 | `wetness` |
| Oscurecer al mojar | número | 0.12 | 0 – 0.4 | `wetDarken` |
| Normal map | sí/no | sí |  | `normalMap` |
| Intensidad normal | número | 1 | 0 – 3 | `normalScale` |
| Intensidad AO | número | 1 | 0 – 2 | `aoIntensity` |
| Alambre | sí/no | no |  | `wireframe` |
| Pelos (barbs) | sí/no | sí |  | `barbs` |

## Cielo · fecha, hora y lugar

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Cielo físico | sí/no | sí |  | `enabled` |
| Lugar | lista | Tonga (Vava'u) | Tonga (Vava'u) / Hawái (Maui) / Australia (Hervey Bay) / Rep. Dominicana (Samaná) / Islandia (Húsavík) / Canarias (Tenerife) / Personalizado | `place` |
| Latitud (°) | número | -18.65 | -90 – 90 | `lat` |
| Longitud (°) | número | -173.98 | -180 – 180 | `lon` |
| Zona horaria (UTC±h) | número | 13 | -12 – 14 | `tz` |
| Fecha (AAAA-MM-DD) | texto | 2026-09-28 |  | `date` |
| Hora local | número | 10.5 | 0 – 23.99 | `hour` |
| Avanzar la hora | sí/no | no |  | `animate` |
| Velocidad (× tiempo real) | número | 120 | 1 – 3600 | `timeSpeed` |
| Fecha y hora *(lectura)* | texto | 2026-09-28 10:30 (UTC+13) |  | `localTime` |
| Sol *(lectura)* | texto | alt 56.7° · az 63° |  | `sunAltAz` |
| Salida / puesta *(lectura)* | texto | sale 06:21 · se pone 18:33 |  | `sunTimes` |
| Luna *(lectura)* | texto | Luna llena 98 % · alt -50° |  | `moonInfo` |

## Cielo · atmósfera y luz

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Modelo de cielo | lista | Físico (Hillaire) | Físico (Hillaire) / Preetham | `model` |
| Turbidez (bruma) | número | 2.5 | 1 – 20 | `turbidity` |
| Ozono (solo físico) | número | 1 | 0 – 3 | `ozone` |
| Dispersión múltiple (físico) | número | 1 | 0 – 3 | `multiScattering` |
| Rayleigh (azul) | número | 1.2 | 0 – 4 | `rayleigh` |
| Mie (halo) | número | 0.005 | 0 – 0.1 | `mieCoefficient` |
| Mie · direccionalidad | número | 0.8 | 0 – 0.999 | `mieDirectionalG` |
| Brillo del cielo | número | 1 | 0.1 – 4 | `skyBrightness` |
| Fuerza del sol | número | 3.2 | 0 – 10 | `sunStrength` |
| Luz ambiente | número | 0.55 | 0 – 3 | `ambientStrength` |
| Luz de luna | número | 0.35 | 0 – 2 | `moonStrength` |
| Estrellas | número | 1 | 0 – 3 | `stars` |
| Brillo de las nubes | número | 1 | 0.1 – 4 | `cloudLight` |
| Bruma (perspectiva aérea) | número | 0.0012 | 0 – 0.02 | `fogDensity` |

## Nubes volumétricas

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Nubes | sí/no | sí |  | `enabled` |
| Cobertura | número | 0.45 | 0 – 1 | `coverage` |
| Densidad | número | 0.02 | 0.002 – 0.15 | `density` |
| Tipo (cúmulo - estrato) | número | 0.15 | 0 – 1 | `type` |
| Altitud de la base (m) | número | 1500 | 200 – 6000 | `base` |
| Grosor (m) | número | 1400 | 100 – 4000 | `thickness` |
| Tamaño de las formaciones | número | 1 | 0.2 – 4 | `scale` |
| Viento (m/s) | número | 12 | 0 – 60 | `windSpeed` |
| Viento hacia (° desde N) | número | 60 | 0 – 360 | `windDirection` |
| Sombras sobre el mar | número | 0.75 | 0 – 1 | `shadows` |
| Resolución (fracción) | número | 0.5 | 0.25 – 1 | `resolution` |
| Acumulación temporal | sí/no | sí |  | `temporal` |
| Calidad (pasos) | número | 40 | 8 – 128 | `steps` |
| Pasos de luz | número | 4 | 1 – 12 | `lightSteps` |
| Distancia máx. (m) | número | 30000 | 2000 – 80000 | `maxDistance` |

## Océano

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Océano | sí/no | sí |  | `enabled` |
| Olas | lista | FFT | FFT / Gerstner | `mode` |
| Estado del mar *(lectura)* | texto | Hs 2.10 m (viento 1.76 m, Tp 6.4 s, λp 64 m) |  | `info` |
| Nivel (m) | número | -0.3 | -3 – 3 | `level` |
| Crestas afiladas (choppy) | número | 1.1 | 0 – 2 | `choppiness` |
| Boyas de prueba (altura en CPU) | sí/no | no |  | `buoys` |

## Océano › FFT · mar de viento

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Viento (m/s) | número | 9 | 0 – 30 | `windSpeed` |
| Viento hacia (° desde N) | número | 60 | 0 – 360 | `windDirection` |
| Fetch (km) | número | 120 | 1 – 1000 | `fetch` |
| Alineación con el viento | número | 1 | 0.1 – 4 | `windAlign` |
| Corte de ondas cortas (m) | número | 0.02 | 0 – 0.2 | `shortWaveCut` |
| Semilla | número | 1 | 1 – 100 | `seed` |

## Océano › FFT · mar de fondo (swell)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Altura significativa (m) | número | 1.2 | 0 – 6 | `swellHeight` |
| Periodo (s) | número | 11 | 4 – 20 | `swellPeriod` |
| Hacia (° desde N) | número | 20 | 0 – 360 | `swellDirection` |
| Concentración (s) | número | 24 | 1 – 100 | `swellSpread` |

## Océano › Gerstner (prototipo)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Amplitud (m) | número | 0.5 | 0 – 3 | `gAmplitude` |
| Longitud de onda (m) | número | 45 | 2 – 200 | `gWavelength` |
| Dirección (° desde N) | número | 60 | 0 – 360 | `gDirection` |
| Dispersión (°) | número | 35 | 0 – 90 | `gSpread` |
| Afilado | número | 0.6 | 0 – 1 | `gSteepness` |

## Océano › Aspecto

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Tipo de agua | lista | Océano abierto | Océano abierto / Tropical clara / Costera verde | `waterType` |
| Color del agua (dispersión) | color | #06303c |  | `scatterColor` |
| Claridad (m) | número | 14 | 1 – 60 | `clarity` |
| Luz a través de las crestas | número | 1 | 0 – 4 | `sss` |
| Rugosidad | número | 0.04 | 0.01 – 0.4 | `roughness` |
| Reflejo del cielo | número | 1 | 0 – 2 | `reflections` |
| Espuma | número | 1 | 0 – 3 | `foam` |
| Umbral de espuma (jacobiano) | número | 0.82 | 0 – 1.2 | `foamJacobian` |
| Disipación de la espuma (1/s) | número | 0.8 | 0.05 – 5 | `foamDecay` |
| Visibilidad horizontal (km) | número | 18 | 1 – 80 | `haze` |
| Refracción (ver bajo el agua) | sí/no | sí |  | `refraction` |

## Ballena ↔ agua

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Interacción | sí/no | sí |  | `enabled` |
| Estado *(lectura)* | texto |  |  | `info` |
| Salpicaduras | sí/no | sí |  | `splashes` |
| Cantidad de agua | número | 1 | 0 – 3 | `density` |
| Tamaño de las gotas | número | 1 | 0.3 – 3 | `sizeScale` |
| Brillo de las gotas | número | 1 | 0.2 – 3 | `brightness` |
| Cortinas (agua del cuerpo) | número | 1 | 0 – 3 | `curtains` |
| Burbujas | número | 1 | 0 – 3 | `bubbles` |
| Fuerza de las ondas | número | 1 | 0 – 3 | `waves` |
| Velocidad de las ondas (m/s) | número | 4.5 | 1 – 10 | `rippleSpeed` |
| Estela | número | 1 | 0 – 3 | `wake` |
| Duración de la espuma (s) | número | 25 | 2 – 90 | `foamLife` |
| Piel mojada automática | sí/no | sí |  | `dynamicWet` |
| Ver sondas | sí/no | no |  | `showProbes` |

## Posprocesado

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Posprocesado | sí/no | sí |  | `enabled` |
| Antialiasing | lista | TAA | TAA / FXAA / Ninguno | `aa` |
| Bloom | sí/no | sí |  | `bloom` |
| Bloom: intensidad | número | 0.12 | 0 – 2 | `bloomStrength` |
| Bloom: umbral | número | 1.4 | 0 – 4 | `bloomThreshold` |
| Bloom: radio | número | 0.25 | 0 – 1 | `bloomRadius` |
| Profundidad de campo | sí/no | no |  | `dof` |
| Enfoque en la ballena | sí/no | sí |  | `autoFocus` |
| Distancia de enfoque (m) | número | 30 | 1 – 200 | `focusDistance` |
| Zona enfocada (m) | número | 25 | 1 – 150 | `focalRange` |
| Bokeh | número | 1.5 | 0 – 5 | `bokeh` |
| Motion blur | sí/no | sí |  | `motionBlur` |
| Motion blur: obturador | número | 0.35 | 0 – 2 | `motionBlurAmount` |
| Exposición (EV) | número | 0 | -3 – 3 | `exposure` |
| Contraste | número | 1.05 | 0.5 – 1.6 | `contrast` |
| Saturación | número | 1.05 | 0 – 2 | `saturation` |
| Temperatura (frío - cálido) | número | 0 | -1 – 1 | `temperature` |
| Viñeta | número | 0.15 | 0 – 1 | `vignette` |
| Grano | número | 0.04 | 0 – 0.4 | `grain` |

## Peces

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Peces | sí/no | sí |  | `enabled` |
| Estado *(lectura)* | texto |  |  | `info` |
| Peces en el cardumen | número | 500 | 0 – 1200 | `schoolCount` |
| Tamaño (m) | número | 0.14 | 0.08 – 0.5 | `schoolSize` |
| Velocidad (m/s) | número | 0.8 | 0.3 – 4 | `schoolSpeed` |
| Profundidad mínima (m) | número | 4 | 2 – 25 | `schoolDepth` |
| Distancia a la cámara (m) | número | 15 | 4 – 30 | `schoolDistance` |
| Separación | número | 3.05 | 0 – 4 | `separation` |
| Alineación | número | 3.35 | 0 – 4 | `alignment` |
| Cohesión | número | 3.4 | 0 – 4 | `cohesion` |
| Huida de la ballena | número | 1 | 0 – 4 | `flee` |

## Bajo el agua

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Efectos bajo el agua | sí/no | sí |  | `enabled` |
| Cámara *(lectura)* | texto |  |  | `info` |
| God rays | número | 3.2 | 0 – 8 | `godRays` |
| Pasos (god rays) | número | 16 | 2 – 48 | `steps` |
| Las nubes apagan los haces | número | 0.5 | 0 – 1 | `rayClouds` |
| Turbidez (dispersión) | número | 1 | 0 – 4 | `scattering` |
| Cáusticas (ballena y partículas) | número | 0.3 | 0 – 3 | `caustics` |
| Nitidez de las cáusticas | número | 0.75 | 0 – 1 | `causticSharpness` |
| Brillo de la superficie (desde abajo) | número | 0.5 | 0 – 3 | `surfaceCaustics` |
| Partículas en suspensión | número | 1 | 0 – 3 | `snow` |
| Distorsión | número | 1 | 0 – 4 | `distortion` |
| Aberración cromática | número | 1 | 0 – 4 | `chroma` |
| Desenfoque lejano | número | 1 | 0 – 4 | `blur` |
| Viñeta | número | 0.35 | 0 – 1 | `vignette` |
| Gotas en la lente al salir | sí/no | sí |  | `lensDrops` |

## Iluminación (sin cielo: manual)

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Tone mapping | lista | AgX | AgX / ACES / Neutral / Reinhard / Ninguno | `toneMapping` |
| Exposición | número | 1 | 0.1 – 3 | `exposure` |
| Luz de entorno | número | 0.6 | 0 – 2 | `environment` |
| Sol · intensidad | número | 2.5 | 0 – 8 | `sunIntensity` |
| Sol · color | color | #fff4e5 |  | `sunColor` |
| Sol · elevación (°) | número | 45 | -10 – 90 | `sunElevation` |
| Sol · azimut (°) | número | 35 | -180 – 180 | `sunAzimuth` |
| Hemisférica | número | 0.6 | 0 – 3 | `hemiIntensity` |
| Fondo y niebla | color | #8e979f |  | `background` |
| Niebla | sí/no | sí |  | `fog` |
| Niebla desde (m) | número | 60 | 0 – 500 | `fogNear` |
| Niebla hasta (m) | número | 420 | 10 – 2000 | `fogFar` |

## Ayudas

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Plano de agua | sí/no | no |  | `water` |
| Nivel del agua (m) | número | -0.3 | -10 – 10 | `waterLevel` |
| Opacidad del agua | número | 0.9 | 0 – 1 | `waterOpacity` |
| Color del agua | color | #1c4a66 |  | `waterColor` |
| Rejilla (1 m) | sí/no | no |  | `grid` |
| Altura rejilla (m) | número | -30 | -60 – 5 | `gridHeight` |
| Ejes (3 m) | sí/no | no |  | `axes` |
| Caja envolvente | sí/no | no |  | `box` |
| Dirección del sol | sí/no | no |  | `sunHelper` |
| Persona 1,8 m (en el agua) | sí/no | sí |  | `human` |

## Esqueleto

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Líneas | sí/no | no |  | `lines` |
| Articulaciones | sí/no | no |  | `joints` |
| Tamaño articulación (m) | número | 0.07 | 0.02 – 0.3 | `jointSize` |
| Ejes de cada hueso | sí/no | no |  | `axes` |
| Tamaño de ejes (m) | número | 0.3 | 0.05 – 1 | `axesSize` |
| Nombres | lista | Ninguna | Ninguna / Todas / Raíz / Columna / Cabeza / Lengua / Ojos / Pectorales / Dorsal / Caudal | `labels` |
| Opacidad del cuerpo | número | 1 | 0.05 – 1 | `bodyOpacity` |

## Esqueleto › Hueso seleccionado

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Hueso | lista | Root | Root / MasterBone / Spine.003 / Spine.004 / Spine.005 / Head / UpperJaw / LowerJaw / Tongue / Tongue.002 / Tongue.001 / Tongue.003 / Tong… | `selected` |
| Resaltar | sí/no | sí |  | `showSelected` |
| Grupo *(lectura)* | texto |  |  | `group` |
| Padre *(lectura)* | texto |  |  | `parent` |
| Posición (mundo) *(lectura)* | texto |  |  | `worldPos` |
| Rotación local *(lectura)* | texto |  |  | `localRot` |

## Punto de anclaje

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Hueso de anclaje | lista | Root | Root / MasterBone / Head / Spine.007 | `bone` |
| Marcador y ejes | sí/no | sí |  | `marker` |
| Tamaño del marcador | número | 0.25 | 0.05 – 1 | `size` |
| Estela | sí/no | no |  | `trail` |
| Longitud estela (puntos) | número | 600 | 50 – 2000 | `trailLength` |
| Borrar estela | botón |  |  | `clear` |
| Línea al agua | sí/no | sí |  | `dropLine` |
| Posición *(lectura)* | texto |  |  | `position` |
| Altura sobre el agua *(lectura)* | texto |  |  | `heightOverWater` |

## Depuración

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Vista de buffer | lista | Final | Final / Albedo / Normales / Profundidad / Oclusión (AO) / Rugosidad | `view` |
| Rango profundidad (m) | número | 60 | 5 – 300 | `depthRange` |
| Línea de tiempo | sí/no | sí |  | `timeline` |
| Estadísticas | sí/no | sí |  | `visible` |

## Presets y URL

| Control | Tipo | Por defecto | Rango / opciones | Clave |
|---|---|---|---|---|
| Preset | lista | Escena gris (placeholder) | Escena gris (placeholder) / Mediodía despejado / Atardecer / Atardecer tormentoso / Salto a cámara lenta / Inspección del modelo / Noche … | `preset` |
| Descripción *(lectura)* | texto | Escena placeholder de la Fase 2: sin cielo físico, nubes … |  | `descripcion` |
| Aplicar preset | botón |  |  | `aplicar` |
| Guardar cambios en la URL | sí/no | sí |  | `autoURL` |
| Copiar enlace con los ajustes | botón |  |  | `copiar` |
| Exportar preset (JSON) | botón |  |  | `exportar` |
| Restablecer todo | botón |  |  | `restablecer` |

## Claves para la URL y los presets

Módulos y claves que se guardan (`#modulo.clave=valor`; en los presets: `{ "valores": { "modulo": { "clave": valor } } }`).

| Módulo | Claves |
|---|---|
| `tiempo` | `timeScale`, `stepSize` |
| `ballena` | `enabled`, `depth`, `swimSpeed`, `wander`, `radius`, `autoJump`, `autoBreath`, `autoInterval`, `blendTime`, `surfaceStroke`, `showPath`, `ascentTime`, `exitSpeed`, `exitAngle`, `roll`, `rollSide`, `landingPitch`, `submergeTime`, `submergeDepth`, `recoverTime`, `breathAngle`, `breathSurfaceTime`, `breathRootDepth`, `breathDiveAngle`, `blowHeight`, `blowAmount` |
| `camara` | `mode`, `rail`, `transition`, `hardCuts`, `followSmoothing`, `railSpeed`, `fov`, `autoRotate`, `rotateSpeed` |
| `luz` | `toneMapping`, `exposure`, `environment`, `sunIntensity`, `sunColor`, `sunElevation`, `sunAzimuth`, `hemiIntensity`, `background`, `fog`, `fogNear`, `fogFar` |
| `cielo` | `enabled`, `model`, `ozone`, `multiScattering`, `place`, `lat`, `lon`, `tz`, `date`, `hour`, `animate`, `timeSpeed`, `turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG`, `skyBrightness`, `sunStrength`, `ambientStrength`, `moonStrength`, `stars`, `cloudLight`, `fogDensity` |
| `nubes` | `enabled`, `coverage`, `density`, `base`, `thickness`, `type`, `windSpeed`, `windDirection`, `scale`, `steps`, `lightSteps`, `maxDistance`, `resolution`, `temporal`, `shadows` |
| `oceano` | `enabled`, `mode`, `waterType`, `level`, `windSpeed`, `windDirection`, `fetch`, `windAlign`, `swellHeight`, `swellPeriod`, `swellDirection`, `swellSpread`, `shortWaveCut`, `seed`, `choppiness`, `gAmplitude`, `gWavelength`, `gDirection`, `gSpread`, `gSteepness`, `scatterColor`, `clarity`, `sss`, `roughness`, `reflections`, `foam`, `foamJacobian`, `foamDecay`, `haze`, `refraction`, `buoys` |
| `agua` | `enabled`, `splashes`, `density`, `sizeScale`, `brightness`, `waves`, `rippleSpeed`, `foamLife`, `wake`, `curtains`, `bubbles`, `dynamicWet`, `showProbes` |
| `bajoagua` | `enabled`, `godRays`, `steps`, `scattering`, `caustics`, `causticSharpness`, `surfaceCaustics`, `rayClouds`, `distortion`, `chroma`, `blur`, `vignette`, `lensDrops`, `snow` |
| `calidad` | `profile` |
| `peces` | `enabled`, `schoolCount`, `schoolSize`, `schoolSpeed`, `separation`, `alignment`, `cohesion`, `flee`, `schoolDepth`, `schoolDistance` |
| `post` | `enabled`, `aa`, `bloom`, `bloomStrength`, `bloomRadius`, `bloomThreshold`, `dof`, `autoFocus`, `focusDistance`, `focalRange`, `bokeh`, `motionBlur`, `motionBlurAmount`, `exposure`, `contrast`, `saturation`, `temperature`, `vignette`, `grain` |
| `audio` | `volume`, `ocean`, `effects`, `song` |
| `secuencia` | `loop`, `deepTime`, `deepDepth`, `swimTime`, `swimDepth`, `surfaceTime`, `surfaceDepth`, `autoCamera` |
| `modelo` | `wetness`, `wetDarken`, `normalMap`, `normalScale`, `aoIntensity`, `wireframe`, `barbs` |
| `lod` | `mode`, `dist1`, `dist2` |
| `ayudas` | `grid`, `gridHeight`, `axes`, `box`, `water`, `waterLevel`, `waterOpacity`, `waterColor`, `sunHelper`, `human` |
| `debug` | `view`, `depthRange`, `timeline` |
