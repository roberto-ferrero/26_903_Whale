import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  abs, attribute, clamp, float, instancedBufferAttribute, max, mix, mrt, normalLocal, positionLocal, positionWorld, sin, smoothstep,
  uniform, vec3, vec4, output,
} from 'three/tsl';

/**
 * Peces (vida submarina): un cardumen de peces pequeños que nada como tal (boids: separación,
 * alineación y cohesión, con vecinos por rejilla espacial) y unos pocos peces sueltos que deambulan.
 * - Todo en CPU (funciona también en WebGL2) y dibujado con InstancedMesh.
 * - El cardumen huye de la ballena (sondas del cuerpo) y de la cámara, se queda entre la superficie
 *   y una profundidad máxima y gira alrededor de un punto que se desplaza despacio.
 * - Geometría procedural (sin modelos con licencia): cuerpo fusiforme con aleta caudal; el coletazo
 *   se hace en el vertex shader, con frecuencia según la velocidad de cada pez.
 * - La luz es la que llega a su profundidad, con cáusticas (Fase 6.5).
 */
export const FISH_DEFAULTS = {
  enabled: true,
  schoolCount: 500,
  schoolSize: 0.22, // m (longitud de cada pez)
  schoolSpeed: 1.4, // m/s de crucero
  separation: 1.5,
  alignment: 1,
  cohesion: 1,
  flee: 1,
  schoolDepth: 4, // m: profundidad mínima del centro del cardumen
  schoolDistance: 10, // m: distancia delante de la cámara
  loners: 0, // peces sueltos: desactivados de momento (29/09/2026)
  lonerSize: 0.7,
};

const MAX_SCHOOL = 1200;
const MAX_LONERS = 10;

/** Pez de longitud 2 (z de −1 cola a +1 cabeza), cuerpo fusiforme + aleta caudal + dorsal. */
function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 14, 10);
  body.rotateX(Math.PI / 2); // polos en ±z
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    // más grueso delante, afilado hacia la cola (pedúnculo)
    const taper = z > 0 ? 1 - 0.25 * z * z : Math.max(0.12, 1 - 0.9 * z * z);
    p.setX(i, p.getX(i) * 0.16 * taper);
    p.setY(i, p.getY(i) * 0.3 * taper);
    p.setZ(i, z * 0.85);
  }
  body.computeVertexNormals();
  // aleta caudal en V (dos triángulos verticales) y aleta dorsal
  const fin = (pts) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pts.length).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pts.length / 3) * 2).fill(0), 2));
    return g;
  };
  const tail = fin([0, 0, -0.8, 0, 0.42, -1.12, 0, 0.02, -0.95, 0, 0, -0.8, 0, -0.02, -0.95, 0, -0.42, -1.12]);
  const dorsal = fin([0, 0.26, 0.2, 0, 0.42, -0.1, 0, 0.2, -0.35]);
  const g = mergeGeometries([body.toNonIndexed(), tail, dorsal]);
  return g;
}

