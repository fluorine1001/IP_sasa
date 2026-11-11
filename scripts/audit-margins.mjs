// Fairness margin of every published mission (src/stages/margin.ts): the reference plan
// must still win when any one value moves by the precision a player can reason to.
import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  const { planMargin, MARGIN } = await server.ssrLoadModule('/src/stages/margin.ts');
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const only = process.argv
    .find((a) => a.startsWith('--order='))
    ?.slice(8)
    .split(',')
    .map(Number);
  console.log(
    `여유 기준: 시각 ±${MARGIN.time}초 · Δv ±max(${MARGIN.dv}, ${MARGIN.dvShare * 100}%) · 각도 ±${MARGIN.angle}° · 발사 세기 ±${MARGIN.launchPower * 100}% · 냉가스 발사 방향 ±${MARGIN.launchAngle}°`,
  );
  let failed = false;
  // Published stages that do not meet the rule yet, each with the redesign it needs. They
  // are reported, never hidden; a stage published from the workshop gets no such entry.
  const debt = JSON.parse(await readFile('data/margin-debt.json', 'utf8'));
  const stages = [];
  for (const file of await readdir('data/stages'))
    if (file.endsWith('.json'))
      stages.push(parseStage(JSON.parse(await readFile(`data/stages/${file}`, 'utf8'))));
  for (const stage of stages.sort((a, b) => a.order - b.order)) {
    if (stage.published === false || stage.track === 'tutorial') continue;
    if (only && !only.includes(stage.order)) continue;
    const plan = stage.referencePlans[0];
    if (!plan) {
      console.log(`${stage.order}. ${stage.title}: 기준 계획 없음`);
      failed = true;
      continue;
    }
    if (execute(stage, plan).status !== 'won') {
      console.log(`${stage.order}. ${stage.title}: 기준 계획이 성공하지 않음`);
      failed = true;
      continue;
    }
    // Early choices need only be roughly right when the final correction can be re-aimed.
    const checks = planMargin(stage, plan, { reaimLast: true });
    const bad = checks.filter((c) => !c.won);
    const reaimed = checks.filter((c) => c.reaimed).length;
    console.log(
      `${stage.order}. ${stage.title}: ${checks.length - bad.length}/${checks.length}` +
        (reaimed ? ` (마지막 수정으로 다시 맞춤 ${reaimed})` : '') +
        (bad.length ? ` · 실패 ${bad.map((c) => c.knob + ' ' + c.delta).join(', ')}` : ' · 통과'),
    );
    if (bad.length && debt[stage.id]) console.log(`   알려진 과제: ${debt[stage.id]}`);
    else if (bad.length) failed = true;
    else if (debt[stage.id])
      console.log(
        '   알려진 과제 목록에 있지만 이제 통과합니다: data/margin-debt.json에서 지우세요.',
      );
  }
  if (failed) process.exitCode = 1;
} finally {
  await server.close();
}
