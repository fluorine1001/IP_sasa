import type { Stage } from '../world/types.ts';
import { parseStage } from './validation.ts';
const files = import.meta.glob('../../data/stages/*.json', { eager: true, import: 'default' });
export const stages: Stage[] = Object.values(files)
  .map(parseStage)
  .sort((a, b) => a.order - b.order);

export const catalog = stages.filter((s) => s.published !== false);
