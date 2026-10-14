import { build } from 'vite';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function buildOffline(root, destination = path.join(root, 'dist/play.html')) {
  // Reuse the production config: author proofs and the DEV editor must still be removed.
  const result = await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    publicDir: false,
    build: {
      write: false,
      cssCodeSplit: false,
      lib: {
        entry: path.join(root, 'src/main.ts'),
        name: 'OrbitEvidence',
        formats: ['iife'],
        fileName: 'play',
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  const chunks = output.filter((item) => item.type === 'chunk');
  const assets = output.filter((item) => item.type === 'asset');
  if (
    chunks.length !== 1 ||
    chunks[0].imports.length ||
    chunks[0].dynamicImports.length ||
    assets.some((item) => !item.fileName.endsWith('.css'))
  )
    throw new Error('Offline build must contain one script and inline CSS only.');
  const css = assets.map((item) => String(item.source)).join('\n');
  if (/url\(\s*['"]?(?!data:|#)[^'"\s)]/i.test(css))
    throw new Error('Offline CSS contains a non-inline asset URL. Import the asset instead.');
  let html = await readFile(path.join(root, 'index.html'), 'utf8');
  const entry = /<script\b[^>]*src="\/src\/main\.ts"[^>]*><\/script>/g;
  if ([...html.matchAll(entry)].length !== 1) throw new Error('Expected exactly one game entry.');
  // A stage description containing </script> must not break out of the inline bundle.
  html = html.replace(
    entry,
    () => '<script>' + chunks[0].code.replace(/<\/script/gi, '<\\/script') + '</script>',
  );
  html = html.replace(
    '</head>',
    () => '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style></head>',
  );
  await mkdir(path.dirname(destination), { recursive: true });
  const pending = destination + '.pending';
  await writeFile(pending, html, 'utf8');
  await rename(pending, destination);
  console.log('Offline game: ' + destination);
  return destination;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await buildOffline(root);
}
