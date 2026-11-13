import { escape } from '../../app/core';
import type { Candidate } from './protocol';
import { templateNames } from './templates';

/** Authored layout only. The rocket points out from its pad; no solution or future path. */
export function candidatePreview(candidate: Candidate): string {
  const { stage, recipe } = candidate;
  const shapes = [
    ...stage.bodies,
    ...stage.objects,
    { position: stage.spawn.position, radius: recipe.radius * 0.1 },
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
      return `<circle cx="${x}" cy="${y}" r="${body.radius * scale}" fill="${escape(body.color)}"/>`;
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
  return `<svg viewBox="0 0 160 150" role="img" aria-label="행성 ${stage.bodies.length}개 · 표면 발사대와 ${escape(templateNames[recipe.kind])} 배치">${bodies}${targets}${rocket}<text x="80" y="145" text-anchor="middle" fill="currentColor">발사대·행성·관측소 배치</text></svg>`;
}
