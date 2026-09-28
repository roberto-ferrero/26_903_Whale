import './style.css';
import * as THREE from 'three/webgpu';
import GUI from 'lil-gui';

const container = document.querySelector('#app');

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1a2a);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x10202a, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(3, 5, 2);
scene.add(sun);

const material = new THREE.MeshStandardNodeMaterial({ color: 0x2a7fff, roughness: 0.4, metalness: 0.1 });
const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
scene.add(cube);

const params = {
  rotationSpeed: 1.0,
  color: '#2a7fff',
  wireframe: false,
  exposure: 1.0,
};

const gui = new GUI({ title: 'Fase 0 · Test' });
gui.add(params, 'rotationSpeed', 0, 5, 0.01).name('Velocidad');
gui.addColor(params, 'color').name('Color').onChange((v) => material.color.set(v));
gui.add(params, 'wireframe').name('Wireframe').onChange((v) => (material.wireframe = v));
gui.add(params, 'exposure', 0.1, 3, 0.01).name('Exposición').onChange((v) => (renderer.toneMappingExposure = v));

const timer = new THREE.Timer();

await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';
gui.add({ backend }, 'backend').name('Backend').disable();
console.info(`Renderer backend: ${backend}`);

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = timer.getDelta();
  cube.rotation.x += dt * params.rotationSpeed * 0.5;
  cube.rotation.y += dt * params.rotationSpeed;
  if (window.innerWidth === 0 || window.innerHeight === 0) return; // ventana oculta: evita texturas de tamaño 0
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
