import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../../app/core.ts';
import './hub.css';
import { practiceGroups } from './progress';

const PROGRESS_KEY = 'orbit-tutorial-completed-v1';

export function tutorialsScreen(app: App): Screen {
  const abort = new AbortController();
  const saved = readSaved<unknown>(PROGRESS_KEY, []),
    completed = new Set(
      (Array.isArray(saved) ? saved : []).filter(
        (value): value is string => typeof value === 'string',
      ),
    );
  function draw() {
    const drills = practiceGroups
      .map((g, i) => `<li><span>${i + 1}</span>${escape(g.title)}</li>`)
      .join('');
    app.root.innerHTML = `<main class="menu-sheet wide tutorial-hub"><span class="eyebrow">훈련</span><h1>튜토리얼</h1><div class="tutorial-grid">${app.tutorials
      .map(
        (stage) =>
          `<button class="tutorial-card ${completed.has(stage.id) ? 'done' : ''}" data-stage="${stage.id}"><strong>${escape(stage.title)}</strong><ol class="tutorial-drills">${drills}</ol><small>${completed.has(stage.id) ? '수료 · 다시 연습' : '훈련 시작 ▶'}</small>${completed.has(stage.id) ? '<span class="tutorial-stamp">수료</span>' : ''}</button>`,
      )
      .join('')}<aside class="ui-panel tutorial-guide"><h2 class="ui-h3">이 훈련에서 익히는 것</h2><ol class="tutorial-loop"><li><b>계획</b>시간선에 출력·끄기·회전·분리를 예약합니다. 발사하면 계획은 바꿀 수 없습니다.</li><li><b>비행</b>로켓은 예약대로만 움직입니다. 궤도 계산기의 하늘색 점선으로 지금 궤도를 읽습니다.</li><li><b>기록</b>실패한 비행도 기록으로 남습니다. 다시보기로 어디서 어긋났는지 찾고 한 가지만 바꿔 다시 발사합니다.</li></ol><p class="ui-body dim">훈련은 약 10분 걸립니다. 언제든 나갔다가 이어서 할 수 있습니다.</p><button id="to-campaign" class="ui-btn">임무 목록으로 →</button></aside></div><button id="back" class="ui-btn">← 처음 화면</button></main>`;
    controls(
      app.root,
      { back: () => app.go('title'), 'to-campaign': () => app.go('stages') },
      abort.signal,
    );
    app.root.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((button) =>
      button.addEventListener(
        'click',
        () => {
          const stage = app.tutorials.find((item) => item.id === button.dataset.stage);
          if (!stage) return;
          app.go('play', {
            stage,
            tutorial: true,
            onSolved: () => {
              completed.add(stage.id);
              writeSaved(PROGRESS_KEY, [...completed]);
            },
            onReturn: () => app.go('tutorials'),
          });
        },
        { signal: abort.signal },
      ),
    );
  }
  draw();
  if (app.loadTutorials)
    void app.loadTutorials(abort.signal).then((stages) => {
      if (!abort.signal.aborted) {
        app.tutorials = stages;
        draw();
      }
    });
  return { dispose: () => abort.abort() };
}
