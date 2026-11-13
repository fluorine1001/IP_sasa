import CurationWorker from './curation.worker?worker';
import { escape } from '../../app/core';
import { parseStage } from '../../stages/validation';
import {
  reviewCandidate,
  selectCourse,
  coursePackage,
  poolPackage,
  readStagePackage,
  type StageReview,
} from './curation';
import type { Candidate } from './protocol';
import type { Stage } from '../../world/types';
import type { VerifiedMethod } from './solutions';
import {
  selectMasteryCourse,
  masteryPackage,
  importedMastery,
  importedMasteryId,
  assignMasteryChapter,
  type MasteryCourse,
} from './mastery';
import type { MasterySettings } from './mastery-settings';

/** Session pool plus explicit JSON save/load; no server writes or edits to the open document. */
export function createCollectionPanel(
  root: HTMLElement,
  signal: AbortSignal,
  openStage: (stage: Stage) => void,
  reviewPlans: (stage: Stage, methods: VerifiedMethod[]) => void,
  onMasteryImport?: (settings: MasterySettings) => void,
) {
  const host = document.createElement('section');
  host.className = 'generator-collection';
  host.innerHTML = `<h3>후보 모음 · 쉬운 순서 선별</h3><p>여러 번 생성한 후보를 모아 비교합니다. 이 창의 모음은 JSON으로 내보내 보관하고 다시 가져올 수 있습니다.</p><div class="generator-actions"><label>선별 개수<input data-course-count type="number" min="1" max="12" value="6"></label><button data-course-select>쉬운 순서 선별</button><button data-course-export disabled>순서 묶음 내보내기</button><button data-course-import>후보 JSON 가져오기</button><input data-course-file type="file" accept=".json" hidden><button data-course-stop disabled>가져오기 중지</button></div><p data-course-status role="status">후보를 생성하면 이 모음에도 남습니다. 공개 순서는 자동으로 바뀌지 않습니다.</p><div data-course-output></div><details><summary>모든 후보 비교 · 포함/제외</summary><div data-course-pool></div></details><details><summary>선별 기준</summary><ol><li>둥근 수치로 성공한 서로 다른 조작 방식이 2개 이상 있어야 합니다.</li><li>입문은 새 개념 없이 시작하고 조작 변경의 절반 이상이 성공해야 합니다.</li><li>경로·조작 여유·필요한 판단·대안 풀이를 함께 평가해 쉬운 순서로 정렬합니다.</li><li>다음 단계의 점수 차이는 22점까지, 새 개념은 한 번에 하나까지 허용합니다.</li><li>비슷한 구조는 두 개까지 우선 선별합니다. 부족한 단계는 검토 대기로 남깁니다.</li><li>이는 제작용 제안입니다. 실제 사람의 플레이로 순서와 난이도를 확인하세요.</li></ol></details>`;
  root.append(host);
  host
    .querySelector('[data-course-output]')!
    .insertAdjacentHTML(
      'beforebegin',
      '<div class="mastery-summary" data-mastery-summary hidden></div>',
    );
  host
    .querySelector('[data-course-import]')!
    .insertAdjacentHTML(
      'beforebegin',
      '<button data-pool-export disabled>후보 모음 내보내기</button><button data-pool-clear disabled>모음 비우기</button><button data-pool-undo disabled>비우기 취소</button>',
    );
  const pool = new Map<string, StageReview>(),
    excluded = new Set<string>();
  let backup: { pool: Map<string, StageReview>; excluded: Set<string> } | undefined;
  let mastery: MasterySettings | undefined, masteryResult: MasteryCourse | undefined;
  let masteryId: string = crypto.randomUUID();
  let worker: Worker | undefined,
    course = selectCourse([]),
    requested = 6;
  const message = (text: string) =>
    (host.querySelector('[data-course-status]')!.textContent = text);
  function stop() {
    worker?.terminate();
    worker = undefined;
    host.querySelector<HTMLButtonElement>('[data-course-stop]')!.disabled = true;
    host.querySelector<HTMLButtonElement>('[data-course-import]')!.disabled = false;
  }
  function draw() {
    const active = [...pool.values()].filter((r) => !excluded.has(r.stage.id));
    masteryResult = mastery ? selectMasteryCourse(active, mastery, masteryId) : undefined;
    course = masteryResult?.course ?? selectCourse(active, requested);
    const summary = host.querySelector<HTMLElement>('[data-mastery-summary]')!;
    summary.hidden = !masteryResult;
    summary.innerHTML = masteryResult
      ? masteryResult.groups
          .map(
            (g) =>
              `<article data-mastery-group="${g.order}"><h4>${g.order}묶음 · ${escape(g.focus)}</h4><p>복습: ${escape(g.learned.join(' · ') || '기본 조작부터 시작')}</p><p>${g.entries.length}/${mastery!.perGroup}개 · ${g.complete ? '연습 후보 준비됨' : '앞 묶음과 필요한 조작의 후보를 더 모으세요'}</p></article>`,
          )
          .join('')
      : '';
    host.querySelector<HTMLInputElement>('[data-course-count]')!.disabled = !!mastery;
    const selected = new Map(
      course.entries.map((e, i) => [e.review.stage.id, { ...e, index: i + 1 }]),
    );
    const held = new Map(course.held.map((e) => [e.review.stage.id, e.reason]));
    host.querySelector('[data-course-output]')!.innerHTML = course.entries.length
      ? `<div class="generator-table-wrap"><table><thead><tr><th>순서</th><th>스테이지</th><th>점수</th><th>선별 이유</th><th>검토</th></tr></thead><tbody>${course.entries.map((e, i) => `<tr data-course-entry="${e.review.stage.id}"><td>${i + 1}</td><td>${escape(e.review.stage.title)}<small>${escape(e.review.style)} · 천체 ${e.review.stage.bodies.length}개</small></td><td>${e.review.score}</td><td>${escape(e.reason)}<small>검토 방식: ${escape(e.review.methods[e.methodIndex].label)}</small></td><td><button data-pool-review="${e.review.stage.id}">풀이 비교</button><button data-pool-open="${e.review.stage.id}">초안으로 열기</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p>아직 연결할 입문 단계가 없습니다. 쉬운 후보를 더 모으거나 검토 대기 이유를 확인하세요.</p>';
    host.querySelector('[data-course-pool]')!.innerHTML =
      [...pool.values()]
        .sort((a, b) => a.score - b.score)
        .map(
          (r) =>
            `<article class="course-pool-row"><label><input type="checkbox" data-pool-include="${r.stage.id}" ${excluded.has(r.stage.id) ? '' : 'checked'}>${escape(r.stage.title)} · ${r.score}점</label><small>서로 다른 둥근 수치 풀이 ${new Set(r.methods.filter((m) => m.coarse).map((m) => m.kind)).size}개 · ${selected.has(r.stage.id) ? `${selected.get(r.stage.id)!.index}번째 선별` : excluded.has(r.stage.id) ? '직접 제외' : escape(held.get(r.stage.id) ?? '검토 필요')}</small><button data-pool-review="${r.stage.id}">풀이 비교</button><button data-pool-open="${r.stage.id}">초안으로 열기</button></article>`,
        )
        .join('') || '<p>모은 후보가 없습니다.</p>';
    host.querySelector<HTMLButtonElement>('[data-course-export]')!.disabled =
      !course.entries.length;
    host.querySelector<HTMLButtonElement>('[data-pool-export]')!.disabled = !pool.size;
    host.querySelector<HTMLButtonElement>('[data-pool-clear]')!.disabled = !pool.size;
    host.querySelector<HTMLButtonElement>('[data-pool-undo]')!.disabled = !backup;
    message(
      `모음 ${pool.size}개 · 선별 ${course.entries.length}/${course.requested}개 · 검토 대기 ${course.held.length}개${course.entries.length < course.requested ? ' · 부족한 단계를 억지로 채우지 않습니다.' : ''}`,
    );
  }
  function put(review: StageReview) {
    const duplicate = [...pool.values()].find((r) => r.fingerprint === review.fingerprint);
    if (duplicate && duplicate.stage.id !== review.stage.id) return;
    if (pool.size >= 48 && !pool.has(review.stage.id))
      throw Error('후보 모음은 48개까지입니다. 묶음을 내보내 보관한 뒤 새로 시작하세요.');
    pool.set(review.stage.id, review);
    backup = undefined;
  }
  host.addEventListener(
    'change',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.poolInclude) {
        input.checked
          ? excluded.delete(input.dataset.poolInclude)
          : excluded.add(input.dataset.poolInclude);
        draw();
      }
      if (input.hasAttribute('data-course-count')) {
        requested = Math.max(1, Math.min(12, Math.round(Number(input.value) || 6)));
        input.value = String(requested);
        draw();
      }
      if (input.hasAttribute('data-course-file'))
        void (async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            if (file.size > 5 * 1024 * 1024) throw Error('5MB 이하의 JSON 파일을 선택하세요.');
            const value = JSON.parse(await file.text());
            const stages = readStagePackage(value);
            const restoredMastery = importedMastery(value);
            if (restoredMastery) {
              masteryId = importedMasteryId(value) ?? masteryId;
              mastery = restoredMastery;
              onMasteryImport?.(restoredMastery);
            }
            stop();
            const current = new CurationWorker();
            worker = current;
            host.querySelector<HTMLButtonElement>('[data-course-import]')!.disabled = true;
            host.querySelector<HTMLButtonElement>('[data-course-stop]')!.disabled = false;
            message('가져온 스냅샷의 풀이를 실제로 다시 검사합니다.');
            current.onmessage = (event) => {
              if (current !== worker) return;
              if (event.data.error) {
                stop();
                message(event.data.error);
                return;
              }
              if (event.data.review) {
                try {
                  put(event.data.review);
                  draw();
                } catch (error) {
                  stop();
                  message(String(error));
                  return;
                }
              }
              if (event.data.done) {
                stop();
                draw();
                return;
              }
              if (!event.data.review)
                message(
                  `가져오기 ${event.data.index + 1}/${stages.length} · 비행 ${event.data.checked}회 검사 중`,
                );
            };
            current.onerror = () => {
              if (current === worker) {
                stop();
                message('가져오기 검사를 마치지 못했습니다. 기존 모음은 유지됩니다.');
              }
            };
            current.postMessage({ stages });
          } catch (error) {
            message(String(error));
          }
          input.value = '';
        })();
    },
    { signal },
  );
  host.addEventListener(
    'click',
    (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.hasAttribute('data-course-select')) draw();
      if (b.hasAttribute('data-pool-clear')) {
        backup = { pool: new Map(pool), excluded: new Set(excluded) };
        pool.clear();
        excluded.clear();
        draw();
      }
      if (b.hasAttribute('data-pool-undo') && backup) {
        pool.clear();
        excluded.clear();
        for (const [id, r] of backup.pool) pool.set(id, r);
        backup.excluded.forEach((id) => excluded.add(id));
        backup = undefined;
        draw();
      }
      if (b.hasAttribute('data-course-stop')) {
        stop();
        message('가져오기를 중지했습니다. 이미 확인한 후보와 기존 모음은 유지됩니다.');
      }
      if (b.hasAttribute('data-course-import'))
        host.querySelector<HTMLInputElement>('[data-course-file]')!.click();
      const id = b.dataset.poolReview ?? b.dataset.poolOpen;
      if (id) {
        const r = pool.get(id);
        if (r) {
          if (b.dataset.poolReview) reviewPlans(r.stage, r.methods);
          else
            try {
              const snapshot = parseStage(structuredClone(r.stage));
              const position = course.entries.findIndex((e) => e.review.stage.id === id);
              if (position >= 0) snapshot.order = position + 1;
              const group = masteryResult?.groups.find((g) =>
                g.entries.some((e) => e.review.stage.id === id),
              );
              if (group) assignMasteryChapter(snapshot, group);
              openStage(snapshot);
            } catch (error) {
              message(String(error));
            }
        }
      }
      if (b.hasAttribute('data-course-export') || b.hasAttribute('data-pool-export')) {
        try {
          const bundle = b.hasAttribute('data-pool-export')
              ? {
                  ...poolPackage([...pool.values()]),
                  ...(mastery ? { mastery: { version: 1, id: masteryId, settings: mastery } } : {}),
                }
              : masteryResult
                ? masteryPackage(masteryResult)
                : coursePackage(course),
            url = URL.createObjectURL(
              new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json' }),
            );
          const a = document.createElement('a');
          a.href = url;
          a.download = `stage-order-${bundle.id}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
          message(String(error));
        }
      }
    },
    { signal },
  );
  signal.addEventListener('abort', stop, { once: true });
  return {
    configureMastery(settings: MasterySettings | undefined) {
      mastery = settings;
      draw();
    },
    add(candidates: Candidate[]) {
      try {
        for (const c of candidates) put(reviewCandidate(c));
        draw();
      } catch (error) {
        message(String(error));
      }
    },
    stop,
  };
}
