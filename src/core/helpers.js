import * as THREE from 'three/webgpu';

/**
 * Ayudas visuales y escena placeholder (Fase 2): plano de agua (hasta el océano de la Fase 4),
 * rejilla como fondo marino, ejes, caja de la malla visible, luz del sol y una persona de 1,8 m
 * de pie sobre el agua como referencia de escala.
 */
export function createHelpers(scene, sun, whale, lodState) {
  const state = {
    grid: true,
    gridHeight: -30, // fondo marino de referencia
    axes: false,
    box: false,
    water: true,
    waterLevel: -0.3, // plano de agua del .blend original (−0,41 m) escalado a 14 m
    waterOpacity: 0.55,
    waterColor: '#3f6f8f',
    sunHelper: false,
    human: true,
  };

  const grid = new THREE.GridHelper(200, 200, 0x6b8299, 0x4a5a68);
  scene.add(grid);

  const axes = new THREE.AxesHelper(3);
  scene.add(axes);

  const box = new THREE.Box3Helper(new THREE.Box3(), 0xffcc33);
  scene.add(box);

  const waterMat = new THREE.MeshBasicNodeMaterial({
    color: state.waterColor, transparent: true, opacity: state.waterOpacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const sunHelper = new THREE.DirectionalLightHelper(sun, 3);
  scene.add(sunHelper);

  // referencia de escala: persona de 1,8 m de pie sobre el agua
  const human = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 1.36, 4, 12),
    new THREE.MeshStandardNodeMaterial({ color: 0xe07a3f, roughness: 0.6 }),
  );
  human.position.set(8, 0.9 + state.waterLevel, 4);
  scene.add(human);

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
    human.visible = state.human;
    human.position.y = 0.9 + state.waterLevel;
  }
  apply();

  return {
    state,
    apply,
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
