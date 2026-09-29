/** Panel de estadísticas (FPS, llamadas de dibujo, triángulos, LOD y clip). */
export function createStats(container, backend) {
  const el = document.createElement('div');
  el.className = 'stats';
  container.appendChild(el);
  let frames = 0;
  let last = performance.now();
  let fps = 0;

  // oculto por defecto (29/09/2026): se muestra con las ayudas (tecla B) o en Depuración
  const state = { visible: false };
  const apply = () => { el.style.display = state.visible ? '' : 'none'; };
  apply();

  return {
    el,
    state,
    apply,
    update(renderer, extra) {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        fps = (frames * 1000) / (now - last);
        frames = 0;
        last = now;
      }
      const r = renderer.info.render;
      el.textContent = [
        `${backend} · ${fps.toFixed(0)} fps`,
        `draw calls ${r.drawCalls ?? r.calls ?? '-'} · triángulos ${(r.triangles ?? 0).toLocaleString('es-ES')}`,
        extra,
      ].join('\n');
    },
  };
}
