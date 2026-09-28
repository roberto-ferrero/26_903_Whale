import * as THREE from 'three/webgpu';
import { BREACH_DEFAULTS, G, bodyQuaternion, planBreach } from './breachPlanner.js';

export const STATE_NAMES = {
  nadar: 'Nadar', preparar: 'Preparar (ascenso)', saltar: 'Saltar (en el aire)', caer: 'Caer (impacto)', recuperar: 'Recuperar',
};
export const STATE_COLORS = { nadar: '#4fc3f7', preparar: '#81c784', saltar: '#ffee58', caer: '#ef5350', recuperar: '#ba68c8' };

/**
 * Máquina de estados de la ballena (Fase 2.4): nadar → preparar → saltar → caer → recuperar → nadar.
 *
 * - **nadar**: nada a la profundidad indicada con un rumbo que deriva suavemente y vuelve hacia
 *   el centro si se aleja (radio). Salta cuando se pide (`jump()`) o, en modo automático, tras
 *   el intervalo indicado.
 * - **preparar / saltar / caer / recuperar**: siguen un plan de salto calculado desde la posición y
 *   el rumbo actuales (`breachPlanner.js`); el plan es determinista y se puede recorrer (`seek`).
 * Mueve el hueso Root (centro de masas) y elige los clips: swim_idle / swim_fast / breach_body.
 * Eventos (`on`): cambios de estado (`state`) y `surface_exit`, `apex`, `impact`.
 */
