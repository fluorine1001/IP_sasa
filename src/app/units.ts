/** Player-facing unit labels. Metric definitions keep their own notation for the workshop. */
const DISPLAY: Record<string, string> = {
  u: 'u',
  'u/t': 'u/s',
  'u/t²': 'u/s²',
  초: '초',
  t: '초',
  rad: 'rad',
  회: '회',
  질량: '',
  '0 또는 1': '',
  '0~1': '',
};

export function unitLabel(unit: string | undefined): string {
  if (!unit) return '';
  return unit in DISPLAY ? DISPLAY[unit] : unit;
}

/** Number plus unit with a thin space, e.g. "0.85 u". */
export function withUnit(text: string, unit: string | undefined): string {
  const label = unitLabel(unit);
  return label ? `${text} ${label}` : text;
}
