import type { Recipe, Margin, TemplateKind } from './templates';
import type { Stage } from '../../world/types';
import type { Difficulty } from './difficulty';
import type { DifficultyAssessment } from './assessment';
import type { VerifiedMethod } from './solutions';
import { masterySettings, type MasterySettings } from './mastery-settings';
import { environmentNames, type EnvironmentChoice } from './environments';
import type { GravityAudit } from './gravity-audit';

export type GenerationRequest = {
  kind: TemplateKind | 'mixed' | 'varied';
  environment?: EnvironmentChoice;
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
  gravity?: GravityAudit;
};
export type GenerationReport = {
  candidates: Candidate[];
  seed: number;
  attempted: number;
  checked: number;
  rejected: Record<
    | 'duplicate'
    | 'witness'
    | 'omission'
    | 'random'
    | 'invalid'
    | 'margin'
    | 'difficulty'
    | 'gravity',
    number
  >;
  phase: string;
  done: boolean;
  limited: boolean;
};
export type GenerationResponse = { report: GenerationReport } | { error: string };
export function validateRequest(value: GenerationRequest): GenerationRequest {
  if (
    !value ||
    !['mixed', 'varied', 'survey', 'relay', 'landing', 'orbit', 'escape'].includes(value.kind)
  )
    throw Error('생성할 임무 종류를 선택하세요.');
  const mastery = masterySettings(value.mastery);
  if (mastery && ['landing', 'orbit', 'escape'].includes(value.kind))
    throw Error(
      '조작 숙달 묶음은 관측 임무로 구성합니다. 착륙·궤도·탈출을 생성하려면 숙달 묶음을 꺼 주세요.',
    );
  const count = mastery ? mastery.groups * mastery.perGroup : value.count;
  if (!Number.isInteger(count) || count < 1 || count > 12) throw Error('생성 개수는 1~12개입니다.');
  if (!Number.isInteger(value.seed) || value.seed < 1 || value.seed > 0xffffffff)
    throw Error('생성 번호는 1~4294967295의 정수입니다.');
  if (!['wide', 'standard'].includes(value.margin)) throw Error('조작 허용 폭을 선택하세요.');
  const difficulty = value.difficulty ?? 'easy',
    planetCount = value.planetCount ?? 'auto';
  if (!['easy', 'normal', 'challenge'].includes(difficulty))
    throw Error('생성 난이도를 선택하세요.');
  if (!['auto', 1, 2, 3].includes(planetCount)) throw Error('천체 수는 자동 또는 1~3개입니다.');
  const environment = value.environment ?? 'planetary';
  if (environment !== 'mixed' && !Object.hasOwn(environmentNames, environment))
    throw Error('천체 구성을 선택하세요.');
  if (environment === 'binary' && planetCount !== 'auto' && planetCount !== 3)
    throw Error('쌍성계에는 출발 천체와 두 별, 총 3개가 필요합니다.');
  if (!['mixed', 'planetary'].includes(environment) && planetCount === 1)
    throw Error('이 천체 구성에는 출발 천체를 포함해 2개 이상이 필요합니다.');
  return {
    kind: value.kind,
    count,
    seed: value.seed,
    margin: value.margin,
    difficulty,
    planetCount,
    progression: !mastery && value.progression === true,
    mastery,
    environment,
  };
}
