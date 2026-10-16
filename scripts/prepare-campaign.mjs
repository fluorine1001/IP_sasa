// Emits a reviewable JSON change-set; NEVER writes files, publishes or touches a server.
// Deterministic IDs preserve edits/records across regeneration. Apply through file review.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
const changes = [];
async function propose(file, value) {
  let before;
  try {
    before = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const after = JSON.stringify(value, null, 2) + '\n';
  if (before !== after) changes.push({ file, before, after });
}
try {
  const { complexMissions } = await runtime.ssrLoadModule('/tests/fixtures/complex-missions.ts'),
    { parseStage } = await runtime.ssrLoadModule('/src/stages/validation.ts'),
    { compileOutcome } = await runtime.ssrLoadModule('/src/stages/outcomes.ts'),
    { compileMarker } = await runtime.ssrLoadModule('/src/stages/goal-marker.ts'),
    { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const manifest = JSON.parse(await readFile('data/campaign-cases.json', 'utf8')),
    cases = complexMissions(),
    counterexamples = {};
  for (const [i, item] of manifest.entries()) {
    const source = cases.find((c) => c.id === item.case);
    if (!source) throw Error('Unknown campaign case ' + item.case);
    const s = source.stage,
      ids = new Map([[s.id, item.id]]);
    const groups = [s.bodies, s.objects, s.goals, s.rocket?.parts ?? [], s.rocket?.payloads ?? []];
    for (const [kind, entities] of groups.entries())
      for (const [n, entity] of entities.entries()) {
        const digest = createHash('sha256').update(`${item.id}/${kind}/${n}`).digest('hex'),
          hex = digest.slice(0, 12) + '5' + digest.slice(13, 16) + '8' + digest.slice(17, 32),
          id =
            hex.slice(0, 8) +
            '-' +
            hex.slice(8, 12) +
            '-' +
            hex.slice(12, 16) +
            '-' +
            hex.slice(16, 20) +
            '-' +
            hex.slice(20);
        ids.set(entity.id, id);
      }
    const remap = (value) =>
      typeof value === 'string'
        ? (ids.get(value) ?? value)
        : Array.isArray(value)
          ? value.map(remap)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]))
            : value;
    const stage = remap(s),
      witness = remap(source.witness),
      negative = remap(source.negative);
    stage.title = item.title;
    stage.description = item.description;
    stage.order = 9 + i;
    stage.published = item.published;
    stage.referencePlans = [witness];
    delete stage.randomization;
    stage.bodies.forEach((b, n) => {
      b.name = n ? '달' : b.kind === 'star' ? '중심별' : '행성 아라';
      b.hiddenGravity = false;
      b.estimateMu = b.mu;
    });
    stage.objects.forEach((o) => {
      if (o.kind === 'station') o.name = '궤도 정거장';
    });
    if (stage.goals.length !== item.goals.length) throw Error('Goal title count changed');
    for (const [n, goal] of stage.goals.entries()) {
      goal.title = item.goals[n];
      if (goal.outcome?.kind === 'circular')
        Object.assign(goal, compileOutcome(stage, { ...goal.outcome, eccentricity: undefined }));
      if (goal.marker) Object.assign(goal, compileMarker(stage, goal));
    }
    parseStage(stage);
    if (execute(stage, witness).status !== 'won')
      throw Error(item.case + ': feasibility flight failed');
    for (const plan of negative)
      if (execute(stage, plan).status === 'won')
        throw Error(item.case + ': missing-process counterexample passed');
    counterexamples[item.id] = negative;
    await propose('data/stages/' + item.id + '.json', stage);
    await propose(
      'data/releases/' + item.id + '.json',
      item.published ? { ...stage, referencePlans: [] } : null,
    );
  }
  await propose('tests/fixtures/campaign-counterexamples.json', counterexamples);
  for (const id of [
    'aefa2afd-1717-4954-9413-a63c077320e8',
    'a0cbdf82-660a-4e97-8033-00e0cc0f4c0a',
  ]) {
    const file = 'data/stages/' + id + '.json',
      raw = JSON.parse(await readFile(file, 'utf8'));
    if (id === 'aefa2afd-1717-4954-9413-a63c077320e8') {
      try {
        await readFile('tests/fixtures/legacy-orbit-band-goal.json', 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await propose('tests/fixtures/legacy-orbit-band-goal.json', raw.goals[0]);
      }
    }
    const stage = parseStage(raw);
    await propose(file, stage);
    await propose('data/releases/' + id + '.json', { ...stage, referencePlans: [] });
  }
  const file = process.argv.find((arg) => arg.startsWith('--file='))?.slice(7);
  if (file) {
    const change = changes.find((c) => c.file === file);
    if (!change) throw Error('No pending change: ' + file);
    console.log(JSON.stringify(change));
  } else console.log(JSON.stringify(changes.map((c) => ({ file: c.file, bytes: c.after.length }))));
} finally {
  await runtime.close();
}
