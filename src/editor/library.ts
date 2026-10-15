import { escape, readSaved, writeSaved } from '../app/core';
import { parseStage } from '../stages/validation';
import { emptyStage } from '../stages/factory';
import type { Stage } from '../world/types';
import { editorCredentials } from './credentials';
import { StageDocuments } from './documents';
import serverConfig from '../stages/server-config.json';
type Entry = { stage: Stage; revision: string; publication?: { title: string; revision: string } };
/** Keys remain in tab memory. Switching never replaces an unarchived document. */
export function stageLibrary(
  root: HTMLElement,
  signal: AbortSignal,
  load: (stage: Stage) => void,
  message: (text: string) => void,
  workspace: { current: () => Stage; documents: StageDocuments; rename: (title: string) => void },
) {
  let base = readSaved<string>('orbit-stage-server-v1', serverConfig.url),
    key = editorCredentials.key,
    entries: Entry[] = [];
  let source: 'server' | 'local' | 'trash' = 'server',
    filter = '',
    renaming = '';
  const revisions = new Map<string, string>();
  root.insertAdjacentHTML(
    'beforeend',
    `<dialog id="stage-library" class="workshop-dialog panel"><header><h2>스테이지 목록</h2><button data-library-close aria-label="보관함 닫기">×</button></header><nav class="library-tabs"><button data-library-source="local">이 기기</button><button data-library-source="server">공유 서버</button><button data-library-source="trash">휴지통</button></nav><div class="library-tools"><input id="library-filter" type="search" placeholder="이름으로 찾기" aria-label="스테이지 이름 검색"><button id="library-new">＋ 새 스테이지</button></div><details class="library-connect"><summary>서버 연결</summary><label>공유 서버 주소<input id="library-server" type="url" placeholder="빈칸: 이 컴퓨터" value="${escape(base)}"></label><label>편집 키<input id="library-key" type="password" autocomplete="off"></label><button id="library-refresh">연결 / 새로고침</button></details><p id="library-status"></p><div id="library-list"></div><small>이 기기 저장 → 서버 초안 → 검사 후 게임 공개</small></dialog>`,
  );
  const dialog = root.querySelector<HTMLDialogElement>('#stage-library')!,
    el = (id: string) => dialog.querySelector<HTMLElement>('#' + id)!;
  (el('library-key') as HTMLInputElement).value = key;
  async function request(route: string, options?: RequestInit) {
    const r = await fetch(base + '/api/workshop/stages' + route, {
      ...options,
      headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...options?.headers },
      signal,
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error ?? '서버 연결 실패');
    return data;
  }
  const naming = (s: Stage, prefix: string) =>
    renaming === prefix + s.id
      ? `<input data-stage-name="${s.id}" value="${escape(s.title)}" aria-label="새 스테이지 이름"><button data-name-save="${s.id}" data-name-source="${prefix}">이름 저장</button>`
      : `<strong>${escape(s.title)}</strong>`;
  function draw() {
    dialog
      .querySelectorAll<HTMLElement>('[data-library-source]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.librarySource === source)));
    dialog.querySelector<HTMLDetailsElement>('.library-connect')!.hidden = source !== 'server';
    const match = (s: Stage) => s.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
    el('library-list').innerHTML =
      source === 'server'
        ? entries
            .filter((e) => match(e.stage))
            .map(
              (e) =>
                `<article class="library-card" data-stage-row="${e.stage.id}"><div>${naming(e.stage, 'server')}<small class="library-publication">${e.publication ? '게임 공개' + (e.publication.revision !== e.revision ? ' · 미공개 수정 있음' : '') : '서버 초안 · 게임 미포함'}</small>${e.publication && e.publication.title !== e.stage.title ? `<small>공개 이름: ${escape(e.publication.title)}</small>` : ''}</div><div class="library-actions"><button data-library-load="${e.stage.id}">편집</button><button data-rename="server:${e.stage.id}">이름</button>${e.publication ? `<button data-library-withdraw="${e.stage.id}">공개 해제</button>` : ''}<button data-library-delete="${e.stage.id}">삭제</button></div></article>`,
            )
            .join('')
        : workspace.documents
            .list(source === 'trash')
            .filter((d) => match(d.stage))
            .map(
              ({ stage: s }) =>
                `<article class="library-card" data-stage-row="${s.id}"><div>${naming(s, 'local')}<small>${source === 'trash' ? '삭제된 이 기기 초안' : '이 기기 초안' + (s.id === workspace.current().id ? ' · 편집 중' : '')}</small></div><div class="library-actions">${source === 'trash' ? `<button data-draft-restore="${s.id}">복원</button>` : `<button data-draft-load="${s.id}">편집</button><button data-rename="local:${s.id}">이름</button><button data-draft-upload="${s.id}">서버에 저장</button><button data-draft-delete="${s.id}">삭제</button>`}</div></article>`,
            )
            .join('');
    if (!el('library-list').children.length)
      el('library-list').innerHTML = '<p class="library-empty">스테이지 없음</p>';
  }
  async function refresh() {
    try {
      const next = (el('library-server') as HTMLInputElement).value.replace(/\/$/, '');
      if (next && !/^https?:\/\//i.test(next))
        throw Error('http 또는 https 서버 주소를 입력하세요.');
      if (next !== base) revisions.clear();
      base = next;
      key = (el('library-key') as HTMLInputElement).value;
      const data = await request('');
      writeSaved('orbit-stage-server-v1', base);
      entries = data.stages.map((e: Entry) => ({ ...e, stage: parseStage(e.stage, true) }));
      el('library-status').textContent =
        `서버 ${entries.length}개 · 게임 공개 ${entries.filter((e) => e.publication).length}개`;
      draw();
    } catch (e) {
      el('library-status').textContent = String(e);
      draw();
    }
  }
  async function save(stage: Stage, publication: 'draft' | 'publish' = 'draft') {
    const revision = revisions.get(stage.id);
    if (!revision) {
      const existing = (await request('')).stages.find((e: Entry) => e.stage.id === stage.id);
      if (existing) throw Error('서버 최신본을 먼저 열어 비교하세요. 이 기기 초안은 보존됩니다.');
    }
    const result = await request((revision ? '/' + stage.id : '') + '?release=' + publication, {
      method: revision ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(revision ? { 'If-Match': revision } : {}),
      },
      body: JSON.stringify({ ...stage, published: publication === 'publish' }),
    });
    revisions.set(stage.id, result.revision);
    return result;
  }
  const fail = (e: unknown) => {
    el('library-status').textContent = String(e);
    message(String(e));
  };
  el('library-refresh').onclick = () => void refresh();
  el('library-filter').oninput = (e) => {
    filter = (e.target as HTMLInputElement).value;
    draw();
  };
  el('library-new').onclick = () => {
    try {
      load(emptyStage());
      dialog.close();
    } catch (e) {
      fail(e);
    }
  };
  dialog.addEventListener(
    'click',
    async (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      try {
        if ('libraryClose' in b.dataset) dialog.close();
        if (b.dataset.librarySource) {
          source = b.dataset.librarySource as typeof source;
          renaming = '';
          draw();
          if (source === 'server') await refresh();
        }
        if (b.dataset.rename) {
          const [type, id] = b.dataset.rename.split(':');
          renaming = type + id;
          draw();
          dialog.querySelector<HTMLInputElement>(`[data-stage-name="${id}"]`)?.focus();
        }
        if (b.dataset.nameSave) {
          const id = b.dataset.nameSave,
            title =
              dialog.querySelector<HTMLInputElement>(`[data-stage-name="${id}"]`)!.value.trim() ||
              '이름 없는 스테이지';
          if (b.dataset.nameSource === 'local') {
            workspace.documents.rename(id, title);
            if (workspace.current().id === id) workspace.rename(title);
          } else {
            const e = entries.find((e) => e.stage.id === id)!;
            const renamed = await request('/' + id + '?release=draft', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'If-Match': e.revision },
              body: JSON.stringify({ ...e.stage, title, published: false }),
            });
            if (revisions.get(id) === e.revision) revisions.set(id, renamed.revision);
            if (workspace.current().id === id) workspace.rename(title);
            await refresh();
          }
          renaming = '';
          draw();
        }
        if (b.dataset.draftLoad) {
          const s = workspace.documents.get(b.dataset.draftLoad);
          if (s) {
            load(s);
            dialog.close();
          }
        }
        if (b.dataset.draftRestore) {
          workspace.documents.restore(b.dataset.draftRestore);
          draw();
        }
        if (b.dataset.draftDelete) {
          if (b.dataset.confirm !== 'true') {
            b.dataset.confirm = 'true';
            b.textContent = '휴지통으로 이동';
            return;
          }
          const id = b.dataset.draftDelete;
          if (workspace.current().id === id) load(emptyStage());
          workspace.documents.remove(id);
          draw();
        }
        if (b.dataset.draftUpload) {
          await save(workspace.documents.get(b.dataset.draftUpload)!);
          source = 'server';
          await refresh();
        }
        const id = b.dataset.libraryLoad ?? b.dataset.libraryDelete ?? b.dataset.libraryWithdraw,
          e = entries.find((e) => e.stage.id === id);
        if (!e) return;
        if (b.dataset.libraryLoad) {
          load(structuredClone(e.stage));
          revisions.set(e.stage.id, e.revision);
          dialog.close();
        }
        if (b.dataset.libraryDelete || b.dataset.libraryWithdraw) {
          if (b.dataset.confirm !== 'true') {
            b.dataset.confirm = 'true';
            b.textContent = b.dataset.libraryDelete ? '삭제 확인' : '공개 해제 확인';
            return;
          }
          if (b.dataset.libraryDelete) {
            await request('/' + id, { method: 'DELETE', headers: { 'If-Match': e.revision } });
            revisions.delete(id!);
            message('서버 스테이지를 삭제했습니다. 이전 내용은 서버에 보존됩니다.');
          } else {
            await request('/' + id + '?release=withdraw', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'If-Match': e.revision },
              body: JSON.stringify({ ...e.stage, published: false }),
            });
            revisions.delete(id!);
          }
          await refresh();
        }
      } catch (e) {
        fail(e);
      }
    },
    { signal },
  );
  return {
    open() {
      try {
        workspace.documents.put(workspace.current());
        dialog.showModal();
        draw();
        void refresh();
      } catch (e) {
        message(String(e));
      }
    },
    save,
    async track(stage: Stage) {
      try {
        const copy = JSON.stringify(stage),
          latest = await request('/' + stage.id);
        if (copy === JSON.stringify(latest.stage)) revisions.set(stage.id, latest.revision);
      } catch {
        /* New/imported draft. */
      }
    },
  };
}
