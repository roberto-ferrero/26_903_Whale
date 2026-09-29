import * as THREE from 'three/webgpu';
import { BREACH_DEFAULTS, G, bodyQuaternion, planBreach } from './breachPlanner.js';
import { BREATH_DEFAULTS, planBreath, strokeAt } from './breathPlanner.js';

export const STATE_NAMES = {
  nadar: 'Nadar', preparar: 'Preparar (ascenso)', saltar: 'Saltar (en el aire)', caer: 'Caer (impacto)', recuperar: 'Recuperar',
  subir: 'Subir a respirar', respirar: 'Respirar (soplido)', bajar: 'Sumergirse',
};
export const STATE_COLORS = {
  nadar: '#4fc3f7', preparar: '#81c784', saltar: '#ffee58', caer: '#ef5350', recuperar: '#ba68c8',
  subir: '#80deea', respirar: '#ffffff', bajar: '#4db6ac',
};
/** Acciones del modo automático, en orden: nada → respira → nada → salta → nada → respira → nada → respira. */
export const AUTO_CYCLE = ['respirar', 'saltar', 'respirar', 'respirar'];
const smoothstep01 = (x) => x * x * (3 - 2 * x);

/**
 * Máquina de estados de la ballena (Fase 2.4): nadar → preparar → saltar → caer → recuperar → nadar,
 * y la respiración (29/09/2026): nadar → subir → respirar → bajar → nadar.
 *
 * - **nadar**: nada a la profundidad indicada con un rumbo que deriva suavemente y vuelve hacia
 *   el centro si se aleja (radio). Salta cuando se pide (`jump()`) o, en modo automático, tras
 *   el intervalo indicado. En automático alterna respirar y saltar (`AUTO_CYCLE`).
 * - **preparar / saltar / caer / recuperar**: siguen un plan de salto calculado desde la posición y
 *   el rumbo actuales (`breachPlanner.js`); el plan es determinista y se puede recorrer (`seek`).
 * - **subir / respirar / bajar**: plan de respiración (`breathPlanner.js`).
 * - **Transiciones sin saltos:** al empezar o acabar un plan, la diferencia de posición y de
 *   orientación con la pose anterior (p. ej. la inclinación al girar nadando) se reparte en 1 s.
 * Mueve el hueso Root (centro de masas) y elige los clips: swim_idle / swim_fast / breach_body.
 * Eventos (`on`): cambios de estado (`state`) y `surface_exit`, `apex`, `impact`, `blow`.
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
    autoBreath: true, // en automático también sube a respirar (ciclo AUTO_CYCLE)
    autoInterval: 6, // s nadando antes de la siguiente acción automática
    blendTime: 1, // s para absorber la diferencia de pose en cada cambio de plan
    surfaceStroke: 0.25, // amplitud del aleteo junto a la superficie (1 = la del clip)
    showPath: true,
    ...BREACH_DEFAULTS,
    ...BREATH_DEFAULTS,
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
  let vy = 0; // velocidad vertical al nadar (cambios de profundidad con cabeceo)
  let swimTime = 0;
  let plan = null;
  let cycle = 0; // posición en AUTO_CYCLE
  let getWaterHeight = null, waveOffset = 0;
  const flags = { body: false, recover: false, apex: false, impact: false, blow: false };
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
    const show = params.enabled && params.showPath && Boolean(plan) && plan.kind !== 'breath';
    path.visible = show;
    Object.values(markers).forEach((m) => { m.visible = show; });
  }
  function drawPlan() {
    if (plan.kind === 'breath') {
      pathGeo.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      path.visible = false;
      Object.values(markers).forEach((m) => { m.visible = false; });
      return;
    }
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
    hasLast = false;
  }

  // transiciones: la pose aplicada en el fotograma anterior y el desfase que se va absorbiendo
  const lastP = new THREE.Vector3(), lastQ = new THREE.Quaternion();
  let hasLast = false, blendPending = false;
  const blend = { t: 1, dp: new THREE.Vector3(), dq: new THREE.Quaternion() };
  const bP = new THREE.Vector3(), bQ = new THREE.Quaternion(), qI = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  /** Coloca la ballena (centro de masas y orientación en el mundo) absorbiendo los saltos de pose. */
  function place(p, q, dt) {
    if (blendPending && hasLast) {
      blend.dp.subVectors(lastP, p);
      blend.dq.copy(lastQ).multiply(qInv.copy(q).invert());
      blend.t = 0;
    }
    blendPending = false;
    if (blend.t < 1) {
      blend.t = Math.min(1, blend.t + dt / Math.max(params.blendTime, 1e-3));
      const s = 1 - smoothstep01(blend.t);
      bP.copy(p).addScaledVector(blend.dp, s);
      bQ.slerpQuaternions(qI, blend.dq, s).multiply(q);
      p = bP; q = bQ;
    }
    lastP.copy(p); lastQ.copy(q); hasLast = true;
    applyToRoot(p, q);
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
  /** Empieza (o termina) un plan: el próximo `place` reparte la diferencia de pose. */
  function beginTransition() { blendPending = params.blendTime > 0; }

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
    // vuelve a la profundidad de nado con suavidad (p. ej. tras cambiarla en el panel o en la
    // secuencia): velocidad vertical limitada y suavizada, y el cuerpo cabecea hacia donde va
    const targetY = waterState.waterLevel - params.depth;
    const vMax = params.swimSpeed * 0.45;
    const vyTarget = THREE.MathUtils.clamp((targetY - pos.y) * 0.4, -vMax, vMax);
    vy += (vyTarget - vy) * Math.min(1, dt * 0.8);
    pos.y += vy * dt;
    const pitch = Math.atan2(vy, Math.max(params.swimSpeed, 0.1));
    place(pos, bodyQuaternion(heading, pitch, -yawRate * 1.5, Q), dt); // se inclina al girar
    if (state.timeInState >= params.autoInterval) autoAction();
  }

  /** Siguiente acción automática del ciclo (respirar / saltar) según lo que esté activado. */
  function autoAction() {
    if (!params.autoJump && !params.autoBreath) return;
    for (let k = 0; k < AUTO_CYCLE.length; k++) {
      const a = AUTO_CYCLE[cycle % AUTO_CYCLE.length];
      cycle++;
      if (a === 'saltar' && params.autoJump) { jump(); return; }
      if (a === 'respirar' && params.autoBreath) { breathe(); return; }
    }
  }

  // ------------------------------------------------------------------ respiración
  function breathe() {
    if (!params.enabled || state.current !== 'nadar' || plan) return;
    plan = planBreath(pos.clone(), heading, waterState.waterLevel, params.swimSpeed, params);
    state.planTime = 0;
    state.planDuration = plan.duration;
    flags.blow = false;
    drawPlan();
    beginTransition();
    setState('subir');
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
    beginTransition();
    setState('preparar');
    anim.play('swim_fast', 1.0);
  }

  const P = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  function followPlan(dt) {
    state.planTime += dt;
    const t = state.planTime;
    const ph = plan.sample(Math.min(t, plan.duration), P, Q);
    // respiración en arco: el plan va referido al nivel medio del mar; con oleaje, el espiráculo
    // asomaría de más en un seno o nada en una cresta. Mientras dura el arqueo, la ballena sigue la
    // altura local del agua delante de ella (suavizada)
    if (plan.kind === 'breath' && getWaterHeight) {
      const a = plan.archAt ? plan.archAt(Math.min(t, plan.duration)) : null;
      const k = a && params.archFront > 0 ? a.front / (params.archFront * THREE.MathUtils.DEG2RAD) : 0;
      const hx = P.x + Math.sin(plan.heading) * 3.3, hz = P.z + Math.cos(plan.heading) * 3.3;
      const target = getWaterHeight(hx, hz) - waterState.waterLevel;
      waveOffset += (target - waveOffset) * Math.min(1, dt * 2.5);
      P.y += waveOffset * k;
    }
    place(P, Q, dt);
    if (ph.id !== state.current && t < plan.duration) setState(ph.id);
    if (plan.archAt) Object.assign(archNow, plan.archAt(Math.min(t, plan.duration)));
    if (plan.kind === 'breath') {
      if (!flags.blow && t >= plan.blowTime) { flags.blow = true; emit('blow'); }
      if (t >= plan.duration) endPlan();
      return;
    }

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

    if (t >= plan.duration) endPlan();
  }
  function endPlan() {
    // de vuelta a nadar desde el final del plan, con el mismo rumbo
    pos.copy(plan.R);
    heading = plan.heading;
    yawRate = 0;
    vy = 0;
    plan = null;
    updatePathVisibility();
    beginTransition();
    setState('nadar');
  }

  // arqueo del cuerpo (respiración en arco): se suma a la animación girando los huesos de la
  // columna sobre su eje lateral (X local). Delante (Head: el quiebro queda cerca del espiráculo;
  // el perfil de la cabeza es casi recto y sin él asomaba entera): cabeza hacia abajo (+);
  // detrás (Spine → Spine.007): cola hacia abajo (−). Se deshace antes de cada actualización del
  // mezclador por si algún hueso no lo reescribe.
  const boneByLabel = (n) => whale.skinned[0].skeleton.bones.find((b) => (b.userData.name ?? b.name) === n);
  const ARCH_BONES = [
    ...['Head'].map((n) => ({ bone: boneByLabel(n), part: 'front', sign: 1, share: 1 })),
    ...['Spine', 'Spine.001', 'Spine.002', 'Spine.008', 'Spine.007'].map((n) => ({ bone: boneByLabel(n), part: 'rear', sign: -1, share: 1 / 5 })),
  ].filter((a) => a.bone).map((a) => ({ ...a, pre: new THREE.Quaternion(), applied: false }));
  const archNow = { front: 0, rear: 0 };
  const AXIS_X = new THREE.Vector3(1, 0, 0), qArch = new THREE.Quaternion();
  function undoArch() {
    for (const a of ARCH_BONES) if (a.applied) { a.bone.quaternion.copy(a.pre); a.applied = false; }
  }
  function applyArch() {
    if (Math.abs(archNow.front) < 1e-4 && Math.abs(archNow.rear) < 1e-4) return;
    for (const a of ARCH_BONES) {
      a.pre.copy(a.bone.quaternion);
      a.bone.quaternion.multiply(qArch.setFromAxisAngle(AXIS_X, a.sign * a.share * archNow[a.part]));
      a.applied = true;
    }
  }

  // amplitud del aleteo: el clip de nado mueve la punta de la cola ±3 m; junto a la superficie la
  // aleta saldría del agua en cada brazada. Con peso < 1 el mezclador combina el clip con la pose de
  // reposo (brazada más corta). En el salto, peso completo. Cambia suavemente (sin saltos).
  const SWIM_CLIPS = ['swim_idle', 'swim_fast', 'Swim1', 'Swim2', 'Idle'].filter((n) => whale.actions[n]);
  let stroke = 1;
  function strokeWeight(dt) {
    let target = 1;
    if (!['preparar', 'saltar', 'caer'].includes(state.current)) {
      const depth = waterState.waterLevel - (hasLast ? lastP.y : pos.y);
      target = strokeAt(depth, params.surfaceStroke);
    }
    stroke += (target - stroke) * Math.min(1, dt * 1.5);
    for (const n of SWIM_CLIPS) whale.actions[n].weight = stroke;
  }

  function setEnabled(on) {
    params.enabled = on;
    if (!on) {
      plan = null;
      resetRoot();
      stroke = 1; // modo libre: clips con su amplitud original
      for (const n of SWIM_CLIPS) whale.actions[n].weight = 1;
      setState('nadar');
    } else {
      pos.set(0, waterState.waterLevel - params.depth, -25);
      heading = 0;
      hasLast = false;
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
    breathe,
    /** Altura del agua en (x, z) (con oleaje): la respiración en arco la sigue. */
    setWaterHeight(fn) { getWaterHeight = fn; },
    /** Reinicia el ciclo automático (respirar / saltar) desde el principio. */
    resetCycle() { cycle = 0; },
    setEnabled,
    apply() {
      setEnabled(params.enabled);
      if (plan) drawPlan();
      updatePathVisibility();
    },
    /** Recorre el plan de salto actual hasta el instante t (s desde el inicio del ascenso). */
    seek(t) {
      if (!plan) return;
      hasLast = false; blend.t = 1;
      if (plan.kind === 'breath') {
        state.planTime = THREE.MathUtils.clamp(t, 0, plan.duration - 1e-3);
        flags.blow = state.planTime >= plan.blowTime;
        const ph = plan.sample(state.planTime, P, Q);
        applyToRoot(P, Q);
        setState(ph.id);
        whale.mixer.update(0);
        return;
      }
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
      undoArch();
      if (params.enabled) strokeWeight(dt);
      anim.update(dt);
      archNow.front = 0; archNow.rear = 0;
      if (!params.enabled) return;
      state.timeInState += dt;
      if (state.current === 'nadar' && !plan) swim(dt);
      else if (plan) followPlan(dt);
      applyArch();
    },
    /** Arqueo aplicado ahora (rad): cabeza y parte trasera. */
    arch: archNow,
    /** Posición del centro de masas y rumbo actuales (para cámaras y ayudas). */
    getPose(outPos) {
      root.getWorldPosition(outPos);
      return plan ? plan.heading : heading;
    },
    G,
  };
}
