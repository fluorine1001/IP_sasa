import type { Recipe, Margin, TemplateKind } from './templates';
import type { Stage } from '../../world/types';
import type { Difficulty } from './difficulty';
import type { DifficultyAssessment } from './assessment';
import type { VerifiedMethod } from './solutions';
import { masterySettings, type MasterySettings } from './mastery-settings';

export type GenerationRequest = {
  kind: TemplateKind | 'mixed';
  count: number;
  seed: number;
  margin: Margin;
  difficulty?: Difficulty;
  planetCount?: 'auto' | 1 | 2 | 3;
  progression?: boolean;
  mastery?: MasterySettings;
};
export type Candidate = {
  stage: Stage;
  recipe: Recipe;
  index: number;
  seed: number;
  fingerprint: string;
  assessment: DifficultyAssessment;
  nearbyWins: number;
  nearbyTotal: number;
  randomWins: number;
  randomTotal: number;
  omissions: number;
  warnings: string[];
  methods: VerifiedMethod[];
};
export type GenerationReport = {
  candidates: Candidate[];
  seed: number;
  attempted: number;
  checked: number;
  rejected: Record<
    'duplicate' | 'witness' | 'omission' | 'random' | 'invalid' | 'margin' | 'difficulty',
    number
  >;
  phase: string;
  done: boolean;
  limited: boolean;
};
export type GenerationResponse = { report: GenerationReport } | { error: string };
export function validateRequest(value: GenerationRequest): GenerationRequest {
  if (!value || !['mixed', 'survey', 'relay'].includes(value.kind))
    throw Error('생성할 임무 종류를 선택하세요.');
  const mastery = masterySettings(value.mastery);
  const count = mastery ? mastery.groups * mastery.perGroup : value.count;
  if (!Number.isInteger(count) || count < 1 || count > 12) throw Error('생성 개수는 1~12개입니다.');
  if (!Number.isInteger(value.seed) || value.seed < 1 || value.seed > 0xffffffff)
    throw Error('생성 번호는 1~4294967295의 정수입니다.');
  if (!['wide', 'standard'].includes(value.margin)) throw Error('조작 허용 폭을 선택하세요.');
  const difficulty = value.difficulty ?? 'easy',
    planetCount = value.planetCount ?? 'auto';
  if (!['easy', 'normal', 'challenge'].includes(difficulty))
    throw Error('생성 난이도를 선택하세요.');
  if (!['auto', 1, 2, 3].includes(planetCount)) throw Error('행성 수는 자동 또는 1~3개입니다.');
  return {
    kind: value.kind,
    count,
    seed: value.seed,
    margin: value.margin,
    difficulty,
    planetCount,
    progression: !mastery && value.progression === true,
    mastery,
  };
}
