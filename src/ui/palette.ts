/* Canvas mirror of src/ui/tokens.css. Canvas cannot read CSS variables cheaply every
 * frame, so the few colours the renderer needs are repeated here with the same names.
 * Keep the two files in step (tests/palette.test.ts checks it). */
export const palette = {
  n950: '#090d20',
  n900: '#0e1430',
  n700: '#38415c',
  n300: '#97a0b8',
  n50: '#ffffff',
  amber400: '#f6b23c',
  green400: '#7fd35a',
  red200: '#ffaaa0',
  red400: '#f05a4f',
  yellow400: '#ffd84a',
  sky200: '#a9ddff',
  sky400: '#56b4f0',
} as const;
