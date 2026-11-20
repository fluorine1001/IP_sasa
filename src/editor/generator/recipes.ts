import type { GenerationRequest } from './protocol';
import type { Recipe } from './templates';
import { environmentNames, type EnvironmentKind } from './environments';

/** Count is independent of difficulty. Orientations and scales alone never define diversity. */
export function makeRecipe(
  request: GenerationRequest,
  index: number,
  random: () => number,
): Recipe {
  const difficulty = request.difficulty ?? 'easy';
  if (request.kind === 'gravity-assist' || request.kind === 'free-return') {
    const profiles =
      request.kind === 'free-return'
        ? [
            [5.5, 1, -10],
            [5.5, 1, 0],
            [5.5, 1, 20],
            [5.5, 1, 30],
            [5.5, 1, 35],
            [5.5, 0.7, -10],
            [5.5, 0.7, 15],
            [6.5, 1, -5],
          ]
        : [
            [3.5, 0.5, 270],
            [4.5, 0.3, 25],
            [4.5, 0.5, 40],
            [5.5, 0.7, 70],
            [4.5, 0.5, 35],
            [6.5, 0.5, 65],
            [3.5, 0.3, 60],
            [5.5, 0.5, 45],
          ];
    const [distance, mass, phase] = profiles[(index + request.seed) % profiles.length],
      hand = random() < 0.5 ? -1 : 1;
    return {
      kind: request.kind,
      difficulty,
      margin: request.margin,
      radius: 1,
      clock: 2.5,
      launchAngle: random() * Math.PI * 2,
      targetAngle: hand * 0.1,
      targetRadius: 1.5,
      planetCount: 2,
      environment:
        request.environment === 'mixed'
          ? index % 2
            ? 'moon'
            : 'planetary'
          : ((request.environment as EnvironmentKind) ?? 'planetary'),
      planets: [{ distance, mass, angle: 0, radius: 0.19 }],
      encounter: { distance, mass, phase: (phase * Math.PI) / 180, hand },
    };
  }
  let planetCount =
    request.planetCount === 'auto' || request.planetCount === undefined
      ? 1 + ((index + Math.floor(index / 3) + (request.seed % 3)) % 3)
      : request.planetCount;
  if (request.planetCount === 'auto' || request.planetCount === undefined) {
    if (request.environment === 'binary') planetCount = 3;
    else if (request.environment && !['planetary', 'mixed'].includes(request.environment))
      planetCount = Math.max(2, planetCount);
  }
  const environment: EnvironmentKind =
    request.environment === 'mixed'
      ? planetCount === 1
        ? 'planetary'
        : (Object.keys(environmentNames).filter((e) => e !== 'binary' || planetCount === 3)[
            (index + Math.floor(index / 5) + request.seed) % (planetCount === 3 ? 5 : 4)
          ] as EnvironmentKind)
      : (request.environment ?? 'planetary');
  const kind = request.kind === 'mixed' ? (index % 2 ? 'relay' : 'survey') : request.kind;
  const launchAngle = random() * Math.PI * 2;
  const sign = random() < 0.5 ? -1 : 1;
  const degrees =
    difficulty === 'easy'
      ? 3 + random() * 31
      : difficulty === 'normal'
        ? 50 + random() * 45
        : 115 + random() * 55;
  let targetRadius =
    difficulty === 'easy'
      ? 1.4 + random() * 0.45
      : difficulty === 'normal'
        ? 1.6 + random() * 0.55
        : 1.5 + random() * 0.65;
  if (kind === 'relay' && difficulty === 'easy') targetRadius = 1.9 + random() * 0.4;
  if (planetCount > 1 && difficulty === 'easy')
    targetRadius = (kind === 'relay' ? 2.5 : 2.15) + random() * 0.45;
  const planets: Recipe['planets'] = [];
  for (let i = 0; i < planetCount - 1; i++) {
    let placement;
    for (let attempt = 0; attempt < 8; attempt++) {
      placement = {
        angle:
          launchAngle +
          ((sign * degrees * Math.PI) / 180) * (0.35 + i * 0.4) +
          (i ? -0.6 : 0.6) +
          (random() - 0.5) * 0.25,
        distance: 2.05 + random() * 0.75,
        radius: 0.16 + random() * 0.13,
        mass: 0.35 + random() * 0.55,
      };
      if (
        planets.every(
          (p) =>
            Math.hypot(
              p.distance * Math.cos(p.angle) - placement!.distance * Math.cos(placement!.angle),
              p.distance * Math.sin(p.angle) - placement!.distance * Math.sin(placement!.angle),
            ) >
            p.radius + placement!.radius + 0.3,
        )
      )
        break;
      if (attempt === 7) placement.angle = planets[0].angle + Math.PI;
    }
    planets.push(placement!);
  }
  if (environment === 'moon' && planets[0]) {
    planets[0].distance = 3.4 + random() * 0.4;
    planets[0].radius = 1.3;
    planets[0].mass = 3.5 + random() * 2;
  }
  if (environment === 'stellar' && planets[0]) planets[0].mass *= 2.5;
  if (environment === 'black-hole' && planets[0]) planets[0].mass *= 2;
  return {
    kind: kind === 'varied' ? 'survey' : kind,
    environment,
    difficulty,
    margin: request.margin,
    radius: 0.85 + random() * 0.35,
    clock: 1.8 + random() * 0.6,
    launchAngle,
    targetAngle: (sign * degrees * Math.PI) / 180,
    targetRadius,
    planetCount,
    planets,
  };
}
