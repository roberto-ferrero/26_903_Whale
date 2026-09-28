import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  abs, cameraPosition, dot, float, max, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, uniform, vec3,
} from 'three/tsl';
import { directionFromAltAz, equatorialToWorld, moonIllumination, moonPosition, sunPosition, sunriseSunset } from './astro.js';

// lugares con ballenas jorobadas (temporadas de cría o alimentación)
export const PLACES = {
  "Tonga (Vava'u)": { lat: -18.65, lon: -173.98, tz: 13 },
  'Hawái (Maui)': { lat: 20.8, lon: -156.4, tz: -10 },
  'Australia (Hervey Bay)': { lat: -25.2, lon: 152.9, tz: 10 },
  'Rep. Dominicana (Samaná)': { lat: 19.2, lon: -69.3, tz: -4 },
  'Islandia (Húsavík)': { lat: 66.05, lon: -17.34, tz: 0 },
  'Canarias (Tenerife)': { lat: 28.1, lon: -16.7, tz: 1 },
  'Personalizado': null,
};

const DEG = Math.PI / 180;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * Transmitancia de la atmósfera para la luz del sol (color del sol en el suelo) según su altura:
 * masa de aire de Kasten-Young y extinción Rayleigh (∝ λ⁻⁴) + Mie (turbidez). Devuelve RGB lineal.
 */
export function sunTransmittance(altDeg, turbidity, out = new THREE.Color()) {
  const z = Math.min(90, 90 - altDeg);
  const airMass = 1 / (Math.cos(z * DEG) + 0.50572 * (96.07995 - z) ** -1.6364);
  const betaR = [5.8e-6, 13.5e-6, 33.1e-6];
  const betaM = 2.0e-5 * (turbidity / 2);
  const tau = betaR.map((b) => (b * 8000 + betaM * 1200) * Math.min(airMass, 40));
  return out.setRGB(Math.exp(-tau[0]), Math.exp(-tau[1]), Math.exp(-tau[2]));
}

/**
 * Cielo (Fases 3.1-3.3 y 3.5): fecha, hora y lugar → posición del sol y de la luna;
 * atmósfera Preetham (SkyMesh de Three.js para WebGPU); estrellas orientadas con el tiempo
 * sidéreo; luna con su fase; y la luz de la escena derivada del cielo (color y fuerza del sol,
 * luz de luna, luz ambiente, niebla y mapa de entorno PMREM regenerado al cambiar la hora).
 */
