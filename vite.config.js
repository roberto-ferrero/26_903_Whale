import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Solo en desarrollo: POST /__capture?name=fase_3/mediodia con un data URL JPEG/PNG en el cuerpo
 * guarda la captura en .PLAN/docs/img/<name>.jpg|png (para documentar las fases).
 */
function capturePlugin() {
  return {
    name: 'whale-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
        if (!/^[a-z0-9_\-/]+$/i.test(name) || name.includes('..')) { res.statusCode = 400; res.end('nombre no válido'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const m = body.match(/^data:image\/(jpeg|png);base64,(.+)$/);
          if (!m) { res.statusCode = 400; res.end('se espera un data URL'); return; }
          const file = resolve('.PLAN/docs/img', `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, Buffer.from(m[2], 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [capturePlugin()],
});
