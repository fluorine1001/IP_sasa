import type { ProgramEvent } from '../world/program';
const paths: Record<ProgramEvent['kind'], string> = {
  ignite: '<path d="M8 3h8v10H8zM9 16l3 5 3-5M6 8H3m18 0h-3"/>',
  stop: '<path d="M8 3h8v10H8zM9 16l3 5 3-5M3 21L21 3"/>',
  turn: '<path d="M4 18V9a5 5 0 0 1 5-5h10m-4-3 4 3-4 4M9 18l3 4 3-4"/>',
  separate: '<path d="M9 1h6v6H9zM8 16h8v7H8zM5 10l-3 2 3 2m14-4 3 2-3 2M12 9v5"/>',
  push: '<path d="M3 12h17m-6-6 6 6-6 6M4 6H1m3 12H1"/>',
  deploy:
    '<rect x="9" y="8" width="6" height="8"/><path d="M1 7h5v10H1zM18 7h5v10h-5zM6 12h3m6 0h3M12 1v4m-2-2 2 2 2-2"/>',
  sensor: '<circle cx="12" cy="12" r="4"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3 3m8 8 3 3"/>',
};
export function eventIcon(kind: ProgramEvent['kind']) {
  return (
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths[kind] +
    '</svg>'
  );
}
