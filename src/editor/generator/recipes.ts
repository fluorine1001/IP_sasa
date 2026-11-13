import type { GenerationRequest } from './protocol';
import type { Recipe } from './templates';

/** Count is independent of difficulty. Orientations and scales alone never define diversity. */
export function makeRecipe(
  request: GenerationRequest,
  index: number,
  random: () => number,
): Recipe {
  const difficulty = request.difficulty ?? 'easy';
  const planetCount =
    request.planetCount === 'auto' || request.planetCount === undefined
      ? 1 + ((index + Math.floor(index / 3) + (request.seed % 3)) % 3)
      : request.planetCount;
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
  const planets: Recipe['planets'] = [];
  for (let i = 0; i < planetCount - 1; i++) {
    let placement;
    for (let attempt = 0; attempt < 8; attempt++) {
      placement = {
        angle: random() * Math.PI * 2,
        distance: 3.2 + random() * 1.6,
        radius: 0.16 + random() * 0.13,
        mass: 0.015 + random() * 0.04,
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
  return {
    kind,
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
