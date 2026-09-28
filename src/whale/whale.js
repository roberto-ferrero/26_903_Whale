import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { float, mix, texture, uniform } from 'three/tsl';

const LOD_NAMES = ['Whale_LOD0', 'Whale_LOD1', 'Whale_LOD2'];

// Propiedades que se copian del material de GLTFLoader al material de nodos equivalente.
const MATERIAL_PROPS = [
  'name', 'color', 'map', 'normalMap', 'normalMapType', 'normalScale', 'aoMap', 'aoMapIntensity',
  'roughness', 'roughnessMap', 'metalness', 'metalnessMap', 'emissive', 'emissiveMap', 'emissiveIntensity',
  'side', 'transparent', 'opacity', 'alphaTest', 'alphaMap', 'depthWrite', 'envMapIntensity',
  'specularIntensity', 'specularColor', 'specularIntensityMap', 'specularColorMap', 'ior',
  'transmission', 'thickness',
];

function toNodeMaterial(source) {
  const target = source.isMeshPhysicalMaterial ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
  for (const key of MATERIAL_PROPS) {
    if (!(key in source) || !(key in target)) continue;
    const value = source[key];
    if (value && typeof value.clone === 'function' && !value.isTexture) target[key] = value.clone();
    else target[key] = value;
  }
  return target;
}

/**
 * Carga el GLB de la ballena: LODs, animaciones y material de piel con mojado (TSL).
 * @param {string} url      GLB exportado desde Blender (export_glb.py)
 * @param {string} wetUrl   mapa de mojado: R rugosidad mojada, G retención de agua, B altura
 */
export async function loadWhale(url, wetUrl) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  const lods = LOD_NAMES.map((name) => root.getObjectByName(name));
  if (lods.some((lod) => !lod)) throw new Error(`El GLB no contiene ${LOD_NAMES.join(', ')}`);

  const wetMap = await new THREE.TextureLoader().loadAsync(wetUrl);
  wetMap.flipY = false; // mismas UVs que las texturas glTF
  wetMap.colorSpace = THREE.NoColorSpace;

  const uniforms = { wetness: uniform(0), wetDarken: uniform(0.12) };

  // Un material de nodos por material original (los LODs los comparten).
  const converted = new Map();
  const materials = {};
  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    meshes.push(obj);
    obj.frustumCulled = false; // la caja de una malla con piel no sigue a la animación
    const src = obj.material;
    if (!converted.has(src)) {
      const mat = toNodeMaterial(src);
      if (src.name === 'Humpback') {
        const orm = texture(src.roughnessMap);
        const wet = texture(wetMap);
        const amount = uniforms.wetness.mul(wet.g.mul(0.4).add(0.6));
        mat.roughnessNode = mix(orm.g, wet.r, amount);
        mat.colorNode = texture(src.map).rgb.mul(float(1).sub(uniforms.wetDarken.mul(amount)));
      }
      converted.set(src, mat);
      materials[mat.name] = mat;
    }
    obj.material = converted.get(src);
  });

  // Animaciones: nombres sin el sufijo _Anim de Blender.
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of gltf.animations) {
    clip.name = clip.name.replace(/_Anim$/, '');
    actions[clip.name] = mixer.clipAction(clip);
  }

  const skinned = meshes.filter((m) => m.isSkinnedMesh);
  const triangles = lods.map((lod) => {
    let n = 0;
    lod.traverse((o) => { if (o.isMesh) n += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
    return n;
  });

  return { root, lods, triangles, mixer, actions, materials, meshes, skinned, uniforms, wetMap, clips: gltf.animations };
}

/** Control de LOD manual (THREE.LOD no encaja bien con mallas con piel compartiendo esqueleto). */
export function createLodController(whale) {
  const state = { mode: 'Auto', dist1: 40, dist2: 120, active: 0, distance: 0 };
  const center = new THREE.Vector3();
  const box = new THREE.Box3();
  return {
    state,
    update(camera) {
      box.setFromObject(whale.lods[0]).getCenter(center);
      state.distance = camera.position.distanceTo(center);
      let level = state.mode === 'Auto'
        ? (state.distance < state.dist1 ? 0 : state.distance < state.dist2 ? 1 : 2)
        : Number(state.mode.slice(-1));
      state.active = level;
      whale.lods.forEach((lod, i) => { lod.visible = i === level; });
    },
  };
}

/** Reproducción de clips con fundido, velocidad, bucle y control del tiempo. */
export function createAnimationController(whale) {
  const names = Object.keys(whale.actions);
  const state = {
    clip: names.includes('Swim1') ? 'Swim1' : names[0],
    playing: true,
    speed: 1,
    loop: true,
    fade: 0.6,
    time: 0,
    duration: 0,
  };
  let current = null;

  const setLoop = (action) => {
    action.setLoop(state.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !state.loop;
  };

  function play(name, fade = state.fade) {
    const next = whale.actions[name];
    if (!next || next === current) return;
    next.reset();
    setLoop(next);
    next.play();
    if (current) current.crossFadeTo(next, fade, false);
    current = next;
    state.clip = name;
    state.duration = next.getClip().duration;
  }

  function restPose() {
    whale.mixer.stopAllAction();
    current = null;
    whale.skinned.forEach((m) => m.skeleton.pose());
  }

  play(state.clip, 0);

  return {
    state,
    names,
    play,
    restPose,
    applyLoop() { if (current) setLoop(current); },
    seek(t) {
      if (!current) return;
      current.time = t;
      whale.mixer.update(0);
    },
    update(dt) {
      whale.mixer.timeScale = state.playing ? state.speed : 0;
      whale.mixer.update(dt);
      if (current) {
        state.time = current.time;
      }
    },
  };
}
