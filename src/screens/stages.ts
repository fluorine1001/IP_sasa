import { controls, escape, type App, type Screen } from '../app/core.ts';
import { catalog } from '../stages/catalog.ts';
export function stagesScreen(app: App): Screen {
  const abort = new AbortController();
  app.root.innerHTML = `<main class="menu-sheet wide"><div class="badge">임무 게시판</div><h1>오늘은 어디로 갈까?</h1><p class="muted">각 임무를 자유롭게 선택하세요. 작은 실험부터 시작해도 좋습니다.</p><div class="stage-grid">${catalog.map((s, i) => `<button class="stage-card" data-stage="${s.id}"><span class="stage-number">${String(i + 1).padStart(2, '0')}</span><span class="stage-orb" style="background:${escape(s.bodies[0].color)}"></span><strong>${escape(s.title)}</strong><span>${escape(s.description)}</span><small>${app.completed.has(s.id) ? '✓ 탐사 완료' : '탐사 준비'} · 목표 ${s.goals.length}개</small></button>`).join('')}</div><button id="back">기지로 돌아가기</button></main>`;
  controls(app.root, { back: () => app.go('title') }, abort.signal);
  app.root
    .querySelectorAll<HTMLButtonElement>('[data-stage]')
    .forEach((b) =>
      b.addEventListener(
        'click',
        () => app.go('play', { stage: catalog.find((s) => s.id === b.dataset.stage)! }),
        { signal: abort.signal },
      ),
    );
  return { dispose: () => abort.abort() };
}
