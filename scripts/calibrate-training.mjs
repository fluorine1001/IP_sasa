// Author-only calibration. Prints a candidate, never writes stage files or ships to players.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { createRun, tick, execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const { eccentricity } = await server.ssrLoadModule('/src/physics/orbit.ts');
  const { compileOutcome } = await server.ssrLoadModule('/src/stages/outcomes.ts');
  const stage = JSON.parse(
    await readFile('data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json', 'utf8'),
  );
  stage.rules.maxTime = 70;
  stage.goals[0].endTime = 70;
  const bounds = [
    [0.48, 0.9],
    [0.05, 0.8],
    [0.6, 3],
    [40, 105],
    [0.08, 0.7],
    [95, 190],
    [0.15, 2],
  ];
  const direction = (angle) => ({
    x: Math.cos((angle * Math.PI) / 180),
    y: Math.sin((angle * Math.PI) / 180),
  });
  function plan(x) {
    const values = x.map((n, i) => bounds[i][0] + n * (bounds[i][1] - bounds[i][0]));
    const [power, turn, sep, angle, output, upperAngle, delay] = values;
    const command = (id, time, value) => ({ id, time, actorId: 'craft', ...value });
    return {
      launch: { x: power, y: 0 },
      impulses: [],
      engineCommands: [
        command('train-turn', turn, { direction: direction(angle) }),
        command('train-separate', sep, { separate: true }),
        command('train-ignite', sep + 0.05, { throttle: output }),
        command('train-adjust', sep + 0.05, { direction: direction(upperAngle) }),
        command('train-stop', sep + 0.05 + delay, { throttle: 0 }),
      ],
    };
  }
  const dummy = structuredClone(stage);
  dummy.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 1000 },
  };
  function score(x) {
    const p = plan(x),
      run = createRun(dummy, p);
    const end = p.engineCommands.at(-1).time + 2;
    while (run.status === 'running' && run.time < end - 1e-8)
      tick(run, dummy, Math.min(0.1, end - run.time), dummy.objects, false);
    if (run.status !== 'running') return 10 + end - run.time;
    const e = eccentricity(run, stage.bodies[0].mu),
      r = Math.hypot(run.position.x, run.position.y),
      v2 = run.velocity.x ** 2 + run.velocity.y ** 2,
      E = v2 / 2 - stage.bodies[0].mu / r,
      a = -stage.bodies[0].mu / (2 * E),
      peri = a * (1 - e),
      apo = a * (1 + e);
    return e + Math.max(0, 0.9 - peri) * 5 + Math.max(0, apo - 1.7) * 5 + (E >= 0 ? 5 : 0);
  }
  let seed = 102;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let best = { x: [0.4, 0.2, 0.4, 0.8, 0.4, 0.5, 0.4], score: Infinity };
  for (let restart = 0; restart < 36; restart++) {
    let x = restart === 0 ? best.x.slice() : Array.from({ length: 7 }, random),
      value = score(x),
      step = 0.18;
    let rounds = 0;
    while (step > 0.0015 && rounds++ < 250) {
      let improved = false;
      for (let i = 0; i < 7; i++)
        for (const sign of [-1, 1]) {
          const candidate = x.slice();
          candidate[i] = Math.max(0, Math.min(1, candidate[i] + step * sign));
          const cost = score(candidate);
          if (cost < value) {
            x = candidate;
            value = cost;
            improved = true;
          }
        }
      if (!improved) step *= 0.55;
    }
    if (value < best.score) {
      best = { x, score: value };
      console.log('improvement', restart, value);
    }
    if (best.score < 0.025) break;
  }
  const result = compileOutcome(stage, {
    kind: 'circular',
    targetId: stage.bodies[0].id,
    min: 0.85,
    max: 1.8,
    eccentricity: 0.2,
    duration: 4,
  });
  stage.goals[0].condition = {
    kind: 'sequence',
    children: [
      { kind: 'event', event: 'separation', targetId: stage.rocket.parts[0].id },
      result.condition,
    ],
  };
  stage.goals[0].display = result.display;
  const candidate = plan(best.x);
  candidate.launch.x = Math.round(candidate.launch.x * 20) / 20;
  for (const command of candidate.engineCommands) {
    command.time = Math.round(command.time * 20) / 20;
    if (command.throttle) command.throttle = Math.round(command.throttle * 20) / 20;
    if (command.direction)
      command.direction = direction(
        Math.round((Math.atan2(command.direction.y, command.direction.x) * 180) / Math.PI / 5) * 5,
      );
  }
  const run = execute(stage, candidate, true);
  console.log(
    JSON.stringify(
      {
        score: best.score,
        plan: candidate,
        goal: stage.goals[0],
        status: run.status,
        time: run.time,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
