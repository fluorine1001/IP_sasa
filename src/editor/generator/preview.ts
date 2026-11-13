import { escape } from '../../app/core';
import type { Candidate } from './protocol';
import { templateNames } from './templates';

/** Authored layout only. The rocket points out from its pad; no solution or future path. */
export function candidatePreview(candidate: Candidate): string {
  const { stage, recipe } = candidate;
  const region = stage.goals[0]?.display;
  const center = stage.bodies.find((b) => b.id === region?.targetId);
  const shapes = [
    ...stage.bodies,
    ...stage.objects,
    { position: stage.spawn.position, radius: recipe.radius * 0.1 },
    ...(center && region ? [{ position: center.position, radius: region.max }] : []),
  ];
  const minX = Math.min(...shapes.map((o) => o.position.x - o.radius)),
    maxX = Math.max(...shapes.map((o) => o.position.x + o.radius));
  const minY = Math.min(...shapes.map((o) => o.position.y - o.radius)),
    maxY = Math.max(...shapes.map((o) => o.position.y + o.radius));
  const scale = Math.min(132 / (maxX - minX), 110 / (maxY - minY));
  const point = (x: number, y: number) => [
    80 + (x - (minX + maxX) / 2) * scale,
    66 - (y - (minY + maxY) / 2) * scale,
  ];
  const bodies = stage.bodies
    .map((body) => {
      const [x, y] = point(body.position.x, body.position.y);
      const r = Math.max(2, body.radius * scale);
      const detail =
        body.kind === 'black-hole'
          ? `<ellipse cx="${x}" cy="${y}" rx="${r * 2.4}" ry="${r * 0.8}" fill="none" stroke="#f8b96a" transform="rotate(-25 ${x} ${y})"/>`
          : body.kind === 'star'
            ? `<circle cx="${x}" cy="${y}" r="${r * 1.35}" fill="#ffcc5833" stroke="#ffcc58" stroke-dasharray="2 2"/>`
            : body.kind === 'moon'
              ? `<circle cx="${x - r * 0.3}" cy="${y - r * 0.2}" r="${r * 0.23}" fill="#66717e"/>`
              : '';
      return `<g><title>${escape(body.name)}</title><circle cx="${x}" cy="${y}" r="${r}" fill="${body.kind === 'black-hole' ? '#070a14' : escape(body.color)}" stroke="#b9d5de" stroke-width=".5"/>${detail}</g>`;
    })
    .join('');
  const targets = stage.objects
    .map((sensor, i) => {
      const [x, y] = point(sensor.position.x, sensor.position.y);
      return `<circle cx="${x}" cy="${y}" r="${sensor.radius * scale}" fill="#efb95c33" stroke="#efb95c"/><text x="${x}" y="${y + 3}" text-anchor="middle" fill="#ffe1a1">${i + 1}</text>`;
    })
    .join('');
  const [x, y] = point(stage.spawn.position.x, stage.spawn.position.y);
  const rocket = `<g transform="translate(${x} ${y}) rotate(${(-recipe.launchAngle * 180) / Math.PI})"><path d="M 8 0 L -3 -3 L -3 3 Z" fill="#edf4ee"/><path d="M -4 -5 L -4 5" stroke="#edf4ee" stroke-width="2"/></g>`;
  let band = '';
  if (region && center) {
    const [cx, cy] = point(center.position.x, center.position.y);
    band = `<circle cx="${cx}" cy="${cy}" r="${((region.min + region.max) / 2) * scale}" fill="none" stroke="#efb95c55" stroke-width="${Math.max(1, (region.max - region.min) * scale)}"/>`;
    if (recipe.kind === 'escape') {
      const a = recipe.launchAngle + recipe.targetAngle * 0.5,
        r = region.max * scale;
      band += `<path d="M ${cx} ${cy} l ${Math.cos(a) * r} ${-Math.sin(a) * r}" fill="none" stroke="#efb95c" stroke-dasharray="3 3"/>`;
    }
  }
  const caption =
    recipe.kind === 'orbit'
      ? '표면 발사·허용 궤도'
      : recipe.kind === 'landing'
        ? '상승 후 표면 착륙'
        : recipe.kind === 'escape'
          ? '탈출 경계·출구 방향'
          : '발사대·관측소 배치';
  return `<svg viewBox="0 0 160 150" role="img" aria-label="천체 ${stage.bodies.length}개 · 표면 발사대와 ${escape(templateNames[recipe.kind])} 배치">${band}${bodies}${targets}${rocket}<text x="80" y="145" text-anchor="middle" fill="currentColor">${caption}</text></svg>`;
}
