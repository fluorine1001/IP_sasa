import { defineConfig, type Plugin } from 'vite';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
function stageWorkshop(): Plugin {
  return {
    name: 'local-stage-workshop',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/stages', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const reject = (code: number, error: string) => {
          res.statusCode = code;
          res.end(JSON.stringify({ error }));
        };
        if (req.method !== 'POST') return reject(405, 'POST only');
        const address = req.socket.remoteAddress ?? '',
          host = req.headers.host ?? '';
        if (
          !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) ||
          req.headers.origin !== `http://${host}` ||
          !req.headers['content-type']?.startsWith('application/json')
        )
          return reject(403, 'Local same-origin editor only');
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 1_000_000) return reject(413, 'Stage too large');
          }
          const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
          const stage = parseStage(JSON.parse(body)),
            directory = path.resolve(server.config.root, 'data/stages'),
            file = path.join(directory, `${stage.id}.json`),
            temporary = path.join(directory, `${stage.id}.json.pending`);
          await mkdir(directory, { recursive: true });
          await writeFile(temporary, JSON.stringify(stage, null, 2) + '\n');
          await rename(temporary, file);
          res.end(JSON.stringify({ ok: true, id: stage.id }));
        } catch (error) {
          reject(400, error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}
export default defineConfig({
  plugins: [stageWorkshop()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
