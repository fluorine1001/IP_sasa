import type { Stage, RoutePlan, Run } from '../world/types.ts';
export type Settings = { volume: number; grid: boolean; trails: boolean; reducedMotion: boolean };
export type PlayArgs = {
  stage: Stage;
  plan?: RoutePlan;
  /** Enable interactive teaching only when entering the dedicated training stage. */
  tutorial?: boolean;
  onReturn?: () => void;
  onTelemetry?: (run: Run, stage: Stage) => void;
  onSolved?: (plan: RoutePlan) => void;
  /** Campaign only: opens the following mission from the result card. */
  next?: () => void;
};
export type ScreenName = 'title' | 'help' | 'settings' | 'stages' | 'tutorials' | 'play' | 'editor';
export interface Screen {
  frame?: (dt: number) => void;
  dispose?: () => void;
}
export interface App {
  root: HTMLElement;
  settings: Settings;
  tutorials: Stage[];
  loadTutorials?: (signal: AbortSignal) => Promise<Stage[]>;
  go: (name: ScreenName, args?: PlayArgs) => void;
  saveSettings: () => void;
  complete: (id: string) => void;
  completed: Set<string>;
}
export const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function controls(
  root: HTMLElement,
  events: Record<string, () => void>,
  signal: AbortSignal,
) {
  for (const [id, fn] of Object.entries(events))
    root.querySelector(`#${id}`)?.addEventListener('click', fn, { signal });
}
export function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeSaved(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be disabled; the current session remains playable. */
  }
}
