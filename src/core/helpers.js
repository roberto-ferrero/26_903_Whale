import * as THREE from 'three/webgpu';
import { positionWorld, uniform } from 'three/tsl';

/**
 * Ayudas visuales y escena placeholder (Fase 2): plano de agua (hasta el océano de la Fase 4),
 * rejilla como fondo marino, ejes, caja de la malla visible y luz del sol. (La persona de 1,8 m de
 * referencia se quitó el 29/09/2026 a petición de Roberto.)
 */
export function createHelpers(scene, sun, whale, lodState) {
  const state = {
    grid: false, // con el océano, la rejilla se vería a través del agua
    gridHeight: -30, // fondo marino de referencia
    axes: false,
    box: false,
    water: false, // plano provisional de la Fase 2 (el océano de la Fase 4 lo sustituye)
    waterLevel: -0.3, // plano de agua del .blend original (−0,41 m) escalado a 14 m
    waterOpacity: 0.9,
    waterColor: '#1c4a66',
    sunHelper: false,
  };

  const grid = new THREE.GridHelper(200, 200, 0x6b8299, 0x4a5a68);
  scene.add(grid);

  const axes = new THREE.AxesHelper(3);
  scene.add(axes);

  const box = new THREE.Box3Helper(new THREE.Box3(), 0xffcc33);
  scene.add(box);

  const waterMat = new THREE.MeshStandardNodeMaterial({
    color: state.waterColor, roughness: 0.18, metalness: 0, transparent: true, opacity: state.waterOpacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const sunHelper = new THREE.DirectionalLightHelper(sun, 3);
  scene.add(sunHelper);

  const tmpBox = new THREE.Box3();

  function apply() {
    grid.visible = state.grid;
    grid.position.y = state.gridHeight;
    axes.visible = state.axes;
    box.visible = state.box;
    water.visible = state.water;
    water.position.y = state.waterLevel;
    waterMat.opacity = state.waterOpacity;
    waterMat.color.set(state.waterColor);
    sunHelper.visible = state.sunHelper;
  }
  apply();

  const waterColor = uniform(new THREE.Color(state.waterColor));
  return {
    state,
    apply() { apply(); waterColor.value.set(state.waterColor); },
    /** Oscurece el agua con las sombras de las nubes (Fase 3.5); shadowFn(posiciónMundo) → 0-1. */
    setWaterShadow(shadowFn) {
      waterMat.colorNode = waterColor.mul(shadowFn(positionWorld));
      waterMat.needsUpdate = true;
    },
    update() {
      if (state.sunHelper) sunHelper.update();
      if (state.box) {
        // caja de la malla con piel deformada (solo el LOD visible)
        box.box.makeEmpty();
        whale.lods[lodState.active].traverse((o) => {
          if (!o.isSkinnedMesh) return;
          o.computeBoundingBox();
          tmpBox.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
          box.box.union(tmpBox);
        });
      }
    },
  };
}
