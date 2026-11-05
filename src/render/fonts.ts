/** Canvas text uses the same bundled family as the interface (see src/ui/tokens.css). */
const FAMILY =
  "'Pretendard Variable', 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif";
export const canvasFont = (size = 13, weight: 'normal' | 'bold' | number = 'normal') =>
  `${weight === 'normal' ? '' : `${weight} `}${size}px ${FAMILY}`;
