import { REVISION } from 'three/webgpu';

/**
 * Interfaz de presentación (29/09/2026, diseño a partir del visor de Blade Runner / Estudio 01):
 * - cabecera con el proyecto y el título (izquierda) y el backend (derecha);
 * - cortina azul oscuro con un recuadro de estado (mensaje de cada paso de la inicialización y barra
 *   de progreso) que se funde a la animación cuando la imagen se ha estabilizado;
 * - pie con las métricas del render (FPS, ms por fotograma, resolución, dibujos, triángulos, calidad).
 * Las bandas negras de cine (2,4:1) las hace el visor, que dibuja solo en esa franja.
 */
export function createUi(container, backend) {
  const root = document.createElement('section');
  root.className = 'whale-ui';
  root.setAttribute('aria-label', 'Visor de la ballena');
  root.innerHTML = `
    <div class="whale-cover"></div>
    <header>
      <div>
        <span class="whale-eyebrow">PROJECT 26903_WHALE / ESTUDIO 01</span>
        <h1>Humpback Whale Simulation</h1>
      </div>
      <span class="whale-backend"></span>
    </header>
    <div class="whale-status" role="status" aria-live="polite">
      <p class="whale-status-text">Iniciando…</p>
      <div class="whale-progress" aria-hidden="true"><div class="whale-progress-fill"></div></div>
    </div>
    <footer><p class="whale-metrics">Preparando la primera imagen…</p></footer>`;
  container.appendChild(root);

  const cover = root.querySelector('.whale-cover');
  const status = root.querySelector('.whale-status');
  const text = root.querySelector('.whale-status-text');
  const fill = root.querySelector('.whale-progress-fill');
  const metrics = root.querySelector('.whale-metrics');
  const backendEl = root.querySelector('.whale-backend');
  const setBackend = (b) => { backendEl.textContent = `${b} · Three.js r${REVISION}`; };
  setBackend(backend ?? 'WebGPU');

  // espera a que el navegador pinte (los pasos de la carga son síncronos entre `await`); con la
  // pestaña en segundo plano no hay requestAnimationFrame: como mucho 60 ms
  const paint = () => new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(r));
    setTimeout(r, 60);
  });

  return {
    root,
    setBackend,
    /** Mensaje y progreso (0-1) de la inicialización; espera a que se vea. */
    async step(message, progress) {
      text.textContent = message;
      if (progress !== undefined) fill.style.width = `${Math.round(progress * 100)}%`;
      await paint();
    },
    /** Error de carga: el mensaje (HTML) queda en el recuadro. */
    error(html) {
      text.innerHTML = html;
      status.classList.add('whale-status-error');
    },
    /** Quita el recuadro y funde la cortina azul a la animación. */
    reveal(seconds = 2.2) {
      fill.style.width = '100%';
      status.classList.add('whale-hidden');
      cover.style.transition = `opacity ${seconds}s ease-in-out`;
      cover.style.opacity = '0';
      setTimeout(() => cover.remove(), seconds * 1000 + 100);
    },
    /** Línea del pie con las métricas. */
    setMetrics(line) { metrics.textContent = line; },
  };
}
