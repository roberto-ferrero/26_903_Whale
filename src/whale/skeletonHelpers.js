import * as THREE from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Grupos de huesos por prefijo de nombre (orden: el primero que coincide).
export const BONE_GROUPS = [
  { name: 'Raíz', test: (n) => n === 'Root', color: 0xff8c1a },
  { name: 'Columna', test: (n) => n.startsWith('MasterBone') || n.startsWith('Spine'), color: 0x4fc3f7 },
  { name: 'Cabeza', test: (n) => n === 'Head' || n.endsWith('Jaw'), color: 0xba68c8 },
  { name: 'Lengua', test: (n) => n.startsWith('Tongue'), color: 0xf06292 },
  { name: 'Ojos', test: (n) => n.startsWith('Eye'), color: 0xffffff },
  { name: 'Pectorales', test: (n) => n.startsWith('Fin'), color: 0x81c784 },
  { name: 'Dorsal', test: (n) => n.startsWith('UpperFin'), color: 0xaed581 },
  { name: 'Caudal', test: (n) => n.startsWith('Tail'), color: 0xffd54f },
];
const groupOf = (name) => BONE_GROUPS.find((g) => g.test(name)) ?? { name: 'Otros', color: 0x9e9e9e };
// GLTFLoader limpia los nombres (`Fin.L.001` → `FinL001`); el original queda en userData.name
export const boneLabel = (bone) => bone.userData.name ?? bone.name;

/**
 * Ayudas del esqueleto: líneas, articulaciones coloreadas por grupo (vistas a través
 * del cuerpo), ejes locales, etiquetas con el nombre y hueso seleccionado con lectura
 * de su posición y rotación.
 */
export function createSkeletonHelpers(scene, whale) {
  const bones = whale.skinned[0].skeleton.bones;
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));

  const state = {
    lines: false,
    joints: false,
    jointSize: 0.07,
    axes: false,
    axesSize: 0.3,
    labels: 'Ninguna',
    selected: 'Root',
    showSelected: true,
    bodyOpacity: 1,
    // lecturas del hueso seleccionado
    info: { group: '', worldPos: '', localRot: '', parent: '' },
  };

  const lines = new THREE.SkeletonHelper(whale.root);
  lines.visible = false;
  scene.add(lines);

  // articulaciones: una esfera instanciada por hueso, sin test de profundidad (se ven a través)
  const jointMat = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, transparent: true });
  const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), jointMat, bones.length);
  joints.renderOrder = 998;
  joints.frustumCulled = false;
  const color = new THREE.Color();
  bones.forEach((b, i) => joints.setColorAt(i, color.set(groupOf(b.name).color)));
  scene.add(joints);

  // hueso seleccionado: esfera mayor y ejes locales
  const selMat = new THREE.MeshBasicNodeMaterial({ color: 0xffee58, depthTest: false, depthWrite: false, transparent: true });
  const selMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), selMat);
  selMarker.renderOrder = 999;
  scene.add(selMarker);
  const selAxes = new THREE.AxesHelper(1);
  selAxes.material.depthTest = false;
  selAxes.renderOrder = 999;
  scene.add(selAxes);

  // ejes locales en todos los huesos (hijos de cada hueso: siguen la animación)
  const boneAxes = bones.map((b) => {
    const a = new THREE.AxesHelper(1);
    a.material.depthTest = false;
    a.renderOrder = 997;
    a.visible = false;
    b.add(a);
    return a;
  });

  // etiquetas (CSS2D): se dibujan con el CSS2DRenderer del visor
  const labels = bones.map((b) => {
    const el = document.createElement('div');
    el.className = 'bone-label';
    el.textContent = boneLabel(b);
    el.style.color = `#${color.set(groupOf(b.name).color).getHexString()}`;
    const obj = new CSS2DObject(el);
    obj.visible = false;
    b.add(obj);
    return obj;
  });

  const skinMats = [whale.materials.Humpback, whale.materials.Cornea].filter(Boolean);

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  const fmt = (v) => v.toFixed(2);

  function apply() {
    lines.visible = state.lines;
    joints.visible = state.joints;
    boneAxes.forEach((a) => { a.visible = state.axes; a.scale.setScalar(state.axesSize); });
    labels.forEach((l, i) => {
      const g = groupOf(bones[i].name).name;
      l.visible = state.labels === 'Todas' || state.labels === g;
    });
    selMarker.visible = selAxes.visible = state.showSelected;
    for (const mat of skinMats) {
      const opaque = state.bodyOpacity >= 1;
      mat.transparent = !opaque || mat.name === 'Cornea';
      mat.opacity = mat.name === 'Cornea' ? mat.opacity : state.bodyOpacity;
      mat.depthWrite = opaque;
      mat.needsUpdate = true;
    }
  }
  apply();

  return {
    state,
    bones,
    // opciones para lil-gui: { nombre original: nombre en Three.js }
    names: Object.fromEntries(bones.map((b) => [boneLabel(b), b.name])),
    labelGroups: ['Ninguna', 'Todas', ...BONE_GROUPS.map((g) => g.name)],
    apply,
    update() {
      if (state.joints) {
        bones.forEach((b, i) => {
          b.getWorldPosition(p);
          m.compose(p, q.identity(), s.setScalar(state.jointSize));
          joints.setMatrixAt(i, m);
        });
        joints.instanceMatrix.needsUpdate = true;
      }
      const bone = byName[state.selected];
      selMarker.visible = selAxes.visible = Boolean(bone) && state.showSelected;
      if (bone) {
        bone.matrixWorld.decompose(p, q, s);
        selMarker.position.copy(p);
        selMarker.scale.setScalar(state.jointSize * 1.8);
        selAxes.position.copy(p);
        selAxes.quaternion.copy(q);
        selAxes.scale.setScalar(Math.max(state.axesSize * 2, 0.6));
        e.setFromQuaternion(bone.quaternion);
        const d = THREE.MathUtils.radToDeg;
        state.info.group = groupOf(bone.name).name;
        state.info.parent = bone.parent?.isBone ? boneLabel(bone.parent) : '—';
        state.info.worldPos = `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)} m`;
        state.info.localRot = `${d(e.x).toFixed(0)}°, ${d(e.y).toFixed(0)}°, ${d(e.z).toFixed(0)}°`;
      }
    },
  };
}
