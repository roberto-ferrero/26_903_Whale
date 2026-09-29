import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, abs, clamp, cos,
  dot, exp, float, floor, fract, hash, int, screenCoordinate, length, max, min, mix, normalize, pass, perspectiveDepthToViewZ, pow, select,
  sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/**
 * Cámara bajo el agua (Fase 6): posprocesado de toda la imagen.
 *
 * - 6.1 Transición: cada píxel mira si su punto en el plano cercano está bajo la superficie
 *   (altura del océano + ondas de la ballena), así que con la cámara a medias la imagen se parte
 *   por la línea de flotación, con un menisco oscuro. Al salir quedan gotas en la lente.
 * - 6.3 Niebla y absorción: transmitancia exp(−σ·d) por canal (el rojo desaparece primero) y luz
 *   dispersada que depende de la profundidad de cada punto del rayo (más oscuro hacia abajo).
 * - 6.4 God rays: se marcha el rayo de vista y en cada punto se mira cuánta luz del sol llega a través
 *   de la superficie animada (cáusticas del océano): haces de luz que se mueven con las olas.
 * - 6.8 Distorsión, aberración cromática, desenfoque con la distancia y viñeta.
 */
export function createUnderwater({ renderer, scene, camera, ocean }) {
  const state = {
    enabled: true,
    godRays: 3.2,
    steps: 16,
    scattering: 1, // turbidez: partículas que dispersan la luz
    caustics: 0.3,
    causticSharpness: 0.75, // 0 = suaves, 1 = líneas muy finas
    surfaceCaustics: 0.5,
    rayClouds: 0.5, // las nubes que tapan el sol apagan los haces (1 = del todo, físico)
    distortion: 1,
    chroma: 1,
    blur: 1,
    vignette: 0.35,
    lensDrops: true,
    snow: 1, // Fase 6.7
    info: '',
  };

  const ou = ocean.uniforms;
  const u = {
    near: uniform(0), // 1 si la cámara está cerca de la superficie o debajo (si no, no se calcula nada)
    time: uniform(0),
    godRays: uniform(1),
    steps: uniform(16),
    sigmaS: uniform(0.03),
    distortion: uniform(1),
    chroma: uniform(1),
    blur: uniform(1),
    vignette: uniform(0.35),
    drops: uniform(0), // cantidad de gotas en la lente (1 al salir, se secan en ~4 s)
    frame: uniform(0),
    // la cámara de la escena (en el quad del posprocesado los nodos de cámara son los del quad)
    camPos: uniform(new THREE.Vector3()),
    projInv: uniform(new THREE.Matrix4()),
    camWorld: uniform(new THREE.Matrix4()),
    camNear: uniform(0.1),
    camFar: uniform(1000),
  };
  const cameraPosition = u.camPos, cameraNear = u.camNear, cameraFar = u.camFar;
  const cameraProjectionMatrixInverse = u.projInv, cameraWorldMatrix = u.camWorld;

  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');

  // dirección del rayo de vista en el mundo para una coordenada de pantalla
  const rayDir = (q) => {
    const ndc = vec2(q.x.mul(2).sub(1), float(1).sub(q.y.mul(2)));
    const vp = cameraProjectionMatrixInverse.mul(vec4(ndc, 1, 1));
    const dv = normalize(vp.xyz.div(vp.w));
    return { view: dv, world: normalize(cameraWorldMatrix.mul(vec4(dv, 0)).xyz) };
  };
  const hg = (c, g) => float(1 - g * g).div(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5)).mul(1 / (4 * Math.PI));

  const out = Fn(() => {
    const q = uv();
    const base = color.sample(q).toVar();
    const res = vec3(base.rgb).toVar();

    // ------------------------------------------------------------- 6.1 lente: gotas al salir del agua
    If(u.drops.greaterThan(0.01), () => {
      const aspect = vec2(16, 9).mul(1.6);
      const cellUV = q.mul(aspect);
      const cell = floor(cellUV);
      const hsh = hash(cell.x.add(cell.y.mul(97)).add(7));
      const hsh2 = hash(cell.x.mul(13).add(cell.y.mul(7)).add(3));
      const slide = u.time.mul(hsh.mul(0.25).add(0.05)); // resbalan despacio
      const center = vec2(hsh.mul(0.6).add(0.2), fract(hsh2.mul(0.6).add(0.2).add(slide)));
      const d = cellUV.sub(cell).sub(center);
      const r = hsh2.mul(0.22).add(0.1);
      const inDrop = smoothstep(r, r.mul(0.8), length(d)).mul(select(hsh.greaterThan(0.45), float(1), float(0))).mul(u.drops);
      const lens = q.sub(d.div(aspect).mul(1.8)); // la gota invierte y amplía lo que hay detrás
      const seen = color.sample(lens).rgb;
      const rim = smoothstep(r.mul(0.55), r, length(d)).mul(0.35);
      res.assign(mix(res, seen.mul(float(1).sub(rim)), inDrop));
    });

    If(u.near.greaterThan(0.5), () => {
      const ray = rayDir(q);
      // ¿la "lente" (un plano a 0,5 m, como la cúpula de una carcasa submarina) está bajo el agua en
      // este píxel? Así la línea de flotación parte la imagen con olas de unos centímetros
      const pNear = cameraPosition.add(ray.world.mul(float(0.5).div(max(ray.view.z.negate(), 0.2))));
      const hNear = ocean.surfaceHeightNode(pNear.xz);
      const below = hNear.sub(pNear.y);
      const mask = smoothstep(-0.004, 0.004, below);
      const meniscus = float(1).sub(smoothstep(0.0, 0.014, abs(below)));

      If(mask.greaterThan(0.001), () => {
        // 6.8 distorsión suave del agua delante de la lente
        const qd = q.add(vec2(sin(q.y.mul(23).add(u.time.mul(1.7))), cos(q.x.mul(17).add(u.time.mul(1.3)))).mul(0.0012).mul(u.distortion));
        const viewZ = perspectiveDepthToViewZ(depth.sample(qd).x, cameraNear, cameraFar);
        const rd = rayDir(qd);
        const dist = min(viewZ.div(rd.view.z), 400); // metros hasta lo que se ve (cielo → 400)
        // 6.8 aberración cromática y desenfoque que crecen con la distancia
        const off = qd.sub(0.5).mul(0.004).mul(u.chroma);
        const br = clamp(dist.div(60), 0, 1).mul(0.0035).mul(u.blur);
        const tap = (o) => vec3(color.sample(qd.add(off).add(o)).r, color.sample(qd.add(o)).g, color.sample(qd.sub(off).add(o)).b);
        const scn = tap(vec2(0)).mul(2).add(tap(vec2(br, 0))).add(tap(vec2(br.negate(), 0))).add(tap(vec2(0, br))).add(tap(vec2(0, br.negate()))).div(6);

        // 6.3 / 6.4 medio participativo: absorción + dispersión con luz según la profundidad y haces del sol
        const sigmaT = vec3(ou.absorb).add(u.sigmaS);
        const Ttot = exp(sigmaT.negate().mul(dist));
        const tMax = min(dist, 70);
        const inscatter = vec3(0).toVar();
        // ruido de gradiente entrelazado (Jimenez): menos visible que el ruido blanco
        const sc = screenCoordinate.xy.add(u.frame.mul(5.588238));
        const jitter = fract(fract(sc.x.mul(0.06711056).add(sc.y.mul(0.00583715))).mul(52.9829189));
        const dt = tMax.div(u.steps);
        const phase = hg(dot(rd.world, ou.sunRefr), 0.7).mul(4 * Math.PI);
        const sunUp = clamp(ou.sunDir.y.mul(4), 0, 1);
        Loop({ start: int(0), end: int(u.steps), type: 'int', condition: '<' }, ({ i }) => {
          const t = float(i).add(jitter).mul(dt);
          const p = cameraPosition.add(rd.world.mul(t));
          const D = max(ou.level.sub(p.y), 0.0);
          const Tsurf = exp(vec3(ou.absorb).negate().mul(D.div(max(ou.sunRefr.y, 0.3))));
          const shaft = max(mix(float(1), ocean.shaftNode(p), u.godRays), 0.0);
          const Lsun = vec3(ou.sunRadiance).mul(Tsurf).mul(shaft).mul(phase).mul(sunUp).mul(0.15);
          const Lamb = vec3(ou.ambient).mul(exp(vec3(ou.absorb).negate().mul(D))).mul(0.5);
          inscatter.addAssign(Lsun.add(Lamb).mul(u.sigmaS).mul(exp(sigmaT.negate().mul(t))).mul(dt));
        });
        // más allá de lo marchado: el resto de la luz dispersada, con la del último punto
        const pEnd = cameraPosition.add(rd.world.mul(tMax));
        const Dend = max(ou.level.sub(pEnd.y), 0.0);
        const Lend = vec3(ou.ambient).mul(exp(vec3(ou.absorb).negate().mul(Dend))).mul(0.5)
          .add(vec3(ou.sunRadiance).mul(exp(vec3(ou.absorb).negate().mul(Dend.div(max(ou.sunRefr.y, 0.3))))).mul(phase).mul(sunUp).mul(0.15));
        inscatter.addAssign(Lend.mul(u.sigmaS).div(sigmaT).mul(exp(sigmaT.negate().mul(tMax)).sub(Ttot)));
        let wcol = scn.mul(Ttot).add(inscatter);
        // viñeta
        const vr = length(q.sub(0.5)).mul(1.4);
        wcol = wcol.mul(float(1).sub(vr.mul(vr).mul(u.vignette)));
        res.assign(mix(res, wcol, mask));
      });
      // menisco: la línea de agua sobre la lente, oscura y algo verdosa
      res.assign(mix(res, res.mul(0.35).add(vec3(ou.scatter).mul(0.2)), meniscus.mul(0.85)));
    });
    return vec4(res, base.a);
  })();

  const pipeline = new THREE.RenderPipeline(renderer, out);

  let wasUnder = false;
  let t = 0;
  let frame = 0;

  function apply() {
    u.godRays.value = state.godRays;
    u.steps.value = Math.max(1, Math.round(state.steps));
    u.sigmaS.value = 0.03 * state.scattering * 14 / Math.max(ocean.state.clarity, 0.5);
    ou.caustics.value = state.caustics;
    ou.causticEps.value = 0.5 * (1 - state.causticSharpness) + 0.03;
    ou.surfaceCaustics.value = state.surfaceCaustics;
    ou.rayClouds.value = state.rayClouds;
    u.distortion.value = state.distortion;
    u.chroma.value = state.chroma;
    u.blur.value = state.blur;
    u.vignette.value = state.vignette;
  }
  apply();

  return {
    state,
    apply,
    uniforms: u,
    pipeline,
    get underwater() { return wasUnder; },
    /** Antes de dibujar: ¿cámara bajo el agua o cerca?; gotas en la lente al salir. */
    update(realDt) {
      t += realDt;
      frame++;
      u.time.value = t;
      u.frame.value = frame % 64;
      u.camPos.value.copy(camera.position);
      u.projInv.value.copy(camera.projectionMatrixInverse);
      u.camWorld.value.copy(camera.matrixWorld);
      u.camNear.value = camera.near;
      u.camFar.value = camera.far;
      apply();
      const h = ocean.state.enabled ? ocean.heightAt(camera.position.x, camera.position.z) : -1e9;
      const depthCam = h - camera.position.y;
      const under = state.enabled && ocean.state.enabled && depthCam > 0;
      u.near.value = state.enabled && ocean.state.enabled && depthCam > -2.5 ? 1 : 0;
      if (wasUnder && !under && state.lensDrops) u.drops.value = 1;
      u.drops.value = Math.max(0, u.drops.value - realDt / 4);
      wasUnder = under;
      state.info = under ? `bajo el agua: ${depthCam.toFixed(1)} m` : depthCam > -2.5 ? 'en la superficie' : 'sobre el agua';
    },
    /** Dibuja la escena; sin posprocesado (1,5 ms menos) si la cámara está lejos del agua y sin gotas. */
    render() {
      if (u.near.value > 0.5 || u.drops.value > 0.01) pipeline.render();
      else renderer.render(scene, camera);
    },
  };
}
