import type { Stage } from '../world/types.ts';
import { parseStage } from './validation.ts';
const files = import.meta.glob('../../data/stages/*.json', { eager: true, import: 'default' });
export const stages: Stage[] = Object.values(files)
  .map((value) => parseStage(value, true))
  .sort((a, b) => a.order - b.order);

const published = stages.filter((s) => s.published !== false);
export const catalog = published
  .filter((s) => s.track !== 'tutorial')
  .map((s) => ({ ...s, referencePlans: [] }));
export const tutorialCatalog = published
  .filter((s) => s.track === 'tutorial')
  .map((s) => ({ ...s, referencePlans: [] }));
