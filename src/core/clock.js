/**
 * Reloj de simulación (Fase 2.1): separa el tiempo real del tiempo simulado.
 * - `timeScale` < 1 = cámara lenta; `paused` congela la simulación (la cámara sigue).
 * - `step()` avanza un fotograma estando en pausa (depuración).
 * Todo lo que se simula (animaciones, trayectorias, eventos) debe usar `dt` de `tick()`.
 */
export function createSimClock() {
  const state = {
    paused: false,
    timeScale: 1,
    stepSize: 1 / 30,
    // lecturas
    time: 0,
    frame: 0,
  };
  let pendingStep = 0;

  return {
    state,
    /** @param {number} realDt segundos reales desde el fotograma anterior */
    tick(realDt) {
      let dt;
      if (pendingStep) {
        dt = pendingStep;
        pendingStep = 0;
      } else {
        dt = state.paused ? 0 : realDt * state.timeScale;
      }
      state.time += dt;
      if (dt > 0) state.frame++;
      return dt;
    },
    step() {
      state.paused = true;
      pendingStep = state.stepSize;
    },
    togglePause() {
      state.paused = !state.paused;
    },
    apply() {},
  };
}