export function createSky(viewer, extraSkyObjects = []) {
  const { renderer, scene, camera, sun, hemi } = viewer;

  const state = {
    enabled: true,
    place: "Tonga (Vava'u)",
    lat: -18.65,
    lon: -173.98,
    tz: 13,
    date: '2026-09-28',
    hour: 10.5, // hora local decimal
    animate: false,
    timeSpeed: 120, // 120 = 2 min simulados por segundo
    turbidity: 2.5,
    rayleigh: 1.2,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    skyBrightness: 1,
    sunStrength: 3.2,
    ambientStrength: 0.55,
    moonStrength: 0.35,
    stars: 1,
    cloudLight: 1, // brillo de las nubes respecto al cielo
    fogDensity: 0.0012,
    // lecturas
    sunAltAz: '',
    moonInfo: '',
    sunTimes: '',
    localTime: '',
  };

  // ------------------------------------------------------------------ atmósfera
  const sky = new SkyMesh();
  sky.scale.setScalar(1000);
  sky.frustumCulled = false;
  sky.cloudCoverage.value = 0; // las nubes son volumétricas (clouds.js)
  const skyGain = uniform(1);
  sky.material.colorNode = sky.material.colorNode.mul(skyGain);
  sky.material.fog = false;
  scene.add(sky);

  // ------------------------------------------------------------------ estrellas (procedurales, en coordenadas ecuatoriales)
  const STARS = 6000;
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  const rnd = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < STARS; i++) {
    const zc = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - zc * zc);
    pos.set([r * Math.cos(a) * 900, r * Math.sin(a) * 900, zc * 900], i * 3);
    const mag = rnd() ** 6; // pocas brillantes, muchas débiles
    const temp = rnd();
    const c = temp < 0.2 ? [1, 0.8, 0.65] : temp > 0.85 ? [0.7, 0.8, 1] : [1, 1, 0.95];
    const b = 0.25 + mag * 4;
    col.set(c.map((x) => x * b), i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starUniform = uniform(1);
  const starMat = new THREE.PointsNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false });
  starMat.opacityNode = starUniform;
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.matrixAutoUpdate = false;
  stars.renderOrder = -1;
  scene.add(stars);

  // ------------------------------------------------------------------ luna (su fase sale de la luz del sol sobre la esfera)
  const moonSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const moonGain = uniform(1);
  const moonMat = new THREE.MeshBasicNodeMaterial({ fog: false, depthWrite: false, transparent: true });
  const maria = mx_noise_float(normalWorld.mul(3.0)).mul(0.5).add(0.5);
  const albedo = mix(float(0.55), float(0.85), smoothstep(0.35, 0.65, maria));
  const lit = max(dot(normalWorld, moonSunDir), 0.0);
  moonMat.colorNode = vec3(1.0, 0.98, 0.94).mul(albedo).mul(lit.add(0.015)).mul(moonGain).mul(3.0);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), moonMat);
  moon.frustumCulled = false;
  moon.renderOrder = -1;
  scene.add(moon);

  const moonLight = new THREE.DirectionalLight(0xbfd2ff, 0);
  scene.add(moonLight, moonLight.target);

  // ------------------------------------------------------------------ entorno (PMREM) desde un cielo propio
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new SkyMesh();
  envSky.scale.setScalar(1000);
  envSky.cloudCoverage.value = 0;
  const envGain = uniform(1);
  envSky.material.colorNode = envSky.material.colorNode.mul(envGain);
  envSky.showSunDisc.value = 0;
  envScene.add(envSky);
  for (const o of extraSkyObjects) envScene.add(o);
  let envRT = null;
  let lastEnvSun = new THREE.Vector3(0, -2, 0);
  let lastEnvTime = -1;
  const fallbackEnv = scene.environment;

  // ------------------------------------------------------------------ cálculo
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const sunColor = new THREE.Color();
  const tmpColor = new THREE.Color();
  const fogDay = new THREE.Color(0xb9c9d8);
  const fogNight = new THREE.Color(0x05080d);
  const fogSunset = new THREE.Color(0xd7a27c);
  let clockTime = 0;

  function currentDate() {
    const [y, m, d] = state.date.split('-').map(Number);
    const ms = Date.UTC(y, (m || 1) - 1, d || 1) + (state.hour - state.tz) * 3600000;
    return new Date(ms);
  }

  const info = { sunAlt: 0, sunAz: 0, moonAlt: 0, moonFraction: 0, dayFactor: 1 };
  // luz para las nubes: color del sol (transmitancia), su fuerza y el color ambiente del cielo
  const light = { dir: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(), sunIntensity: 0, ambient: new THREE.Color() };
  const moonTint = new THREE.Color(0.75, 0.82, 1.0);
  const ambientDay = new THREE.Color(0.42, 0.55, 0.75);
  const ambientNight = new THREE.Color(0.012, 0.016, 0.03);

  function update(simDt = 0) {
    if (state.animate && simDt > 0) {
      state.hour += (simDt * state.timeSpeed) / 3600;
      while (state.hour >= 24) {
        state.hour -= 24;
        const dt = new Date(`${state.date}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + 1);
        state.date = dt.toISOString().slice(0, 10);
      }
    }
    clockTime += simDt;
    const date = currentDate();
    const s = sunPosition(date, state.lat, state.lon);
    const m = moonPosition(date, state.lat, state.lon);
    const ill = moonIllumination(date);
    info.sunAlt = s.altitude; info.sunAz = s.azimuth; info.moonAlt = m.altitude; info.moonFraction = ill.fraction;
    directionFromAltAz(s.altitude, s.azimuth, sunDir);
    directionFromAltAz(m.altitude, m.azimuth, moonDir);

    // atmósfera
    for (const k of [sky, envSky]) {
      k.sunPosition.value.copy(sunDir);
      k.turbidity.value = state.turbidity;
      k.rayleigh.value = state.rayleigh;
      k.mieCoefficient.value = state.mieCoefficient;
      k.mieDirectionalG.value = state.mieDirectionalG;
    }
    skyGain.value = state.skyBrightness;
    envGain.value = state.skyBrightness;
    sky.position.copy(camera.position);

    // noche: estrellas y luna
    const night = 1 - smooth(-12, 0, s.altitude); // 1 = noche cerrada (sol < −12°)
    info.dayFactor = smooth(-6, 10, s.altitude);
    starUniform.value = state.stars * night;
    stars.matrix.makeTranslation(camera.position.x, camera.position.y, camera.position.z);
    const m3 = equatorialToWorld(date, state.lat, state.lon);
    const rot = new THREE.Matrix4().set(m3[0], m3[1], m3[2], 0, m3[3], m3[4], m3[5], 0, m3[6], m3[7], m3[8], 0, 0, 0, 0, 1);
    stars.matrix.multiply(rot);
    stars.matrixWorldNeedsUpdate = true;
    stars.visible = state.enabled && starUniform.value > 0.01;
    moon.position.copy(camera.position).addScaledVector(moonDir, 900);
    moon.scale.setScalar(900 * Math.tan(0.26 * DEG) * 1.6); // algo mayor que el real (0,52°) para que se lea
    moonSunDir.value.copy(sunDir);
    moonGain.value = 0.25 + 0.75 * night;
    moon.visible = state.enabled && m.altitude > -2;

    // luz del sol: color por transmitancia y fuerza por altura (se apaga bajo el horizonte)
    sunTransmittance(Math.max(s.altitude, -1), state.turbidity, sunColor);
    const sunUp = smooth(-1.5, 4, s.altitude);
    if (s.altitude > -4 || m.altitude < 0) {
      light.dir.copy(sunDir);
      light.sunColor.copy(sunColor);
      light.sunIntensity = state.cloudLight * sunUp;
    } else {
      // de noche la "luz directa" de las nubes es la luna (muy débil y azulada)
      light.dir.copy(moonDir);
      light.sunColor.copy(moonTint);
      light.sunIntensity = state.cloudLight * state.moonStrength * 0.12 * ill.fraction * smooth(-2, 15, m.altitude);
    }
    light.ambient.copy(ambientNight).lerp(ambientDay, info.dayFactor).multiplyScalar(state.cloudLight * 0.9)
      .lerp(tmpColor.copy(sunColor).multiplyScalar(0.5 * state.cloudLight), smooth(20, 0, s.altitude) * info.dayFactor * 0.5);
    if (state.enabled) {
      sun.color.copy(sunColor);
      sun.intensity = state.sunStrength * sunUp * (0.35 + 0.65 * smooth(0, 25, s.altitude));
      sun.position.copy(sunDir).multiplyScalar(60);
      // luz de luna
      moonDir.y = Math.max(moonDir.y, 0);
      moonLight.position.copy(moonDir).multiplyScalar(60);
      moonLight.intensity = state.moonStrength * ill.fraction * smooth(-2, 10, m.altitude) * night;
      // ambiente: hemisférica tintada por el cielo
      hemi.intensity = state.ambientStrength * (0.08 + 0.92 * info.dayFactor);
      hemi.color.setRGB(0.55 + 0.25 * sunColor.r, 0.65 + 0.2 * sunColor.g, 0.85 + 0.1 * sunColor.b);
      // niebla / perspectiva aérea: color del horizonte según la hora
      const sunset = smooth(25, 2, s.altitude) * smooth(-6, 2, s.altitude);
      tmpColor.copy(fogNight).lerp(fogDay, info.dayFactor).lerp(fogSunset, sunset * 0.6);
      scene.fog = scene.fog?.isFogExp2 ? scene.fog : new THREE.FogExp2(tmpColor, state.fogDensity);
      scene.fog.color.copy(tmpColor);
      scene.fog.density = state.fogDensity * (0.6 + 0.4 * state.turbidity / 3);
      scene.background = null;
      scene.environmentIntensity = 0.2 + 0.45 * info.dayFactor;
    }
    sky.visible = state.enabled;
    moonLight.visible = state.enabled;

    // entorno: se regenera si el sol se ha movido o cada cierto tiempo si hay animación
    if (state.enabled && (sunDir.angleTo(lastEnvSun) > 0.5 * DEG || (state.animate && clockTime - lastEnvTime > 2))) {
      envSky.position.set(0, 0, 0);
      const rt = pmrem.fromScene(envScene, 0, 0.1, 5000);
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
      lastEnvSun.copy(sunDir);
      lastEnvTime = clockTime;
    }

    // lecturas
    const hh = Math.floor(state.hour), mm = Math.floor((state.hour - hh) * 60);
    state.localTime = `${state.date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (UTC${state.tz >= 0 ? '+' : ''}${state.tz})`;
    state.sunAltAz = `alt ${s.altitude.toFixed(1)}° · az ${s.azimuth.toFixed(0)}°`;
    state.moonInfo = `${ill.name} ${(ill.fraction * 100).toFixed(0)} % · alt ${m.altitude.toFixed(0)}°`;
  }

  let lastDay = '';
  function updateSunTimes() {
    const key = `${state.date}|${state.lat}|${state.lon}|${state.tz}`;
    if (key === lastDay) return;
    lastDay = key;
    const [y, mo, d] = state.date.split('-').map(Number);
    const t = sunriseSunset(Date.UTC(y, mo - 1, d) - state.tz * 3600000, state.lat, state.lon);
    const fmt = (h) => (h === null ? '—' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`);
    state.sunTimes = `sale ${fmt(t.rise)} · se pone ${fmt(t.set)}`;
  }

  function apply() {
    const p = PLACES[state.place];
    if (p) { state.lat = p.lat; state.lon = p.lon; state.tz = p.tz; }
    if (!state.enabled) {
      scene.environment = fallbackEnv;
      moonLight.intensity = 0;
    } else {
      lastEnvSun.set(0, -2, 0); // fuerza regenerar el entorno
    }
    updateSunTimes();
    update(0);
  }

  return {
    state,
    info,
    light,
    sunDir,
    /** Fuerza regenerar el mapa de entorno (p. ej. tras cambiar las nubes). */
    invalidateEnv() { lastEnvSun.set(0, -2, 0); },
    places: Object.keys(PLACES),
    apply,
    update(simDt) {
      if (!state.enabled) return;
      updateSunTimes();
      update(simDt);
    },
    envScene,
  };
}
