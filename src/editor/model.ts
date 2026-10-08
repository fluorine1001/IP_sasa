import type { Condition } from '../world/conditions.ts';
import type { Stage, Body, WorldObject, Goal } from '../world/types.ts';
import { syncLaunch } from '../world/launch.ts';
import { uid } from '../stages/factory.ts';
export type Entity = Body | WorldObject | Goal;
export class EditorModel {
  stage: Stage;
  selection = new Set<string>();
  private past: { stage: Stage; selection: string[] }[] = [];
  private future: { stage: Stage; selection: string[] }[] = [];
  constructor(stage: Stage) {
    this.stage = structuredClone(stage);
  }
  checkpoint() {
    this.past.push({ stage: structuredClone(this.stage), selection: [...this.selection] });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  change(fn: (stage: Stage) => void) {
    this.checkpoint();
    fn(this.stage);
    syncLaunch(this.stage);
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.future.push({ stage: this.stage, selection: [...this.selection] });
      this.stage = previous.stage;
      this.selection = new Set(previous.selection);
    }
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push({ stage: this.stage, selection: [...this.selection] });
      this.stage = next.stage;
      this.selection = new Set(next.selection);
    }
  }
  entity(id: string): Entity | undefined {
    return [...this.stage.bodies, ...this.stage.objects, ...this.stage.goals].find(
      (x) => x.id === id,
    );
  }
  duplicate() {
    this.change((s) => {
      const remap = new Map(
        [...this.selection].filter((id) => id !== 'spawn').map((id) => [id, uid()]),
      );
      const copies: Entity[] = [];
      for (const collection of [s.bodies, s.objects, s.goals])
        for (const e of [...collection])
          if (remap.has(e.id)) {
            const copy = structuredClone(e);
            copy.id = remap.get(e.id)!;
            copy.position.x += 0.3;
            copy.position.y += 0.3;
            if ('motion' in copy && copy.motion)
              copy.motion.parentId = remap.get(copy.motion.parentId) ?? copy.motion.parentId;
            if ('dependsOn' in copy) {
              copy.dependsOn = copy.dependsOn.map((id) => remap.get(id) ?? id);
            }
            if ('condition' in copy && copy.condition) {
              const remapCondition = (node: unknown): void => {
                if (!node || typeof node !== 'object') return;
                const record = node as Record<string, unknown>;
                for (const key of ['targetId', 'actorId'])
                  if (typeof record[key] === 'string')
                    record[key] = remap.get(record[key] as string) ?? record[key];
                for (const value of Object.values(record))
                  if (Array.isArray(value)) value.forEach(remapCondition);
                  else if (typeof value === 'object') remapCondition(value);
              };
              remapCondition(copy.condition);
              if (copy.display)
                copy.display.targetId = remap.get(copy.display.targetId) ?? copy.display.targetId;
            }
            (collection as Entity[]).push(copy);
            copies.push(copy);
          }
      this.selection = new Set(copies.map((e) => e.id));
    });
  }
  delete() {
    this.change((s) => {
      s.bodies = s.bodies.filter((e) => !this.selection.has(e.id));
      s.objects = s.objects.filter((e) => !this.selection.has(e.id));
      s.goals = s.goals.filter((e) => !this.selection.has(e.id));
    });
    this.selection.clear();
  }
}

// Copy a branch inside one goal without colliding with that goal's snapshot names.
export function cloneCondition(node: Condition, root: Condition): Condition {
  const copy = structuredClone(node),
    names = new Set<string>(),
    remap = new Map<string, string>();
  const walk = (value: unknown, fn: (v: Record<string, unknown>) => void): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, fn));
      return;
    }
    const record = value as Record<string, unknown>;
    fn(record);
    Object.values(record).forEach((v) => walk(v, fn));
  };
  walk(root, (v) => {
    if (v.kind === 'capture') names.add(String(v.key));
  });
  walk(copy, (v) => {
    if (v.kind !== 'capture') return;
    const original = String(v.key),
      prefix = original.slice(0, 38);
    let suffix = 2,
      name = prefix + '_copy' + suffix;
    while (names.has(name)) name = prefix + '_copy' + ++suffix;
    names.add(name);
    remap.set(original, name);
    v.key = name;
  });
  walk(copy, (v) => {
    if (v.kind === 'recorded' && remap.has(String(v.key))) v.key = remap.get(String(v.key));
  });
  return copy;
}
