export type Difficulty = 'easy' | 'normal' | 'challenge';
export const difficulties: Record<Difficulty, { name: string; description: string }> = {
  easy: {
    name: '쉬움',
    description:
      '가까운 관측소와 완만한 경로, 넉넉한 조작 여유를 우선합니다. 행성 수는 별도로 고릅니다.',
  },
  normal: {
    name: '보통',
    description:
      '발사대 방향과 목표 사이의 각도, 휘어진 경로와 주변 중력을 함께 고려합니다. 행성 수와 난이도는 독립입니다.',
  },
  challenge: {
    name: '도전',
    description:
      '행성을 크게 감싸는 경로와 정교한 출력·종료 조절을 요구합니다. 행성 1개로도 도전 임무를 만듭니다.',
  },
};
