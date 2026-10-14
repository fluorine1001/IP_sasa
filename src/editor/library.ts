import { escape, readSaved, writeSaved } from '../app/core';
import { parseStage } from '../stages/validation';
import type { Stage } from '../world/types';
import { editorCredentials } from './credentials';
import serverConfig from '../stages/server-config.json';
type Entry = { stage: Stage; revision: string };
/** Edit keys stay in this tab's memory, never in exported JSON or player storage. */
export function stageLibrary(
  root: HTMLElement,
  signal: AbortSignal,
  load: (stage: Stage) => void,
  message: (text: string) => void,
) {
  let base = readSaved<string>('orbit-stage-server-v1', serverConfig.url),
    key = editorCredentials.key,
    entries: Entry[] = [];
  const revisions = new Map<string, string>();
  root.insertAdjacentHTML(
    'beforeend',
    `<dialog id="stage-library" class="workshop-dialog panel"><header><h2>스테이지 보관함</h2><button data-library-close aria-label="보관함 닫기">×</button></header><div class="library-connect"><label>공유 서버 주소<input id="library-server" type="url" placeholder="빈칸: 이 컴퓨터" value="${escape(base)}"></label><label>편집 키<input id="library-key" type="password" autocomplete="off"></label><button id="library-refresh">연결 / 새로고침</button></div><p id="library-status"></p><div id="library-list"></div><small>초안·공개 상태를 함께 관리합니다. 저장·삭제 전 최신 버전을 비교합니다. 삭제본과 이전 버전은 서버의 .stage-workshop 폴더에 보관됩니다.</small></dialog>`,
  );
  const dialog = root.querySelector<HTMLDialogElement>('#stage-library')!;
  root.querySelector<HTMLInputElement>('#library-key')!.value = key;
  const headers = () => ({ ...(key ? { Authorization: 'Bearer ' + key } : {}) });
  async function request(route: string, options?: RequestInit) {
    const response = await fetch(base + '/api/workshop/stages' + route, {
      ...options,
      headers: { ...headers(), ...options?.headers },
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? '서버 연결 실패');
    return data;
  }
  function draw() {
    root.querySelector('#library-list')!.innerHTML =
      entries
        .map(
          ({ stage }) =>
            `<article class="library-card"><div><strong>${escape(stage.title)}</strong><small>${stage.published !== false ? '공개' : '초안'} · ${stage.track === 'tutorial' ? '훈련' : '탐사'}<br>${stage.id}</small></div><button data-library-load="${stage.id}">열기</button><button data-library-delete="${stage.id}">삭제</button></article>`,
        )
        .join('') || '<p>등록된 스테이지가 없습니다.</p>';
  }
  async function refresh() {
    try {
      const nextBase = root
        .querySelector<HTMLInputElement>('#library-server')!
        .value.replace(/\/$/, '');
      if (nextBase && !/^https?:\/\//i.test(nextBase))
        throw Error('http 또는 https 서버 주소를 입력하세요.');
      if (nextBase !== base) revisions.clear();
      base = nextBase;
      key = root.querySelector<HTMLInputElement>('#library-key')!.value;
      const data = await request('');
      writeSaved('orbit-stage-server-v1', base);
      entries = data.stages.map((entry: Entry) => ({
        stage: parseStage(entry.stage),
        revision: entry.revision,
      }));
      draw();
      root.querySelector('#library-status')!.textContent =
        entries.length + '개 · ' + (base || '로컬 서버');
    } catch (error) {
      root.querySelector('#library-status')!.textContent = String(error);
    }
  }
  root
    .querySelector('#library-refresh')!
    .addEventListener('click', () => void refresh(), { signal });
  dialog.addEventListener(
    'click',
    async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if ('libraryClose' in button.dataset) dialog.close();
      const id = button.dataset.libraryLoad ?? button.dataset.libraryDelete;
      const entry = entries.find((entry) => entry.stage.id === id);
      if (!entry) return;
      if (button.dataset.libraryLoad) {
        revisions.set(entry.stage.id, entry.revision);
        load(structuredClone(entry.stage));
        dialog.close();
      }
      if (button.dataset.libraryDelete) {
        if (button.dataset.confirm !== 'true') {
          button.dataset.confirm = 'true';
          button.textContent = '삭제 확인';
          return;
        }
        try {
          await request('/' + entry.stage.id, {
            method: 'DELETE',
            headers: { 'If-Match': entry.revision },
          });
          revisions.delete(entry.stage.id);
          message('서버 스테이지를 내렸습니다. .stage-workshop/trash에서 복구할 수 있습니다.');
          await refresh();
        } catch (error) {
          message(String(error));
        }
      }
    },
    { signal },
  );
  return {
    open() {
      dialog.showModal();
      void refresh();
    },
    async track(stage: Stage) {
      try {
        const snapshot = structuredClone(stage),
          latest = await request('/' + stage.id);
        if (JSON.stringify(snapshot) === JSON.stringify(latest.stage))
          revisions.set(stage.id, latest.revision);
      } catch {
        /* A new/imported draft has no server revision yet. */
      }
    },
    async save(stage: Stage) {
      let revision = revisions.get(stage.id);
      if (!revision) {
        const current = (await request('')).stages.find(
          (entry: Entry) => entry.stage.id === stage.id,
        ) as Entry | undefined;
        // Do not silently overwrite an existing server stage using a stale imported draft.
        if (current)
          throw Error(
            '보관함에서 이 스테이지의 최신본을 먼저 여세요. 현재 초안은 JSON 내보내기로 보관할 수 있습니다.',
          );
      }
      const result = await request(revision ? '/' + stage.id : '', {
        method: revision ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(revision ? { 'If-Match': revision } : {}),
        },
        body: JSON.stringify(stage),
      });
      revisions.set(stage.id, result.revision);
      return result;
    },
  };
}
