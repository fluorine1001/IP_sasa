import '../style.css';
import './manual-flight.css';
import { inertialScroll } from '../app/inertial-scroll';
import { editorScreen } from './screen';
import { playScreen } from '../screens/flight/screen';
import { readSaved, type App, type PlayArgs, type Screen, type Settings } from '../app/core';
import { editorCredentials } from './credentials';
import { createGoalMonitor } from './goal-monitor';
import type { FlightSession } from '../screens/flight/session';
import {
  manualArchiveKey,
  manualStageIdentity,
  readManualArchive,
  writeManualArchive,
} from './manual-flight';
const settings = readSaved<Settings>('orbit-settings-v1', {
  volume: 0.5,
  grid: true,
  trails: true,
  reducedMotion: false,
});
let current: Screen | undefined;
const container = document.querySelector<HTMLElement>('#app')!;
let workshop: { host: HTMLElement; screen: Screen } | undefined;
let manual: { host: HTMLElement; screen: Screen; identity: string } | undefined;
let generation = 0;
let manualWrites = Promise.resolve();
function activate(host: HTMLElement, screen: Screen) {
  container.firstElementChild?.dispatchEvent(new Event('workspace-suspend'));
  container.querySelectorAll<HTMLElement>('[popover]').forEach((popup) => {
    if (popup.matches(':popover-open')) popup.hidePopover();
  });
  container.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => dialog.close());
  container.replaceChildren(host);
  current = screen;
}
async function openManual(args: PlayArgs, revision: number) {
  const identity = manualStageIdentity(args.stage);
  if (manual?.identity === identity && !args.plan) {
    activate(manual.host, manual.screen);
    return;
  }
  const button = workshop?.host.querySelector<HTMLButtonElement>('#test-stage');
  if (button) button.disabled = true;
  let key: string | undefined,
    session: FlightSession = { trials: [] },
    storageError = false;
  try {
    key = await manualArchiveKey(args.stage);
    await manualWrites;
    const archive = await readManualArchive(key);
    if (archive) {
      if (
        archive.key !== key ||
        !Array.isArray(archive.trials) ||
        manualStageIdentity(archive.stage) !== identity
      )
        throw Error('수동 기록의 스테이지 사본을 확인할 수 없습니다.');
      session = { trials: archive.trials, plan: archive.plan };
    }
  } catch {
    storageError = true;
  } finally {
    if (button) button.disabled = false;
  }
  if (revision !== generation) return;
  manual?.screen.dispose?.();
  const host = document.createElement('div');
  host.dataset.workspace = 'manual';
  const snapshot = structuredClone(args.stage);
  function status(text: string) {
    const output = host.querySelector('#manual-save-status');
    if (output) output.textContent = text;
  }
  session.changed = () => {
    if (!key) {
      status('기록은 현재 창에서만 유지됩니다.');
      return;
    }
    const archive = structuredClone({
      key,
      stage: snapshot,
      trials: session.trials,
      plan: session.plan,
      updatedAt: Date.now(),
    });
    status('수동 기록 저장 중…');
    manualWrites = manualWrites
      .then(() => writeManualArchive(archive))
      .then(
        () => status('수동 기록 · 이 브라우저에 저장됨'),
        () => status('저장하지 못했습니다 · 현재 창의 기록은 유지됩니다.'),
      );
  };
  // Use the same flight screen, but never the search representative recorder/store.
  const screen = playScreen(
    { ...app, root: host },
    { ...args, onTelemetry: createGoalMonitor(host) },
    session,
  );
  host.querySelector('.mission-panel .badge')!.textContent = '직접 플레이';
  const exit = host.querySelector<HTMLButtonElement>('#exit')!;
  exit.setAttribute('aria-label', '제작·탐색으로 돌아가기');
  exit.title = '제작·탐색으로 돌아가기';
  exit.textContent = '← 제작·탐색';
  exit.style.width = 'auto';
  host.querySelector('#notes .control-label')!.textContent = '수동 기록';
  const saved = document.createElement('small');
  saved.id = 'manual-save-status';
  saved.setAttribute('role', 'status');
  saved.textContent = storageError
    ? '기록 저장소를 열지 못했습니다 · 현재 창에서만 유지됩니다.'
    : '수동 기록 · 이 브라우저에 저장';
  host.querySelector('.mission-panel')!.append(saved);
  manual = { host, screen, identity };
  activate(host, screen);
}
const app: App = {
  root: container,
  settings,
  tutorials: [],
  completed: new Set(),
  saveSettings() {},
  complete() {},
  go(name, args) {
    const revision = ++generation;
    if (name === 'title') {
      manual?.screen.dispose?.();
      workshop?.screen.dispose?.();
      location.href = '/';
      return;
    }
    if (name === 'play' && args) {
      void openManual(args, revision).catch((error) => {
        if (revision !== generation) return;
        const status = workshop?.host.querySelector('#editor-status');
        if (status)
          status.textContent = `직접 플레이를 열지 못했습니다. ${error instanceof Error ? error.message : ''}`;
      });
      return;
    }
    if (!workshop) {
      const host = document.createElement('div');
      host.dataset.workspace = 'editor';
      container.replaceChildren(host);
      workshop = { host, screen: editorScreen({ ...app, root: host }) };
      const button = host.querySelector('#test-stage')!;
      button.textContent = '직접 플레이 · 기록';
      button.setAttribute('title', 'F5 · 현재 초안을 본게임 UI로 플레이');
    }
    activate(workshop.host, workshop.screen);
  },
};
async function unlock() {
  const response = await fetch('/api/workshop/stages', {
    headers: editorCredentials.key ? { Authorization: 'Bearer ' + editorCredentials.key } : {},
  }).catch(() => undefined);
  if (response?.ok) {
    app.go('editor');
    return;
  }
  app.root.innerHTML =
    '<main class="menu-sheet"><h1>제작소 접속</h1><label>편집 키<input id="editor-key" type="password" autocomplete="off"></label><button id="editor-unlock">접속</button><p id="editor-login-status">서버 관리자의 편집 키가 필요합니다. 게임은 키 없이 이용할 수 있습니다.</p></main>';
  app.root.querySelector('#editor-unlock')!.addEventListener('click', () => {
    editorCredentials.key = app.root.querySelector<HTMLInputElement>('#editor-key')!.value;
    void unlock();
  });
}
document.body.classList.toggle('reduced-motion', settings.reducedMotion);
void unlock();
inertialScroll(app.root);
let previous = performance.now();
function frame(now: number) {
  current?.frame?.(Math.min(0.05, (now - previous) / 1000));
  previous = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
