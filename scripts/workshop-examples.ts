import { complexMissions, timedMission } from '../tests/fixtures/complex-missions';
import { issues } from '../src/stages/validation';
import { stageRevision, type StoredStage } from './workshop-storage';

// Explicit deployment migration requested by the project owner. Kept out of
// data/stages: these are private server drafts, NOT a new shipped campaign.
// Stable outer UUIDs + a transactional version prevent overwrites/resurrection.
export const workshopExamplesVersion = 'complex-missions-2026-10-15-v1';
export function workshopExampleDrafts(): StoredStage[] {
  return complexMissions()
    .flatMap((c) => [c, timedMission(c, 0.8), timedMission(c, 1.25)])
    .map((c, i) => {
      const stage = structuredClone(c.stage);
      stage.id = `859cb4a1-f392-49f1-8434-${(i + 1).toString(16).padStart(12, '0')}`;
      stage.title = '[검증 사례] ' + stage.title;
      stage.description = '2D 복합 물리 임무 탐색 검증용 초안';
      stage.order = 1000 + i;
      stage.published = false;
      stage.referencePlans = [];
      delete stage.randomization;
      const errors = issues(stage);
      if (errors.length) throw Error(`Invalid deployment example ${c.id}: ${errors[0]}`);
      const raw = JSON.stringify(stage);
      return { raw, revision: stageRevision(raw) };
    });
}
