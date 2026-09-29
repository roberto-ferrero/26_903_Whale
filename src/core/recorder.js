/**
 * Grabación a vídeo (Fase 8.4, opcional): graba el canvas con MediaRecorder (WebM, VP9 si el
 * navegador lo tiene) y descarga el archivo al parar. La cámara lenta se hace con la velocidad del
 * tiempo (carpeta Tiempo): se graba en tiempo real, así que para máxima calidad conviene el perfil
 * Ultra con el ordenador sin otras tareas.
 */
export function createRecorder({ canvas }) {
  const state = {
    fps: 60,
    bitrate: 40, // Mbit/s
    status: 'listo',
  };
  let rec = null, chunks = [], t0 = 0, timer = null, track = null;
  // captureStream(0) + requestFrame() tras cada render: un fotograma de vídeo por fotograma dibujado
  // (también si la pestaña no se está pintando)
  const open = () => { const s = canvas.captureStream(0); track = s.getVideoTracks()[0]; return s; };

  function pickType() {
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
  }

  function start() {
    if (!window.MediaRecorder || !canvas.captureStream) { state.status = 'este navegador no puede grabar el canvas'; return false; }
    const mimeType = pickType();
    const stream = open();
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: state.bitrate * 1e6 });
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `ballena_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      state.status = `guardado (${(blob.size / 1e6).toFixed(1)} MB)`;
      stream.getTracks().forEach((t) => t.stop());
      track = null;
    };
    rec.start(1000);
    t0 = performance.now();
    timer = setInterval(() => { state.status = `grabando ${((performance.now() - t0) / 1000).toFixed(0)} s`; }, 500);
    state.status = 'grabando…';
    return true;
  }

  function stop() {
    clearInterval(timer);
    if (rec && rec.state !== 'inactive') rec.stop();
    rec = null;
  }

  return {
    state,
    get recording() { return !!rec; },
    toggle() { if (rec) stop(); else start(); return !!rec; },
    /** Llamar justo después de dibujar cada fotograma. */
    frame() { track?.requestFrame?.(); },
    /** Pruebas: graba `ms` milisegundos y devuelve el tamaño del vídeo (bytes) sin descargarlo. */
    async test(ms = 1500) {
      const stream = open();
      const r = new MediaRecorder(stream, { mimeType: pickType(), videoBitsPerSecond: state.bitrate * 1e6 });
      const parts = [];
      r.ondataavailable = (e) => parts.push(e.data);
      const done = new Promise((res) => { r.onstop = res; });
      r.start();
      await new Promise((res) => setTimeout(res, ms));
      r.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      track = null;
      return { type: r.mimeType, bytes: parts.reduce((s, p) => s + p.size, 0) };
    },
  };
}
