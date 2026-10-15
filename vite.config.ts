import { defineConfig, type Plugin } from 'vite';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { workshopApi } from './scripts/workshop-api';
import { publicationAuditor } from './scripts/workshop-auditor';
import { readStageRelease } from './scripts/stage-release';
function stageWorkshop(): Plugin {
  return {
    name: 'local-stage-workshop',
    apply: 'serve',
    handleHotUpdate({ file }) {
      // Stage writes are data, not code edits. Reloading the editor here drops
      // its open library and tab-only credentials during a rename/save. Public
      // menus read the live API; manual reload still refreshes bundled imports.
      if (/\/data\/(stages|releases)\/[^/]+\.json$/.test(file.replace(/\\/g, '/'))) return [];
    },
    configureServer(server) {
      let handler: ReturnType<typeof workshopApi> | undefined;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/stages') && !req.url?.startsWith('/api/workshop/stages'))
          return next();
        if (!handler) {
          const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
          handler = workshopApi(
            server.config.root,
            parseStage,
            publicationAuditor(server.config.root),
          );
        }
        await handler(req, res);
      });
      server.middlewares.use('/__dev/stages', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const reject = (code: number, error: string) => {
          res.statusCode = code;
          res.end(JSON.stringify({ error }));
        };
        if (req.method !== 'POST') return reject(405, 'POST only');
        if (process.env.STAGE_EDITOR_TOKEN)
          return reject(403, 'Use the authenticated workshop API');
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
export function playerStages(root = process.cwd()): Plugin {
  return {
    name: 'player-stages-without-proofs',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    async transform(code, id) {
      if (!id.replace(/\\/g, '/').includes('/data/stages/') || !id.endsWith('.json')) return;
      let stage = JSON.parse(code);
      // Editable source and the last audited release are separate documents.
      // A draft save must not withdraw/replace the stage in the offline build.
      if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stage.id)) {
        const snapshot = await readStageRelease(root, stage.id);
        if (snapshot) {
          if (snapshot.raw === null) stage.published = false;
          else {
            const release = JSON.parse(snapshot.raw);
            if (release.id !== stage.id || release.published === false)
              throw Error('Invalid published stage snapshot: ' + stage.id);
            stage = release;
          }
        }
      }
      stage.referencePlans = [];
      delete stage.randomization;
      return { code: JSON.stringify(stage), map: null };
    },
  };
}
export default defineConfig({
  plugins: [playerStages(), stageWorkshop()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
