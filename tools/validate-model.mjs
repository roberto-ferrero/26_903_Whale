// Validación del GLB de la ballena (Fase 1.8).
// Uso: npm run validate:model [-- ruta.glb]
// 1) Validador oficial de Khronos (errores / avisos / información).
// 2) Comprobaciones propias del proyecto: LODs, esqueleto, clips, eventos, materiales y compresión.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import validator from 'gltf-validator';

const file = resolve(process.argv[2] ?? 'public/models/whale.glb');
const bytes = new Uint8Array(readFileSync(file));

function glbJson(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('No es un GLB');
  const len = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)));
}

const report = await validator.validateBytes(bytes, {
  maxIssues: 200,
  // el GLB es autocontenido: no hay recursos externos que resolver
  externalResourceFunction: () => Promise.reject(new Error('sin recursos externos')),
});
const { numErrors, numWarnings, numInfos, messages } = report.issues;

const j = glbJson(bytes);
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const meshNames = (j.meshes ?? []).map((m) => m.name);
const nodeNames = (j.nodes ?? []).map((n) => n.name);
check('3 LODs', ['Whale_LOD0', 'Whale_LOD1', 'Whale_LOD2'].every((n) => nodeNames.includes(n) || meshNames.includes(n)), meshNames.join(', '));
const skin = j.skins?.[0];
check('1 esqueleto, 48 articulaciones', j.skins?.length === 1 && skin.joints.length === 48, `${j.skins?.length ?? 0} skins, ${skin?.joints.length ?? 0} joints`);
check('Hueso Root con extras.anchor', j.nodes.some((n) => n.name === 'Root' && n.extras?.anchor), '');
const clips = (j.animations ?? []).map((a) => a.name);
check('Clips del salto', ['swim_idle', 'swim_fast', 'breach_body'].every((c) => clips.includes(c)), clips.join(', '));
const breach = j.animations?.find((a) => a.name === 'breach_body');
const rootNode = j.nodes.find((n) => n.name === 'Root');
// gltfpack quita los extras de las animaciones: se admite la copia en el hueso Root
const rootEv = rootNode?.extras?.clip_events;
const ev = breach?.extras?.events ?? (typeof rootEv === 'string' ? JSON.parse(rootEv) : rootEv)?.breach_body;
const events = typeof ev === 'string' ? JSON.parse(ev) : ev;
check('Eventos de breach_body', events && ['surface_exit', 'apex', 'impact'].every((k) => typeof events[k] === 'number'), JSON.stringify(events ?? {}));
const mats = Object.fromEntries((j.materials ?? []).map((m) => [m.name, m]));
check('Piel: baseColor, ORM, normal y oclusión', Boolean(mats.Humpback?.pbrMetallicRoughness?.baseColorTexture && mats.Humpback?.pbrMetallicRoughness?.metallicRoughnessTexture && mats.Humpback?.normalTexture && mats.Humpback?.occlusionTexture));
check('Piel: extras.wet_map', Boolean(mats.Humpback?.extras?.wet_map), mats.Humpback?.extras?.wet_map ?? '');
check('Barbs: alphaMode MASK', mats.Barbs?.alphaMode === 'MASK');
const used = j.extensionsUsed ?? [];
check('Malla comprimida (meshopt)', used.includes('EXT_meshopt_compression'), used.join(', '));
check('Texturas KTX2 (KHR_texture_basisu)', used.includes('KHR_texture_basisu'));

const mb = (statSync(file).size / 1e6).toFixed(2);
console.log(`\nGLB: ${file}\nTamaño: ${mb} MB`);
console.log(`Validador Khronos: ${numErrors} errores · ${numWarnings} avisos · ${numInfos} informativos`);
for (const m of messages.filter((x) => x.severity <= 1).slice(0, 25)) {
  console.log(`  [${m.severity === 0 ? 'ERROR' : 'aviso'}] ${m.code} ${m.pointer ?? ''} ${m.message}`);
}
console.log('\nComprobaciones del proyecto:');
for (const c of checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
const failed = checks.filter((c) => !c.ok).length;
process.exitCode = numErrors > 0 || failed > 0 ? 1 : 0;
