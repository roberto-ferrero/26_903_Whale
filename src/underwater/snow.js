import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, float, hash, instanceIndex, length, mod, mrt, select, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/**
 * Partículas en suspensión (Fase 6.7): nieve marina y plancton en una caja de 36 m que acompaña a
 * la cámara (cada partícula tiene una posición fija en el mundo que se repite con el tamaño de la
 * caja, así que no "viajan" con la cámara). Derivan con una corriente lenta, se hunden despacio y
 * oscilan; su luz es la que llega a esa profundidad, con las cáusticas del océano (haces de luz).
 * Sin cálculo en la GPU aparte: la posición sale del índice y del tiempo en el vertex shader.
 */
export function createSnow({ scene, ocean, count = 14000 }) {
  const B = 36;
  const u = {
    time: uniform(0),
    amount: uniform(1),
    visible: uniform(0),
    current: uniform(new THREE.Vector3(0.12, -0.02, 0.05)), // m/s
  };
  const ou = ocean.uniforms;
  const i = instanceIndex;
  const h1 = hash(i), h2 = hash(i.add(1717)), h3 = hash(i.add(3391)), h4 = hash(i.add(5003));
  const plankton = h4.greaterThan(0.93);
  const seed = vec3(h1, h2, h3).mul(B);
  const wob = vec3(sin(u.time.mul(0.7).add(h1.mul(40))), sin(u.time.mul(0.5).add(h2.mul(40))), sin(u.time.mul(0.6).add(h3.mul(40)))).mul(0.15);
  const world = seed.add(u.current.mul(u.time).mul(h4.mul(0.6).add(0.7))).add(wob);
  // la caja se centra en la cámara: la posición del mundo se repite cada B metros
  const rel = mod(world.sub(cameraPosition).add(B / 2), B).sub(B / 2);
  const pos = cameraPosition.add(rel);

  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  mat.positionNode = pos;
  const size = select(plankton, float(0.05), float(0.025)).mul(h2.mul(0.8).add(0.6));
  // solo bajo la superficie y visible si la cámara está bajo el agua
  const under = smoothstep(0.0, 0.3, ou.level.sub(pos.y));
  mat.scaleNode = vec2(size).mul(under).mul(u.visible);
  const light = vec3(ou.ambient).mul(1.4).add(vec3(ou.sunRadiance).mul(clamp(ou.sunDir.y.mul(4), 0, 1)).mul(0.35))
    .mul(ocean.underLightNode(pos));
  const tint = select(plankton, vec3(0.75, 1.0, 0.8), vec3(1.0));
  mat.colorNode = light.mul(tint);
  const d = length(uv().sub(0.5)).mul(2);
  const fadeEdge = float(1).sub(smoothstep(B * 0.35, B * 0.5, length(rel))); // sin saltos en el borde de la caja
  mat.opacityNode = smoothstep(1.0, 0.2, d).mul(0.55).mul(u.amount).mul(fadeEdge);
  mat.mrtNode = mrt({ velocity: ocean.cameraVelocityNode(pos) }); // posición calculada en el shader: velocidad de cámara
  const sprites = new THREE.Sprite(mat);
  sprites.count = count;
  sprites.frustumCulled = false;
  sprites.renderOrder = 2;
  scene.add(sprites);

  return {
    uniforms: u,
    mesh: sprites,
    update(dt, underwater, amount) {
      u.time.value += dt;
      u.amount.value = amount;
      u.visible.value = underwater ? 1 : 0;
      sprites.visible = underwater && amount > 0;
    },
  };
}