export function createFish({ scene, ocean, water, camera }) {
  const state = { ...FISH_DEFAULTS, info: '' };
  const time = uniform(0);
  const geo = fishGeometry();

  // ------------------------------------------------------------------ material (coletazo + contrasombreado)
  const makeMaterial = (paramsAttr, motionAttr, sideAttr, base, belly) => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide });
    const prm = instancedBufferAttribute(paramsAttr); // x fase, y frecuencia (Hz), z amplitud
    // ojo: en three, positionLocal ya lleva la matriz de la instancia cuando se evalúa positionNode;
    // la coordenada a lo largo del cuerpo sale del atributo original y el desplazamiento lateral se
    // aplica en el eje "costado" del pez (calculado en CPU con su orientación y escala)
    const raw = attribute('position', 'vec3');
    const z = raw.z;
    // la onda recorre el cuerpo de la cabeza a la cola; casi nada delante, mucho en la cola
    const bend = max(float(0.35).sub(z), 0).pow(2).mul(prm.z);
    const wag = sin(time.mul(prm.y).mul(6.2832).add(prm.x).sub(z.mul(2.5))).mul(bend);
    m.positionNode = positionLocal.add(instancedBufferAttribute(sideAttr).mul(wag));
    // lomo oscuro, vientre claro y una franja plateada
    const up = clamp(normalLocal.y.mul(0.5).add(0.5), 0, 1);
    const stripe = float(1).sub(smoothstep(0.0, 0.05, abs(raw.y.sub(0.02)))).mul(0.25);
    m.colorNode = mix(vec3(...belly), vec3(...base), smoothstep(0.35, 0.75, up)).add(stripe);
    // luz bajo el agua (absorción y cáusticas) y sin velocidad propia para el motion blur
    m.outputNode = output.mul(vec4(ocean.underLightNode(positionWorld), 1));
    // velocidad en pantalla = movimiento de la cámara + el del propio pez en este fotograma; con 0,
    // el TAA los convertía en rayas (los peces son tan finos que no puede descartar la historia)
    const motion = instancedBufferAttribute(motionAttr);
    m.mrtNode = mrt({ velocity: ocean.cameraVelocityNode(positionWorld, positionWorld.sub(motion)) });
    return m;
  };

  function makeGroup(max, base, belly) {
    const params = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    const motion = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // desplazamiento en el fotograma
    const side = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // eje lateral del pez × escala
    const mesh = new THREE.InstancedMesh(geo, makeMaterial(params, motion, side, base, belly), max);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    const pos = new Float32Array(max * 3), vel = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) params.setXYZ(i, Math.random() * 6.28, 3, 0.08);
    return { mesh, params, motion, side, pos, vel, max };
  }
  const school = makeGroup(MAX_SCHOOL, [0.2, 0.3, 0.38], [0.85, 0.88, 0.9]);
  const loners = makeGroup(MAX_LONERS, [0.18, 0.24, 0.2], [0.75, 0.72, 0.62]);
  const lonerTargets = new Float32Array(MAX_LONERS * 3);
  const lonerTimers = new Float32Array(MAX_LONERS);

  // centro del cardumen: gira despacio alrededor de la zona de la ballena
  const home = new THREE.Vector3();
  // corriente que arrastra al cardumen con el centro (la cámara acompaña a la ballena a 3-5 m/s,
  // más que lo que nadan los peces): nadan relativos a ese marco y así no se quedan atrás
  const prevHome = new THREE.Vector3(), drift = new THREE.Vector3(), ZERO = new THREE.Vector3();
  let homeAngle = 0;
  const whaleSmooth = new THREE.Vector3();
  const camFwd = new THREE.Vector3(), centerV = new THREE.Vector3();
  const schoolCenter = () => {
    const n = Math.min(state.schoolCount, MAX_SCHOOL) || 1;
    centerV.set(0, 0, 0);
    for (let i = 0; i < n; i += 8) centerV.x += school.pos[i * 3], centerV.y += school.pos[i * 3 + 1], centerV.z += school.pos[i * 3 + 2];
    return centerV.multiplyScalar(8 / n);
  };
  let whaleInit = false;
  const whalePts = [];
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const fwd = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), sideV = new THREE.Vector3();

  function spawn(g, n, center, spread, speed) {
    for (let i = 0; i < n; i++) {
      g.pos[i * 3] = center.x + (Math.random() - 0.5) * spread;
      g.pos[i * 3 + 1] = center.y + (Math.random() - 0.5) * spread * 0.4;
      g.pos[i * 3 + 2] = center.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * 6.28;
      g.vel[i * 3] = Math.cos(a) * speed; g.vel[i * 3 + 1] = 0; g.vel[i * 3 + 2] = Math.sin(a) * speed;
    }
  }

  let spawned = false;
  // rejilla espacial para los vecinos
  const CELL = 1.2;
  const OFFSETS = [[0, 0, 0]];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) OFFSETS.push([x, y, z]);
  const grid = new Map();
  const key = (x, y, z) => ((Math.floor(x / CELL) * 73856093) ^ (Math.floor(y / CELL) * 19349663) ^ (Math.floor(z / CELL) * 83492791));

  function updateSchool(dt, level) {
    const n = Math.min(state.schoolCount, MAX_SCHOOL);
    const { pos, vel } = school;
    for (const c of grid.values()) c.length = 0; // se reutilizan las listas
    for (let i = 0; i < n; i++) {
      const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let c = grid.get(k);
      if (!c) { c = []; grid.set(k, c); }
      c.push(i);
    }
    if (grid.size > 4096) grid.clear();
    const sepR = state.schoolSize * 2.2, alignR = 1.4;
    const vmax = state.schoolSpeed * 1.8, vmin = state.schoolSpeed * 0.5;
    const cam = camera.position;
    for (let i = 0; i < n; i++) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, cnt = 0;
      const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL), gz = Math.floor(pz / CELL);
      // como los peces reales, cada uno atiende a unos pocos vecinos (topológico): se corta a los 10
      // primeros; sin esto, con el cardumen apretado el coste es O(n²) (7,5 ms con 500 peces)
      // se empieza por la celda propia (la más cercana)
      neigh: for (const [ox, oy, oz] of OFFSETS) {
        const c = grid.get(((gx + ox) * 73856093) ^ ((gy + oy) * 19349663) ^ ((gz + oz) * 83492791));
        if (!c) continue;
        for (const j of c) {
          if (j === i) continue;
          const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > alignR * alignR) continue;
          const d = Math.sqrt(d2) + 1e-4;
          if (d < sepR) { const w = (sepR - d) / sepR / d; sx -= dx * w; sy -= dy * w; sz -= dz * w; }
          ax += vel[j * 3]; ay += vel[j * 3 + 1]; az += vel[j * 3 + 2];
          cx += dx; cy += dy; cz += dz; cnt++;
          if (cnt >= 10) break neigh;
        }
      }
      let fx = sx * 4 * state.separation, fy = sy * 4 * state.separation, fz = sz * 4 * state.separation;
      if (cnt) {
        fx += (ax / cnt - vel[i * 3]) * 1.2 * state.alignment + (cx / cnt) * 1.3 * state.cohesion;
        fy += (ay / cnt - vel[i * 3 + 1]) * 1.2 * state.alignment + (cy / cnt) * 1.3 * state.cohesion;
        fz += (az / cnt - vel[i * 3 + 2]) * 1.2 * state.alignment + (cz / cnt) * 1.3 * state.cohesion;
      }
      // hacia el centro del cardumen (más fuerte cuanto más lejos)
      const hx = home.x - px, hy = home.y - py, hz = home.z - pz;
      const hd = Math.sqrt(hx * hx + hy * hy + hz * hz) + 1e-3;
      const pull = Math.min(hd / 5, 4) * 1.2; // más fuerte que antes: si no, se quedaba atrás
      fx += hx / hd * pull; fy += hy / hd * pull; fz += hz / hd * pull;
      // bandas de profundidad: ni en la superficie ni demasiado hondo
      if (py > level - 1.2) fy -= (py - (level - 1.2)) * 4;
      if (py < level - 25) fy += 2;
      // huida de la ballena (sondas del cuerpo) y, un poco, de la cámara
      for (const w of whalePts) {
        const dx = px - w.x, dy = py - w.y, dz = pz - w.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
        const r = w.r + 6;
        if (d < r) { const k2 = (r - d) / r * 14 * state.flee / d; fx += dx * k2; fy += dy * k2; fz += dz * k2; }
      }
      {
        const dx = px - cam.x, dy = py - cam.y, dz = pz - cam.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
        if (d < 2.5) { const k2 = (2.5 - d) * 3 / d; fx += dx * k2; fy += dy * k2; fz += dz * k2; }
      }
      let vx = vel[i * 3] + fx * dt, vy = vel[i * 3 + 1] + fy * dt, vz = vel[i * 3 + 2] + fz * dt;
      vy *= 0.97; // nadan más en horizontal
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-5;
      // lejos del centro nadan más deprisa para alcanzarlo (hasta ×2)
      const boost = 1 + Math.min(Math.max((hd - 5) / 6, 0), 2); // hasta ×3
      const target = Math.min(Math.max(sp, vmin), vmax * boost);
      vx *= target / sp; vy *= target / sp; vz *= target / sp;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      pos[i * 3] = px + vx * dt + drift.x; pos[i * 3 + 1] = py + vy * dt + drift.y; pos[i * 3 + 2] = pz + vz * dt + drift.z;
    }
    return n;
  }

  function updateLoners(dt, level) {
    const n = 0; // peces sueltos desactivados de momento (se conserva el código para recuperarlos)
    const { pos, vel } = loners;
    for (let i = 0; i < n; i++) {
      lonerTimers[i] -= dt;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      if (lonerTimers[i] <= 0 || Math.sqrt((lonerTargets[i * 3] - px) * (lonerTargets[i * 3] - px) + (lonerTargets[i * 3 + 2] - pz) * (lonerTargets[i * 3 + 2] - pz)) < 1.5) {
        // nuevo destino cerca del cardumen, a otra profundidad
        lonerTargets[i * 3] = home.x + (Math.random() - 0.5) * 50;
        lonerTargets[i * 3 + 1] = level - 3 - Math.random() * 14;
        lonerTargets[i * 3 + 2] = home.z + (Math.random() - 0.5) * 50;
        lonerTimers[i] = 6 + Math.random() * 10;
      }
      const tx = lonerTargets[i * 3] - px, ty = lonerTargets[i * 3 + 1] - py, tz = lonerTargets[i * 3 + 2] - pz;
      const td = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1e-3;
      const speed = 0.8;
      let vx = vel[i * 3] + (tx / td * speed - vel[i * 3]) * dt * 0.6;
      let vy = vel[i * 3 + 1] + (ty / td * speed * 0.4 - vel[i * 3 + 1]) * dt * 0.6;
      let vz = vel[i * 3 + 2] + (tz / td * speed - vel[i * 3 + 2]) * dt * 0.6;
      for (const w of whalePts) {
        const dx = px - w.x, dy = py - w.y, dz = pz - w.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
        if (d < w.r + 5) { const k2 = 3 * state.flee * dt / d; vx += dx * k2; vy += dy * k2; vz += dz * k2; }
      }
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      pos[i * 3] = px + vx * dt; pos[i * 3 + 1] = Math.min(py + vy * dt, level - 1); pos[i * 3 + 2] = pz + vz * dt;
    }
    return n;
  }

  function writeInstances(g, n, size, wagScale, dt) {
    for (let i = 0; i < n; i++) {
      tmpP.set(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      // orientación y coletazo según la velocidad en el mundo (la propia más el arrastre)
      const dr = g === school ? drift : ZERO, idt = dt > 0 ? 1 / dt : 0;
      dir.set(g.vel[i * 3] + dr.x * idt, g.vel[i * 3 + 1] + dr.y * idt, g.vel[i * 3 + 2] + dr.z * idt);
      const sp = dir.length();
      if (sp > 1e-4) tmpQ.setFromUnitVectors(fwd, dir.multiplyScalar(1 / sp));
      const s = size * (0.85 + ((i * 7919) % 100) / 330); // tamaños algo distintos
      tmpS.set(s * 0.5, s * 0.5, s * 0.5); // la geometría mide 2 de largo
      tmpM.compose(tmpP, tmpQ, tmpS);
      g.mesh.setMatrixAt(i, tmpM);
      // coletazo: más rápido cuanto más rápido nada (en longitudes de cuerpo por segundo)
      g.params.setY(i, Math.min(1.2 + (sp / size) * 0.35, 9) * wagScale);
      g.params.setZ(i, 0.09);
      g.motion.setXYZ(i, g.vel[i * 3] * dt + dr.x, g.vel[i * 3 + 1] * dt + dr.y, g.vel[i * 3 + 2] * dt + dr.z);
      sideV.set(tmpS.x, 0, 0).applyQuaternion(tmpQ);
      g.side.setXYZ(i, sideV.x, sideV.y, sideV.z);
    }
    g.mesh.count = n;
    g.mesh.instanceMatrix.needsUpdate = true;
    g.params.needsUpdate = true;
    g.motion.needsUpdate = true;
    g.side.needsUpdate = true;
  }

  function apply() {
    school.mesh.visible = loners.mesh.visible = state.enabled;
    spawned = false; // reparte de nuevo
  }

  return {
    state,
    apply,
    update(dt) {
      if (!state.enabled) return;
      const level = ocean.state.level;
      if (dt <= 0) return;
      dt = Math.min(dt, 0.05);
      time.value += dt;
      // centro del cardumen: órbita lenta de 25 m de radio alrededor del origen de la ballena
      // centro del cardumen: acompaña a la ballena a ~12 m, girando despacio a su alrededor (así suele
      // estar en cuadro con la cámara de seguimiento); se suaviza para que un salto no lo arrastre
      const wp = water.probes[4]?.pos;
      if (wp) {
        if (!whaleInit) { whaleSmooth.copy(wp); whaleInit = true; }
        whaleSmooth.lerp(wp, 1 - Math.exp(-dt / 3));
      }
      // delante de la cámara (a `schoolDistance` m, un poco a un lado y oscilando) para que se vea:
      // bajo el agua la visibilidad es de ~15 m y, acompañando a la ballena, quedaba a 20-30 m
      homeAngle += dt * 0.12;
      // sobre el eje de visión (con su inclinación), desplazado a un lado en horizontal
      camera.getWorldDirection(camFwd);
      const hx = camFwd.x, hz = camFwd.z, hl = Math.hypot(hx, hz) || 1;
      const sideOff = 3 * Math.sin(homeAngle);
      const target = tmpP.set(
        camera.position.x + camFwd.x * state.schoolDistance - (hz / hl) * sideOff,
        Math.min(Math.max(camera.position.y + camFwd.y * state.schoolDistance, level - 25), level - state.schoolDepth),
        camera.position.z + camFwd.z * state.schoolDistance + (hx / hl) * sideOff,
      );
      if (!spawned) home.copy(target); // aparece directamente delante de la cámara
      else home.lerp(target, 1 - Math.exp(-dt / 1.2));
      // tras un corte de plano el cardumen puede quedar muy lejos: reaparece cerca del nuevo centro
      if (spawned && schoolCenter().distanceTo(target) > 18) { home.copy(target); spawned = false; }
      if (!spawned) {
        spawn(school, MAX_SCHOOL, home, 8, state.schoolSpeed);
        spawn(loners, MAX_LONERS, home, 30, 0.8);
        for (let i = 0; i < MAX_LONERS; i++) { loners.pos[i * 3 + 1] = level - 4 - Math.random() * 10; lonerTimers[i] = 0; }
        spawned = true;
      }
      // puntos del cuerpo de la ballena (sondas de la Fase 5)
      whalePts.length = 0;
      for (const p of water.probes) if (p.role === 'body' || p.role === 'head' || p.role === 'tail') whalePts.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: p.r });
      drift.subVectors(home, prevHome);
      if (drift.lengthSq() > 4) drift.set(0, 0, 0); // corte de plano o reaparición
      prevHome.copy(home);
      const n = updateSchool(dt, level);
      const m = updateLoners(dt, level);
      writeInstances(school, n, state.schoolSize, 1, dt);
      writeInstances(loners, m, state.lonerSize, 0.6, dt);
      state.info = `${n} peces en el cardumen`;
    },
    /** Pruebas: centro del cardumen y dispersión. */
    stats() {
      const n = Math.min(state.schoolCount, MAX_SCHOOL);
      const c = new THREE.Vector3();
      for (let i = 0; i < n; i++) c.add(tmpP.set(school.pos[i * 3], school.pos[i * 3 + 1], school.pos[i * 3 + 2]));
      c.divideScalar(n);
      let r = 0, pol = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        r += tmpP.set(school.pos[i * 3], school.pos[i * 3 + 1], school.pos[i * 3 + 2]).distanceTo(c);
        pol.add(dir.set(school.vel[i * 3], school.vel[i * 3 + 1], school.vel[i * 3 + 2]).normalize());
      }
      return { center: c.toArray().map((x) => +x.toFixed(1)), radius: +(r / n).toFixed(2), polarization: +(pol.length() / n).toFixed(2) };
    },
  };
}