export function createWhaleStates(scene, whale, anim, waterState) {
  const root = whale.rootBone;
  const head = whale.skinned[0].skeleton.bones.find((b) => (b.userData.name ?? b.name) === 'Head');
  const restLocal = { pos: root.position.clone(), quat: root.quaternion.clone() };
  whale.root.updateMatrixWorld(true);
  const restWorldQuat = root.getWorldQuaternion(new THREE.Quaternion());
  const bodyEvents = whale.clipEvents.breach_body ?? { surface_exit: 2.625, apex: 3.625, impact: 5.083 };
  const bodyDuration = whale.actions.breach_body?.getClip().duration ?? 5.96;

  const params = {
    enabled: true, // false = modo libre: clips a mano y ballena en reposo
    depth: 12, // profundidad del centro de masas al nadar (m)
    swimSpeed: 2, // m/s
    wander: 0.12, // amplitud del cambio de rumbo al nadar (rad/s)
    radius: 45, // si se aleja más del centro, vuelve hacia él (m)
    autoJump: true,
    autoInterval: 6, // s nadando antes del siguiente salto automático
    showPath: true,
    ...BREACH_DEFAULTS,
  };
  const state = {
    current: 'nadar',
    label: STATE_NAMES.nadar,
    timeInState: 0,
    planTime: 0,
    planDuration: 0,
    lastEvent: '—',
    airTime: '',
    apexHeight: '',
  };

  const pos = new THREE.Vector3(0, waterState.waterLevel - params.depth, -25);
  let heading = 0;
  let yawRate = 0;
  let swimTime = 0;
  let plan = null;
  const flags = { body: false, recover: false, apex: false, impact: false };
  let lastHeadY = null;
  const listeners = [];

  // ------------------------------------------------------------------ vista previa del plan
  const pathGeo = new THREE.BufferGeometry();
  const path = new THREE.Line(pathGeo, new THREE.LineBasicNodeMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.7 }));
  path.frustumCulled = false;
  scene.add(path);
  const markerGeo = new THREE.SphereGeometry(0.18, 12, 8);
  const markers = {
    surface_exit: new THREE.Mesh(markerGeo, new THREE.MeshBasicNodeMaterial({ color: 0x66bb6a })),
    apex: new THREE.Mesh(markerGeo, new THREE.MeshBasicNodeMaterial({ color: 0xffee58 })),
    impact: new THREE.Mesh(markerGeo, new THREE.MeshBasicNodeMaterial({ color: 0xef5350 })),
  };
  Object.values(markers).forEach((m) => scene.add(m));

  function updatePathVisibility() {
    const show = params.enabled && params.showPath && Boolean(plan);
    path.visible = show;
    Object.values(markers).forEach((m) => { m.visible = show; });
  }
  function drawPlan() {
    const pts = [];
    for (let t = 0; t <= plan.duration; t += 0.05) {
      const v = new THREE.Vector3();
      plan.sample(t, v, null);
      pts.push(v);
    }
    pathGeo.setFromPoints(pts);
    markers.surface_exit.position.copy(plan.E);
    markers.apex.position.copy(plan.apex);
    markers.impact.position.copy(plan.I);
    updatePathVisibility();
  }

  // ------------------------------------------------------------------ hueso Root
  const parentQ = new THREE.Quaternion();
  const parentInv = new THREE.Matrix4();
  const worldQ = new THREE.Quaternion();
  const Q = new THREE.Quaternion();
  function applyToRoot(p, q) {
    const parent = root.parent;
    parent.updateMatrixWorld(true);
    parentInv.copy(parent.matrixWorld).invert();
    root.position.copy(p).applyMatrix4(parentInv);
    worldQ.copy(q).multiply(restWorldQuat);
    parent.getWorldQuaternion(parentQ);
    root.quaternion.copy(parentQ.invert().multiply(worldQ));
  }
  function resetRoot() {
    root.position.copy(restLocal.pos);
    root.quaternion.copy(restLocal.quat);
  }

  function emit(name, detail) {
    if (name !== 'state') state.lastEvent = `${name} (${state.timeInState.toFixed(2)} s en ${state.current})`;
    listeners.forEach((fn) => fn(name, detail));
  }
  function setState(id) {
    if (state.current === id) return;
    state.current = id;
    state.label = STATE_NAMES[id];
    state.timeInState = 0;
    emit('state', id);
  }

  // ------------------------------------------------------------------ nadar
  function swim(dt) {
    swimTime += dt;
    // deriva suave del rumbo y regreso hacia el centro si se aleja
    const toCenter = Math.atan2(-pos.x, -pos.z);
    let diff = ((toCenter - heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const far = THREE.MathUtils.smoothstep(Math.hypot(pos.x, pos.z), params.radius * 0.7, params.radius);
    const target = params.wander * Math.sin(swimTime * 0.23) + far * THREE.MathUtils.clamp(diff, -0.4, 0.4);
    yawRate += (target - yawRate) * Math.min(1, dt * 1.5);
    heading += yawRate * dt;
    pos.x += Math.sin(heading) * params.swimSpeed * dt;
    pos.z += Math.cos(heading) * params.swimSpeed * dt;
    // vuelve a la profundidad de nado con suavidad (p. ej. tras cambiarla en el panel)
    const targetY = waterState.waterLevel - params.depth;
    pos.y += (targetY - pos.y) * Math.min(1, dt * 0.5);
    applyToRoot(pos, bodyQuaternion(heading, 0, -yawRate * 1.5, Q)); // se inclina al girar
    if (params.autoJump && state.timeInState >= params.autoInterval) jump();
  }

  // ------------------------------------------------------------------ salto
  function jump() {
    if (!params.enabled || state.current !== 'nadar') return;
    plan = planBreach(pos.clone(), heading, waterState.waterLevel, params.swimSpeed, params, bodyEvents, bodyDuration);
    state.planTime = 0;
    state.planDuration = plan.duration;
    state.airTime = `${plan.tAir.toFixed(2)} s`;
    state.apexHeight = `${plan.apexHeight.toFixed(2)} m (centro de masas)`;
    flags.body = flags.recover = flags.apex = flags.impact = false;
    lastHeadY = null;
    drawPlan();
    setState('preparar');
    anim.play('swim_fast', 1.0);
  }

  const P = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  function followPlan(dt) {
    state.planTime += dt;
    const t = state.planTime;
    const ph = plan.sample(Math.min(t, plan.duration), P, Q);
    applyToRoot(P, Q);
    if (ph.id !== state.current && t < plan.duration) setState(ph.id);

    if (!flags.body && t >= plan.bodyStart) {
      flags.body = true;
      anim.play('breach_body', 0.8, { timeScale: plan.rate, startTime: Math.max(0, (t - plan.bodyStart) * plan.rate), once: true, restart: true });
    }
    if (!flags.recover && (t >= plan.bodyEnd || ph.id === 'recuperar')) {
      flags.recover = true;
      anim.play('swim_idle', 1.5, { restart: true });
    }
    if (head) {
      head.getWorldPosition(headPos);
      if (lastHeadY !== null && lastHeadY < plan.w && headPos.y >= plan.w && ph.id !== 'recuperar') emit('surface_exit');
      lastHeadY = headPos.y;
    }
    if (!flags.apex && t >= plan.apexTime) { flags.apex = true; emit('apex'); }
    if (!flags.impact && t >= plan.impactTime) { flags.impact = true; emit('impact'); }

    if (t >= plan.duration) {
      // de vuelta a nadar desde el final del plan, con el mismo rumbo
      pos.copy(plan.R);
      heading = plan.heading;
      yawRate = 0;
      plan = null;
      updatePathVisibility();
      setState('nadar');
    }
  }

  function setEnabled(on) {
    params.enabled = on;
    if (!on) {
      plan = null;
      resetRoot();
      setState('nadar');
    } else {
      pos.set(0, waterState.waterLevel - params.depth, -25);
      heading = 0;
      anim.play('swim_idle', anim.state.fade, { restart: true });
    }
    updatePathVisibility();
  }

  if (params.enabled) anim.play('swim_idle', 0, { restart: true });

  return {
    params,
    state,
    get plan() { return plan; },
    get phases() { return plan?.phases ?? []; },
    on(fn) { listeners.push(fn); },
    jump,
    setEnabled,
    apply() {
      setEnabled(params.enabled);
      if (plan) drawPlan();
      updatePathVisibility();
    },
    /** Recorre el plan de salto actual hasta el instante t (s desde el inicio del ascenso). */
    seek(t) {
      if (!plan) return;
      const target = THREE.MathUtils.clamp(t, 0, plan.duration - 1e-3);
      state.planTime = target;
      flags.apex = target >= plan.apexTime;
      flags.impact = target >= plan.impactTime;
      flags.recover = target >= plan.bodyEnd || target >= plan.phases[3].start;
      flags.body = target >= plan.bodyStart;
      if (flags.recover) anim.play('swim_idle', 0, { restart: true });
      else if (flags.body) anim.play('breach_body', 0, { timeScale: plan.rate, startTime: (target - plan.bodyStart) * plan.rate, once: true, restart: true });
      else anim.play('swim_fast', 0, { restart: true });
      lastHeadY = null;
      const ph = plan.sample(target, P, Q);
      applyToRoot(P, Q);
      setState(ph.id);
      whale.mixer.update(0);
    },
    update(dt) {
      anim.update(dt);
      if (!params.enabled) return;
      state.timeInState += dt;
      if (state.current === 'nadar' && !plan) swim(dt);
      else if (plan) followPlan(dt);
    },
    /** Posición del centro de masas y rumbo actuales (para cámaras y ayudas). */
    getPose(outPos) {
      root.getWorldPosition(outPos);
      return plan ? plan.heading : heading;
    },
    G,
  };
}
