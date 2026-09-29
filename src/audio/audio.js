/**
 * Audio procedural (Fase 7.4, opcional). Todo se sintetiza con WebAudio (sin archivos):
 * - Oleaje: ruido filtrado con "respiración" lenta de las olas y siseo de crestas; más fuerte con
 *   mar más alto (Hs del océano).
 * - Impacto del salto: golpe grave + estallido de ruido que se cierra; salida: chapoteo.
 * - Respiración: soplido (ruido que se abre y se apaga en ~1,5 s) y, poco después, la inspiración.
 *   Se retrasan con la distancia: 343 m/s en el aire, 1500 m/s bajo el agua.
 * - Bajo el agua: todo pasa por un paso bajo (sonido apagado) y aparece un rumor grave; de vez en
 *   cuando, un canto de ballena (glissandos con vibrato y eco).
 * El navegador solo permite sonar tras un gesto del usuario: se activa desde la GUI.
 */
export function createAudio({ camera, fsm, ocean, under }) {
  const state = {
    enabled: false,
    volume: 0.6,
    ocean: 1,
    effects: 1,
    song: 0.6,
  };

  let ctx = null;
  let nodes = null;
  let songTimer = 6;

  function noiseBuffer(seconds = 4) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // ruido rosa aproximado (Paul Kellet)
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  function init() {
    ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = state.volume;
    // filtro "bajo el agua" para todo
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.connect(master);
    master.connect(ctx.destination);
    const noise = noiseBuffer();

    // oleaje: rumor filtrado + siseo de crestas
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const swellLP = ctx.createBiquadFilter();
    swellLP.type = 'lowpass';
    swellLP.frequency.value = 700;
    const swellGain = ctx.createGain();
    swellGain.gain.value = 0;
    src.connect(swellLP).connect(swellGain).connect(muffle);
    const src2 = ctx.createBufferSource();
    src2.buffer = noise;
    src2.loop = true;
    src2.playbackRate.value = 1.37;
    const hissHP = ctx.createBiquadFilter();
    hissHP.type = 'highpass';
    hissHP.frequency.value = 2500;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    src2.connect(hissHP).connect(hissGain).connect(muffle);
    // rumor submarino
    const src3 = ctx.createBufferSource();
    src3.buffer = noise;
    src3.loop = true;
    src3.playbackRate.value = 0.5;
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = 160;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    src3.connect(rumbleLP).connect(rumbleGain).connect(master);
    // eco para el canto
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.45;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    delay.connect(master);
    src.start(); src2.start(); src3.start();
    nodes = { master, muffle, swellGain, swellLP, hissGain, rumbleGain, noise, delay };
  }

  function burst({ when, gain, from, to, dur, thump }) {
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = nodes.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(nodes.muffle);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.1);
    if (thump) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.8);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(gain * thump, t + 0.015);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(og).connect(nodes.master);
      o.start(t);
      o.stop(t + 1.1);
    }
  }

  function song() {
    const t = ctx.currentTime;
    const dur = 2 + Math.random() * 2.5;
    const f0 = 120 + Math.random() * 120, f1 = f0 * (1.5 + Math.random() * 1.5), f2 = f0 * (0.7 + Math.random() * 0.5);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4 + Math.random() * 3;
    const vibG = ctx.createGain();
    vibG.gain.value = f0 * 0.04;
    vib.connect(vibG).connect(o.frequency);
    const h = ctx.createOscillator(); // armónico
    h.type = 'triangle';
    h.frequency.setValueAtTime(f0 * 2, t);
    h.frequency.exponentialRampToValueAtTime(f1 * 2, t + dur * 0.45);
    h.frequency.exponentialRampToValueAtTime(f2 * 2, t + dur);
    const g = ctx.createGain();
    const peak = 0.12 * state.song;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.4);
    g.gain.setValueAtTime(peak, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const hg = ctx.createGain();
    hg.gain.value = 0.25;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    o.connect(g);
    h.connect(hg).connect(g);
    g.connect(lp);
    lp.connect(nodes.master);
    lp.connect(nodes.delay);
    [o, h, vib].forEach((n) => { n.start(t); n.stop(t + dur + 0.1); });
  }

  // eventos del salto
  fsm.on((name) => {
    if (!state.enabled || !ctx || (name !== 'impact' && name !== 'surface_exit' && name !== 'blow')) return;
    const p = new camera.position.constructor();
    fsm.getPose(p); // escribe la posición (devuelve el rumbo)
    const d = p.distanceTo(camera.position);
    const speed = under.underwater ? 1500 : 343;
    const att = 1 / (1 + d / 25);
    if (name === 'impact') burst({ when: d / speed, gain: 0.9 * att * state.effects, from: 5000, to: 200, dur: 1.8, thump: 1.2 });
    else if (name === 'blow') {
      // soplido: fuerte y áspero; la inspiración, más corta y suave (bajo el agua casi no se oye)
      const g = (under.underwater ? 0.25 : 1) * att * state.effects;
      burst({ when: d / speed, gain: 0.6 * g, from: 2600, to: 450, dur: 1.6, thump: 0.15 });
      burst({ when: d / speed + 1.9, gain: 0.25 * g, from: 700, to: 1600, dur: 1.1 });
    } else burst({ when: d / speed, gain: 0.35 * att * state.effects, from: 3000, to: 600, dur: 0.9 });
  });

  let t = 0;
  return {
    state,
    apply() {
      if (state.enabled && !ctx) init();
      if (ctx) {
        if (state.enabled && ctx.state === 'suspended') ctx.resume();
        if (!state.enabled && ctx.state === 'running') ctx.suspend();
        nodes.master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.1);
      }
    },
    update(dt) {
      if (!ctx || !state.enabled) return;
      t += dt;
      const now = ctx.currentTime;
      const uw = under.underwater;
      // olas: "respiración" lenta (dos periodos) y nivel según la altura del mar
      const hs = Math.min(ocean.state.windSpeed / 12 + ocean.state.swellHeight / 3, 2);
      const breath = 0.55 + 0.25 * Math.sin(t * 0.9) + 0.2 * Math.sin(t * 0.37 + 1.3);
      const level = state.ocean * (0.25 + 0.35 * hs) * breath;
      nodes.swellGain.gain.setTargetAtTime(uw ? level * 0.5 : level, now, 0.2);
      nodes.hissGain.gain.setTargetAtTime(uw ? 0 : level * 0.35 * Math.max(0, Math.sin(t * 0.9 + 0.8)), now, 0.15);
      nodes.rumbleGain.gain.setTargetAtTime(uw ? 0.35 * state.ocean : 0, now, 0.3);
      nodes.muffle.frequency.setTargetAtTime(uw ? 380 : 20000, now, 0.08);
      // canto de ballena bajo el agua
      if (uw && state.song > 0) {
        songTimer -= dt;
        if (songTimer <= 0) { song(); songTimer = 7 + Math.random() * 10; }
      }
    },
  };
}
