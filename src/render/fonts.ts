/** Canvas text uses the same bundled family as the interface (see src/ui/tokens.css). */
const FAMILY = "'Jua', 'Pretendard Variable', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
/** The game's one face has one weight: `weight` is accepted for callers but never faked. */
export const canvasFont = (size = 13, _weight: 'normal' | 'bold' | number = 'normal') =>
  `${size}px ${FAMILY}`;
