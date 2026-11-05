/* Canvas mirror of src/ui/tokens.css. Canvas cannot read CSS variables cheaply every
 * frame, so the few colours the renderer needs are repeated here with the same names.
 * Keep the two files in step (tests/palette.test.ts checks it). */
export const palette = {
  n950: '#0b1418',
  n900: '#101b20',
  n700: '#2a3942',
  n300: '#8b9a9b',
  n50: '#f4ecd5',
  amber400: '#f2b54a',
  green400: '#6fbf73',
  red200: '#f3a091',
  red400: '#e05a44',
  yellow400: '#f2cf4a',
  sky200: '#ade0f7',
  sky400: '#5eb2e8',
} as const;
