import * as I from '../interval';
import type { Term } from './nonlinear-relation';

type Form = ReadonlyMap<Term, number>;

/** Exact integer linear combinations of shared real DAG terms. Opaque nonlinear
 * terms stay atoms; no independence assumption or coefficient rounding. A size
 * cap drops ONLY tightening (back to interval arithmetic), never solutions.
 * This is an enclosure aid, not native-float reassociation or a physics solver. */
export class AdditiveEnclosure {
  private forms = new Map<Term, Form>();
  constructor(
    private range: (t: Term) => I.Interval,
    private capacity = 64,
  ) {}
  private form(t: Term): Form {
    return this.forms.get(t) ?? new Map([[t, 1]]);
  }
  private combine(x: Term, y: Term, sign: 1 | -1): Form | undefined {
    const result = new Map(this.form(x));
    for (const [term, coefficient] of this.form(y)) {
      const value = (result.get(term) ?? 0) + sign * coefficient;
      if (!Number.isSafeInteger(value)) return;
      if (value === 0) result.delete(term);
      else result.set(term, value);
    }
    if (result.size <= this.capacity) return result;
  }
  private enclose(form: Form) {
    let result = I.point(0);
    for (const [term, coefficient] of form) {
      const range = this.range(term),
        scaled = coefficient === 1 ? range : I.times(I.point(coefficient), range);
      result = result.lo === 0 && result.hi === 0 ? scaled : I.plus(result, scaled);
    }
    return result;
  }
  /** Call only when both operands are defined over the WHOLE assumption box. */
  sum(term: Term, x: Term, y: Term, sign: 1 | -1) {
    const form = this.combine(x, y, sign);
    if (!form) return;
    this.forms.set(term, form);
    return this.enclose(form);
  }
  difference(x: Term, y: Term) {
    const form = this.combine(x, y, -1);
    return form && this.enclose(form);
  }
}
