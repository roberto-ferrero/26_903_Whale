// Empaqueta el GLB de la ballena para la web (Fase 1.8): meshopt + texturas KTX2 (UASTC).
// Uso: npm run pack:model
// Entrada:  <_Blender>/Claude modelo/export/whale.glb y whale_wet_2k.png (de export_glb.py)
// Salida:   public/models/whale.glb y public/models/whale_wet_2k.ktx2
// Necesita el gltfpack NATIVO (el de npm no trae el codificador BasisU):
//   GLTFPACK=<ruta a gltfpack.exe>, por defecto <_Blender>/tools/gltfpack/gltfpack.exe
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BLENDER_DIR = resolve(process.env.WHALE_BLENDER_DIR ?? '../../_Blender');
const EXPORT_DIR = join(BLENDER_DIR, 'Claude modelo', 'export');
const GLTFPACK = resolve(process.env.GLTFPACK ?? join(BLENDER_DIR, 'tools', 'gltfpack', 'gltfpack.exe'));
const OUT_DIR = resolve('public/models');
mkdirSync(OUT_DIR, { recursive: true });

const run = (args) => execFileSync(GLTFPACK, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const mb = (f) => `${(statSync(f).size / 1e6).toFixed(2)} MB`;

// 1) GLB: -cc meshopt · -kn/-km/-ke conservar nodos, materiales y extras · -tu UASTC en todas las texturas
//    (ETC1S, más pequeño, tiñe de verde la piel oscura de la cabeza: comparado en el visor)
const glbIn = join(EXPORT_DIR, 'whale.glb');
const glbOut = join(OUT_DIR, 'whale.glb');
run(['-i', glbIn, '-o', glbOut, '-cc', '-kn', '-km', '-ke', '-tu', '-tj', '8']);
console.log(`whale.glb: ${mb(glbIn)} → ${mb(glbOut)}`);

// 2) Mapa de mojado: gltfpack solo convierte texturas dentro de un glTF, así que se envuelve en un
//    glTF mínimo (como metallicRoughnessTexture = datos lineales) y se recoge el .ktx2 resultante.
const tmp = mkdtempSync(join(tmpdir(), 'wet-'));
try {
  copyFileSync(join(EXPORT_DIR, 'whale_wet_2k.png'), join(tmp, 'whale_wet_2k.png'));
  const buf = Buffer.concat([
    Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
    Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer),
  ]);
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ uri: 'whale_wet_2k.png' }],
    buffers: [{ byteLength: buf.length, uri: `data:application/octet-stream;base64,${buf.toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    ],
  };
  writeFileSync(join(tmp, 'wet.gltf'), JSON.stringify(gltf));
  mkdirSync(join(tmp, 'out'));
  run(['-i', join(tmp, 'wet.gltf'), '-o', join(tmp, 'out', 'wet.gltf'), '-tc', '-tu', 'attrib']);
  copyFileSync(join(tmp, 'out', 'whale_wet_2k.ktx2'), join(OUT_DIR, 'whale_wet_2k.ktx2'));
  console.log(`whale_wet_2k: ${mb(join(EXPORT_DIR, 'whale_wet_2k.png'))} → ${mb(join(OUT_DIR, 'whale_wet_2k.ktx2'))}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
