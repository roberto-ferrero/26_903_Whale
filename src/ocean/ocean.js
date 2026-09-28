import * as THREE from 'three/webgpu';
import {
  Fn, Loop, abs, attribute, cameraFar, cameraNear, cameraPosition, clamp, cos, dot, exp, float, floor, length, log2, max,
  mix, normalize, perspectiveDepthToViewZ, pmremTexture, positionView, pow, reflect, screenUV, select, sin, smoothstep,
  sqrt, texture, uniform, uniformArray, varyingProperty, vec2, vec3, viewportDepthTexture, viewportSharedTexture,
} from 'three/tsl';
import { CASCADE_LENGTHS, FFT_SIZE, G, SPECTRUM_DEFAULTS, buildSpectrum, createCpuField } from './spectrum.js';
import { createFFTOcean } from './fft.js';
import { GERSTNER_COUNT, GERSTNER_DEFAULTS, buildGerstnerWaves, gerstnerDisplacement } from './gerstner.js';

export const OCEAN_MODES = ['FFT', 'Gerstner'];

/**
 * Océano (Fase 4): malla hasta el horizonte (4.1), olas de Gerstner (4.2) o FFT (4.3), shading
 * propio (4.4) y consulta de altura en CPU (4.5).
 *
 * Malla (4.1): una sola rejilla de (2n+1)² vértices con espaciado lineal cerca del centro y
 * geométrico hacia fuera (hasta ~25 km). Cada vértice se ancla a una retícula del mundo con el
 * paso de su propia celda (floor(cámara / celda) · celda): los vértices solo saltan de nodo en
 * nodo de esa retícula y no "nadan" al mover la cámara; como el desplazamiento de cada vértice
 * es menor que su celda, la malla nunca se pliega. Los vértices lejanos leen el desplazamiento
 * en un mip acorde a su celda (sin aliasing) y la superficie se curva con la Tierra.
 */
