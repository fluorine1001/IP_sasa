import type { SearchReport } from './solution-search';
export function inverseStatus(result: SearchReport, paused: boolean): string {
  const r = result.inverse;
  if (!r)
    return `대표 검증 ${result.evaluated} · 성공 ${result.successes} · 풀이 ${result.families.length}`;
  if (
    result.done &&
    !result.continuable &&
    !result.families.length &&
    r.unsupported &&
    r.issues.length
  )
    return '역산 미지원 · ' + r.issues[0];
  const phase = paused
    ? '역산 중지'
    : result.done
      ? result.continuable
        ? '역산 일시정지'
        : r.complete
          ? '관계 계산 완료'
          : '역산 미결'
      : {
          compiling: '전이 관계 구성',
          projecting: '성공 영역 역산',
          verifying: '성공 대표 검증',
          finished: '역산 정리',
        }[r.phase];
  return `${phase} · 풀이 ${result.families.length} · 성공 ${result.successes} · 대표 검증 ${result.evaluated}`;
}
