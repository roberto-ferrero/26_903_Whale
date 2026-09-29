import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Solo en desarrollo: POST /__save guarda documentación generada; POST /__capture?name=fase_3/mediodia con un data URL JPEG/PNG en el cuerpo
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
      // POST /__save?name=parametros con texto en el cuerpo → .PLAN/docs/<name>.md (documentación generada)
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
        if (!/^[a-z0-9_\-]+$/i.test(name)) { res.statusCode = 400; res.end('nombre no válido'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const file = resolve('.PLAN/docs', `${name}.md`);
          writeFileSync(file, body);
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  // rutas relativas: el build funciona en cualquier subruta (GitHub Pages, Netlify, Vercel…) (Fase 8.3)
  base: './',
  plugins: [capturePlugin()],
  build: {
    target: 'es2022', // await en el nivel superior (main.js)
    chunkSizeWarningLimit: 2000, // three/webgpu es grande por sí solo
  },
});