export function createOcean({ renderer, scene, camera, clouds, sky, getTime, ripples = null }) {
  const state = {
    enabled: true,
    mode: 'FFT',
    level: -0.3,
    ...SPECTRUM_DEFAULTS,
    choppiness: 1.1,
    ...GERSTNER_DEFAULTS,
    // aspecto (4.4)
    scatterColor: '#06303c',
    clarity: 14, // m: distancia a la que el agua deja pasar ~1/e del verde
    sss: 1,
    roughness: 0.04,
    reflections: 1,
    foam: 1,
    foamJacobian: 0.82, // calibrado con la cobertura de Monahan (docs/fase_4_oceano.md)
    foamDecay: 0.8, // 1/s
    haze: 18, // km de visibilidad horizontal
    refraction: true,
    buoys: false,
    // lecturas
    info: '',
  };

  // ------------------------------------------------------------------ espectro y FFT
  let spec = buildSpectrum(state);
  const fft = createFFTOcean(renderer, spec);
  let cpu = createCpuField(spec);
  let gerstner = buildGerstnerWaves(state);
  let specKey = '';
  const specKeys = Object.keys(SPECTRUM_DEFAULTS);

  // ------------------------------------------------------------------ malla (4.1)
  const HALF = 128; // vértices por semieje
  const INNER = 40; // vértices con paso constante
  const STEP0 = 0.35; // m
  const RADIUS = 25000; // m
  // razón geométrica para llegar a RADIUS con los vértices restantes
  let ratio = 1.1;
  {
    let lo = 1.0001, hi = 2;
    const reach = (r) => INNER * STEP0 + STEP0 * r * (r ** (HALF - INNER) - 1) / (r - 1);
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (reach(m) > RADIUS) hi = m; else lo = m; }
    ratio = (lo + hi) / 2;
  }
  const coord = new Float64Array(HALF + 1), cell = new Float64Array(HALF + 1);
  for (let i = 1; i <= HALF; i++) {
    const step = i <= INNER ? STEP0 : STEP0 * ratio ** (i - INNER);
    coord[i] = coord[i - 1] + step;
  }
  for (let i = 0; i <= HALF; i++) cell[i] = i < HALF ? coord[i + 1] - coord[i] : coord[i] - coord[i - 1];
  const side = 2 * HALF + 1;
  const positions = new Float32Array(side * side * 3);
  const cells = new Float32Array(side * side * 2);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const a = i - HALF, b = j - HALF;
      const o = j * side + i;
      positions[o * 3] = Math.sign(a) * coord[Math.abs(a)];
      positions[o * 3 + 2] = Math.sign(b) * coord[Math.abs(b)];
      cells[o * 2] = cell[Math.abs(a)];
      cells[o * 2 + 1] = cell[Math.abs(b)];
    }
  }
  const index = new Uint32Array((side - 1) * (side - 1) * 6);
  let q = 0;
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
      index.set([a, c, b, b, c, d], q);
      q += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('cell', new THREE.BufferAttribute(cells, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  // ------------------------------------------------------------------ uniforms
  const u = {
    level: uniform(state.level),
    gerstner: uniform(0), // 1 = Gerstner, 0 = FFT
    time: uniform(0),
    waves: uniformArray(Array.from({ length: GERSTNER_COUNT }, () => new THREE.Vector4()), 'vec4'),
    q: uniformArray(new Array(GERSTNER_COUNT).fill(0), 'float'),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    sunRadiance: uniform(new THREE.Color(1, 1, 1)),
    ambient: uniform(new THREE.Color(0.3, 0.4, 0.5)),
    envIntensity: uniform(1),
    scatter: uniform(new THREE.Color(state.scatterColor)),
    absorb: uniform(new THREE.Vector3()),
    sss: uniform(state.sss),
    rough: uniform(state.roughness),
    refl: uniform(state.reflections),
    foam: uniform(state.foam),
    foamJ: uniform(state.foamJacobian),
    haze: uniform(state.haze),
    refraction: uniform(1),
  };
  const L = CASCADE_LENGTHS;
  const halfTexel = 0.5 / FFT_SIZE;

  // ------------------------------------------------------------------ vértices
  const vWorld0 = varyingProperty('vec2', 'vOceanWorld0');
  const vPos = varyingProperty('vec3', 'vOceanPos');

  const dispTex = fft.disp.map((t) => texture(t));
  const derivTex = fft.deriv.map((t) => texture(t));
  // entorno: dos nodos PMREM (reflejo y horizonte) cuyo `value` se cambia cuando el cielo lo regenera;
  // hasta entonces, un PMREM vacío
  const emptyEnv = new THREE.PMREMGenerator(renderer).fromScene(new THREE.Scene()).texture;
  const envRefl = pmremTexture(emptyEnv);
  const envHorizon = pmremTexture(emptyEnv);

  const gerstnerAt = (xz, withSlope) => {
    const disp = vec3(0).toVar();
    const slope = vec2(0).toVar();
    const jac = float(1).toVar();
    Loop(GERSTNER_COUNT, ({ i }) => {
      const w = u.waves.element(i);
      const qq = u.q.element(i);
      const th = w.z.mul(dot(w.xy, xz)).sub(sqrt(w.z.mul(G)).mul(u.time));
      const s = sin(th), c = cos(th);
      disp.addAssign(vec3(qq.mul(w.w).mul(w.x).mul(s).negate(), w.w.mul(c), qq.mul(w.w).mul(w.y).mul(s).negate()));
      if (withSlope) {
        slope.addAssign(w.xy.mul(w.w.mul(w.z).mul(s).negate()));
        jac.subAssign(qq.mul(w.w).mul(w.z).mul(c));
      }
    });
    return { disp, slope, jac };
  };

  const material = new THREE.MeshBasicNodeMaterial({ fog: false });
  material.positionNode = Fn(() => {
    const local = attribute('position', 'vec3');
    const cellSize = attribute('cell', 'vec2');
    const cam = cameraPosition;
    const xz = local.xz.add(floor(cam.xz.div(cellSize)).mul(cellSize));
    const disp = vec3(0).toVar();
    // mip según el tamaño de la celda (en texels de cada cascada)
    const cellMax = max(cellSize.x, cellSize.y);
    for (let c = 0; c < L.length; c++) {
      const texel = L[c] / FFT_SIZE;
      const lod = max(log2(cellMax.div(texel)), 0.0);
      const d = dispTex[c].sample(xz.div(L[c]).add(halfTexel)).level(lod);
      disp.addAssign(d.xyz);
    }
    const g = gerstnerAt(xz, false);
    const dsp = mix(disp, g.disp, u.gerstner).toVar();
    // ondas de la interacción con la ballena (Fase 5.2)
    if (ripples) dsp.y.addAssign(ripples.sampleNode(xz, max(log2(cellMax.div(ripples.cell)), 0.0)).x);
    const world = vec3(xz.x, u.level, xz.y).add(dsp).toVar();
    // curvatura de la Tierra: caída d²/2R
    const dx = world.xz.sub(cam.xz);
    world.y.subAssign(dot(dx, dx).div(2 * 6371000));
    vWorld0.assign(xz);
    vPos.assign(world);
    return world;
  })();

  // ------------------------------------------------------------------ fragmento (4.4)
  material.colorNode = Fn(() => {
    const xz = vWorld0;
    const pos = vPos;
    const toCam = cameraPosition.sub(pos);
    const dist = length(toCam);
    const V = toCam.div(dist);
    // pendientes y espuma de las cascadas, las pequeñas se apagan con la distancia
    const slope = vec2(0).toVar();
    const jSmall = float(0).toVar();
    const fades = [float(1), float(1).sub(smoothstep(1500, 5000, dist)), float(1).sub(smoothstep(120, 450, dist))];
    const derivs = [];
    for (let c = 0; c < L.length; c++) {
      const d = derivTex[c].sample(xz.div(L[c]).add(halfTexel));
      derivs.push(d);
      slope.addAssign(d.xy.mul(fades[c]));
      if (c > 0) jSmall.addAssign(d.z.sub(1).mul(fades[c]));
    }
    // espuma: la genera (y la conserva) la cascada grande, que es la que rompe según el viento;
    // las pequeñas solo la texturizan (donde se comprimen, más espuma)
    const foamAcc = derivs[0].w.mul(clamp(float(0.8).sub(jSmall.mul(2.5)), 0.25, 1.6));
    const g = gerstnerAt(xz, true);
    const sl = mix(slope, g.slope, u.gerstner).toVar();
    const foamRaw = mix(foamAcc, clamp(u.foamJ.sub(g.jac).mul(1.5), 0, 1), u.gerstner).toVar();
    if (ripples) {
      // ondas y espuma persistente de la interacción (Fases 5.2 y 5.5)
      const rs = ripples.sampleNode(xz);
      sl.addAssign(rs.yz);
      // la espuma de la ballena también se rompe con el oleaje pequeño (no un disco uniforme)
      foamRaw.addAssign(rs.w.mul(clamp(float(0.7).sub(jSmall.mul(4)), 0.15, 1.6)));
    }
    const N = normalize(vec3(sl.x.negate(), 1, sl.y.negate())).toVar();
    // desde arriba, una normal que mira "hacia dentro" se endereza un poco
    const NdV = dot(N, V);
    N.assign(select(NdV.lessThan(0.02), normalize(N.add(V.mul(float(0.02).sub(NdV)))), N));
    const nv = clamp(dot(N, V), 1e-3, 1);
    // rugosidad: el detalle que ya no se resuelve a distancia se convierte en rugosidad
    const rough = clamp(u.rough.add(smoothstep(30, 4000, dist).mul(0.16)), 0.02, 1);
    const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(nv), 5)));

    // reflejo del cielo (PMREM con cielo y nubes); el rayo no puede apuntar bajo el horizonte
    const R = reflect(V.negate(), N).toVar();
    R.y.assign(abs(R.y));
    envRefl.uvNode = R;
    envRefl.levelNode = rough;
    const env = envRefl.rgb.mul(u.envIntensity);

    // reflejo del sol: GGX + Smith (aprox. de Schlick)
    const Ls = normalize(u.sunDir);
    const H = normalize(Ls.add(V));
    const nl = clamp(dot(N, Ls), 0, 1);
    const nh = clamp(dot(N, H), 0, 1);
    const a2 = rough.mul(rough).mul(rough).mul(rough);
    const dd = nh.mul(nh).mul(a2.sub(1)).add(1);
    const D = a2.div(dd.mul(dd).mul(Math.PI));
    const k = rough.mul(rough).mul(0.5);
    const vis = float(1).div(nl.mul(float(1).sub(k)).add(k).mul(nv.mul(float(1).sub(k)).add(k)).mul(4));
    const Fs = float(0.02).add(float(0.98).mul(pow(float(1).sub(clamp(dot(V, H), 0, 1)), 5)));
    const shadow = clouds.cloudShadowNode(pos);
    const sunSpec = vec3(u.sunRadiance).mul(D.mul(vis).mul(Fs).mul(nl).min(60)).mul(shadow);

    // luz que sale del agua: dispersión en el volumen (azul verdoso) + SSS en las crestas
    const sunUp = clamp(u.sunDir.y.mul(4), 0, 1);
    const light = vec3(u.sunRadiance).mul(sunUp.mul(0.35).mul(shadow)).add(vec3(u.ambient));
    const body = vec3(u.scatter).mul(light);
    const height = pos.y.sub(u.level);
    const sssDir = pow(clamp(dot(V, Ls.negate().add(N.mul(0.4)).normalize()), 0, 1), 4);
    const sss = vec3(u.scatter).mul(vec3(u.sunRadiance)).mul(sssDir.mul(clamp(height.mul(0.6).add(0.3), 0, 1.5)).mul(u.sss).mul(shadow).mul(0.6));
    let under = body.add(sss);

    // refracción: lo que hay bajo la superficie (la ballena), atenuado según el espesor de agua
    const refrUV = screenUV.add(N.xz.mul(0.04).div(max(dist.mul(0.1), 1)));
    const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(refrUV).x, cameraNear, cameraFar);
    const thick = max(positionView.z.sub(sceneZ), 0);
    const trans = exp(vec3(u.absorb).negate().mul(thick)).mul(u.refraction);
    const behind = viewportSharedTexture(refrUV).rgb;
    under = mix(under, behind, trans);

    let col = env.mul(F).mul(u.refl).add(sunSpec).add(under.mul(float(1).sub(F)));
    // espuma de rompiente: blanca y difusa
    const foamAmt = smoothstep(0.0, 1.0, foamRaw.mul(u.foam));
    const foamLit = vec3(u.sunRadiance).mul(nl.mul(0.45).add(0.15).mul(shadow)).add(vec3(u.ambient).mul(2.2)).mul(0.9);
    col = mix(col, foamLit, foamAmt);
    // perspectiva aérea: hacia el color del cielo en el horizonte
    envHorizon.uvNode = normalize(vec3(V.x.negate(), 0.03, V.z.negate()));
    envHorizon.levelNode = float(0.35);
    const horizon = envHorizon.rgb.mul(u.envIntensity);
    const hz = float(1).sub(exp(dist.div(u.haze.mul(1000 / 3)).negate()));
    return mix(col, horizon, hz);
  })();

  /**
   * Altura aproximada del agua en xz (posición sin desplazar), para compute shaders (partículas):
   * nivel + oleaje (mip 0) + ondas de la interacción.
   */
  const surfaceHeightNode = (xz) => {
    let h = float(0);
    for (let c = 0; c < L.length; c++) h = h.add(dispTex[c].sample(xz.div(L[c]).add(halfTexel)).level(0).y);
    h = mix(h, gerstnerAt(xz, false).disp.y, u.gerstner);
    if (ripples) h = h.add(ripples.sampleNode(xz, 0).x);
    return h.add(u.level);
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // después de la ballena: la refracción la ve
  scene.add(mesh);

  // ------------------------------------------------------------------ boyas de prueba (4.5)
  const buoyMat = new THREE.MeshStandardNodeMaterial({ color: 0xffb020, roughness: 0.5 });
  const buoys = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), buoyMat);
    const a = (i / 7) * Math.PI * 2;
    b.userData.xz = [Math.cos(a) * (6 + i * 1.5), Math.sin(a) * (6 + i * 1.5) + 4];
    scene.add(b);
    buoys.push(b);
  }

  // ------------------------------------------------------------------ apply / update
  function apply() {
    mesh.visible = state.enabled;
    u.level.value = state.level;
    u.gerstner.value = state.mode === 'Gerstner' ? 1 : 0;
    u.scatter.value.set(state.scatterColor);
    // absorción del agua de mar (1/m) escalada por la claridad: rojo ≫ verde > azul
    const k = 14 / Math.max(state.clarity, 0.5);
    u.absorb.value.set(0.45 * k, 0.07 * k, 0.045 * k);
    u.sss.value = state.sss;
    u.rough.value = state.roughness;
    u.refl.value = state.reflections;
    u.foam.value = state.foam;
    u.foamJ.value = state.foamJacobian;
    fft.uniforms.foamJ.value = state.foamJacobian;
    u.haze.value = state.haze;
    u.refraction.value = state.refraction ? 1 : 0;
    const key = specKeys.map((k2) => state[k2]).join('|');
    if (key !== specKey) {
      specKey = key;
      spec = buildSpectrum(state);
      fft.setSpectrum(spec);
      cpu = createCpuField(spec);
      cpuTime = -1;
    }
    gerstner = buildGerstnerWaves(state);
    for (let i = 0; i < GERSTNER_COUNT; i++) {
      u.waves.array[i].fromArray(gerstner.waves, i * 4);
      u.q.array[i] = gerstner.q[i];
    }
    const ss = spec.seaState;
    state.info = state.mode === 'FFT'
      ? `Hs ${spec.hs.toFixed(2)} m (viento ${ss.windHs.toFixed(2)} m, Tp ${ss.windPeriod.toFixed(1)} s, λp ${ss.windLength.toFixed(0)} m)`
      : `Gerstner: ${GERSTNER_COUNT} ondas, λ ${state.gWavelength} → ${(state.gWavelength * 0.72 ** 7).toFixed(1)} m`;
    for (const b of buoys) b.visible = state.buoys && state.enabled;
  }

  let cpuTime = -1;
  let time = 0;
  const tmp = [0, 0, 0];
  const sunColor = new THREE.Color();

  /** Altura del agua (y del mundo) en (x, z) en el instante actual. */
  function heightAt(x, z) {
    if (state.mode === 'Gerstner') {
      let px = x, pz = z;
      for (let i = 0; i < 4; i++) { gerstnerDisplacement(gerstner, px, pz, time, tmp); px = x - tmp[0]; pz = z - tmp[2]; }
      return state.level + gerstnerDisplacement(gerstner, px, pz, time, tmp)[1];
    }
    if (cpuTime !== time) { cpu.update(time, state.choppiness); cpuTime = time; }
    return state.level + cpu.heightAt(x, z);
  }

  apply();

  return {
    state,
    apply,
    modes: OCEAN_MODES,
    heightAt,
    surfaceHeightNode,
    mesh,
    fft,
    uniforms: u,
    /** dt de simulación; `light` = sky.light (dirección, color e intensidad del sol, ambiente). */
    update(dt, light, sun) {
      time = getTime();
      u.time.value = time;
      if (!state.enabled) return;
      if (state.mode === 'FFT') fft.update(time, dt, state.choppiness, state.foamDecay);
      if (scene.environment && envRefl.value !== scene.environment) envRefl.value = envHorizon.value = scene.environment;
      u.envIntensity.value = scene.environmentIntensity ?? 1;
      u.sunDir.value.copy(light.dir);
      sunColor.copy(sun.color).multiplyScalar(sun.visible ? sun.intensity : 0);
      u.sunRadiance.value.copy(sunColor);
      u.ambient.value.copy(light.ambient);
      if (state.buoys) for (const b of buoys) b.position.set(b.userData.xz[0], heightAt(b.userData.xz[0], b.userData.xz[1]), b.userData.xz[1]);
    },
  };
}
