import * as THREE from 'three/webgpu';
import { boneLabel } from './skeletonHelpers.js';

const TRAIL_MAX = 2000;

/**
 * Punto de anclaje de la ballena: por defecto el hueso `Root` (centro de masas, creado
 * en la Fase 1.6), desde donde se moverá y girará la ballena entera en la 1.7.
 * Ayudas: marcador con ejes, estela de la trayectoria, línea vertical hasta el agua,
 * lectura de posición/altura y cámara que lo sigue.
 */
export function createAnchor(scene, whale, camera, controls, waterState) {
  const bones = whale.skinned[0].skeleton.bones;
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));
  // Root = centro de masas; MasterBone = raíz de la animación original (sube en los saltos)
  const choices = Object.fromEntries(
    bones.filter((b) => ['Root', 'MasterBone', 'Head', 'Spine.007'].includes(boneLabel(b))).map((b) => [boneLabel(b), b.name]),
  );

  const state = {
    bone: 'Root',
    marker: true,
    size: 0.25,
    trail: false,
    trailLength: 600,
    dropLine: true,
    follow: false,
    // lecturas
    position: '',
    heightOverWater: '',
  };

  const group = new THREE.Group();
  scene.add(group);

  const markerMat = new THREE.MeshBasicNodeMaterial({ color: 0xff8c1a, depthTest: false, depthWrite: false, transparent: true });
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), markerMat);
  marker.renderOrder = 999;
  group.add(marker);
  const axes = new THREE.AxesHelper(1);
  axes.material.depthTest = false;
  axes.renderOrder = 999;
  group.add(axes);

  // estela: búfer circular volcado en orden a una línea
  const trailPoints = [];
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicNodeMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.8, depthTest: false }));
  trail.frustumCulled = false;
  trail.renderOrder = 997;
  scene.add(trail);

  // línea vertical hasta el nivel del agua
  const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const drop = new THREE.Line(dropGeo, new THREE.LineDashedNodeMaterial({ color: 0x9fd0ff, dashSize: 0.2, gapSize: 0.12, depthTest: false }));
  drop.renderOrder = 997;
  drop.frustumCulled = false;
  scene.add(drop);

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const lastPos = new THREE.Vector3();
  let hasLast = false;

  function apply() {
    marker.visible = axes.visible = state.marker;
    trail.visible = state.trail;
    drop.visible = state.dropLine;
  }
  apply();

  return {
    state,
    choices,
    apply,
    clearTrail() {
      trailPoints.length = 0;
      trailGeo.setDrawRange(0, 0);
    },
    update() {
      const bone = byName[state.bone];
      group.visible = Boolean(bone);
      if (!bone) return;
      bone.matrixWorld.decompose(pos, quat, scl);
      group.position.copy(pos);
      group.quaternion.copy(quat);
      marker.scale.setScalar(state.size);
      axes.scale.setScalar(state.size * 6);

      if (state.trail) {
        if (!trailPoints.length || trailPoints[trailPoints.length - 1].distanceToSquared(pos) > 1e-4) {
          trailPoints.push(pos.clone());
          while (trailPoints.length > Math.min(state.trailLength, TRAIL_MAX)) trailPoints.shift();
          const arr = trailGeo.attributes.position.array;
          trailPoints.forEach((v, i) => v.toArray(arr, i * 3));
          trailGeo.attributes.position.needsUpdate = true;
          trailGeo.setDrawRange(0, trailPoints.length);
        }
      }

      const water = waterState.waterLevel;
      if (state.dropLine) {
        const a = dropGeo.attributes.position;
        a.setXYZ(0, pos.x, pos.y, pos.z);
        a.setXYZ(1, pos.x, water, pos.z);
        a.needsUpdate = true;
        drop.computeLineDistances();
      }

      // la cámara acompaña al punto de anclaje manteniendo su posición relativa
      if (state.follow && hasLast) {
        const delta = pos.clone().sub(lastPos);
        camera.position.add(delta);
        controls.target.add(delta);
      }
      lastPos.copy(pos);
      hasLast = true;

      state.position = `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)} m`;
      state.heightOverWater = `${(pos.y - water).toFixed(2)} m`;
    },
    focus() {
      controls.target.copy(pos);
      controls.update();
    },
  };
}
