// Keep every published release equal to its stage draft without reference plans
// (tests/campaign.test.ts checks this). Unpublished releases (null) are left as they are.
import { readdir, readFile, writeFile } from 'node:fs/promises';
for (const file of await readdir('data/releases')) {
  if (!file.endsWith('.json')) continue;
  const release = JSON.parse(await readFile(`data/releases/${file}`, 'utf8'));
  if (release === null) continue;
  const stage = JSON.parse(await readFile(`data/stages/${file}`, 'utf8'));
  stage.referencePlans = stage.referencePlans.slice(0, 1);
  await writeFile(`data/stages/${file}`, JSON.stringify(stage, null, 2) + '\n');
  await writeFile(
    `data/releases/${file}`,
    JSON.stringify({ ...stage, referencePlans: [] }, null, 2) + '\n',
  );
  console.log('동기화', stage.title);
}
