/* String table. Korean is the only shipped language; screens look strings up by key so
 * another language is a new table, not a code change. `{name}` placeholders are filled
 * from `vars`. Missing keys fall back to the key itself so gaps are visible in testing. */
import { ko } from './ko';

export type StringKey = keyof typeof ko;
const tables: Record<string, Partial<Record<StringKey, string>>> = { ko };
let language = 'ko';
export const setLanguage = (code: string) => {
  if (tables[code]) language = code;
};
export function t(key: StringKey, vars: Record<string, string | number> = {}) {
  const text = tables[language]?.[key] ?? ko[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
