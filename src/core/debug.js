import * as THREE from 'three/webgpu';
import { float, positionView, texture, uniform, vec3 } from 'three/tsl';
import { STATE_COLORS, STATE_NAMES } from '../whale/whaleStates.js';

export const BUFFER_VIEWS = ['Final', 'Albedo', 'Normales', 'Profundidad', 'Oclusión (AO)', 'Rugosidad'];

/**
 * Herramientas de depuración (Fase 2.5):
 * - Vistas de buffer sobre la ballena (albedo, normales, profundidad, AO, rugosidad),
 *   cambiando sus materiales por materiales de nodos de diagnóstico.
 * - Línea de tiempo de la máquina de estados: fases del salto, eventos y cursor; clic = saltar a ese instante.
 */
export function createDebug(container, whale, fsm) {
  const state = { view: 'Final', depthRange: 60, timeline: true };
  const depthRange = uniform(state.depthRange);
  const originals = new Map(whale.meshes.map((m) => [m, m.material]));
  const cache = new Map();

  function viewMaterial(src, view) {
    const key = `${src.uuid}:${view}`;
    if (cache.has(key)) return cache.get(key);
    let m;
    if (view === 'Albedo') {
      m = new THREE.MeshBasicNodeMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : src.color });
    } else if (view === 'Normales') {
      m = new THREE.MeshNormalNodeMaterial({ normalMap: src.normalMap ?? null });
    } else if (view === 'Profundidad') {
      m = new THREE.MeshBasicNodeMaterial();
      const d = positionView.z.negate().div(depthRange).clamp(0, 1);
      m.colorNode = vec3(float(1).sub(d));
    } else if (view === 'Oclusión (AO)') {
      m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = src.aoMap ? vec3(texture(src.aoMap).r) : vec3(1);
    } else if (view === 'Rugosidad') {
      m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = src.roughnessMap ? vec3(texture(src.roughnessMap).g) : vec3(src.roughness ?? 0.5);
    }
    m.side = src.side;
    m.alphaTest = src.alphaTest;
    if (src.alphaTest > 0 && src.map) { m.map = src.map; } // mantiene el recorte de las barbs
    cache.set(key, m);
    return m;
  }

  // ------------------------------------------------------------------ línea de tiempo
  const bar = document.createElement('div');
  bar.className = 'timeline';
  bar.innerHTML = '<div class="tl-track"></div><div class="tl-cursor"></div><div class="tl-label"></div>';
  container.appendChild(bar);
  const track = bar.querySelector('.tl-track');
  const cursor = bar.querySelector('.tl-cursor');
  const label = bar.querySelector('.tl-label');
  let drawnPlan = null;

  function drawPlan(plan) {
    track.innerHTML = '';
    drawnPlan = plan;
    if (!plan) return;
    for (const ph of plan.phases) {
      const seg = document.createElement('div');
      seg.className = 'tl-seg';
      seg.style.left = `${(ph.start / plan.duration) * 100}%`;
      seg.style.width = `${(ph.dur / plan.duration) * 100}%`;
      seg.style.background = STATE_COLORS[ph.id];
      seg.title = `${STATE_NAMES[ph.id]} · ${ph.dur.toFixed(2)} s`;
      seg.textContent = STATE_NAMES[ph.id].split(' ')[0];
      track.appendChild(seg);
    }
    for (const [name, t] of [['surface_exit', plan.tExit], ['apex', plan.apexTime], ['impact', plan.impactTime]]) {
      const tick = document.createElement('div');
      tick.className = 'tl-event';
      tick.style.left = `${(t / plan.duration) * 100}%`;
      tick.title = `${name} · ${t.toFixed(2)} s`;
      track.appendChild(tick);
    }
  }

  bar.addEventListener('pointerdown', (e) => {
    if (!fsm.plan) return;
    const rect = track.getBoundingClientRect();
    fsm.seek(((e.clientX - rect.left) / rect.width) * fsm.plan.duration);
  });

  function apply() {
    depthRange.value = state.depthRange;
    for (const [mesh, src] of originals) mesh.material = state.view === 'Final' ? src : viewMaterial(src, state.view);
    bar.style.display = state.timeline ? '' : 'none';
  }
  apply();

  return {
    state,
    views: BUFFER_VIEWS,
    apply,
    update() {
      if (!state.timeline) return;
      const plan = fsm.plan;
      if (plan !== drawnPlan) drawPlan(plan);
      const s = fsm.state;
      if (plan) {
        cursor.style.display = '';
        cursor.style.left = `${(s.planTime / plan.duration) * 100}%`;
        label.textContent = `${s.label} · ${s.planTime.toFixed(2)} / ${plan.duration.toFixed(2)} s · último evento: ${s.lastEvent}  (clic para ir a un instante)`;
      } else {
        cursor.style.display = 'none';
        const p = fsm.params;
        label.textContent = !p.enabled
          ? 'Máquina de estados desactivada (modo libre)'
          : `Nadar · ${s.timeInState.toFixed(1)} s${p.autoJump ? ` · siguiente salto en ${Math.max(0, p.autoInterval - s.timeInState).toFixed(1)} s` : ' · salto manual (tecla J)'}`;
      }
    },
  };
}
