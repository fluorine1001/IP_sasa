import cases from '../data/campaign-cases.json';
import type { StoredStage } from './workshop-storage';

/** Explicit one-shot additions; PostgreSQL's seed transaction never overwrites
 * an existing UUID or resurrects a deleted record. Do not bump for restarts. */
export const workshopCampaignVersion = 'authored-campaign-2026-10-16-v1';
export function workshopCampaignEntries(entries: readonly StoredStage[]): StoredStage[] {
  return cases.map((item) => {
    const entry = entries.find((entry) => JSON.parse(entry.raw).id === item.id);
    if (!entry || Boolean(entry.publishedRaw) !== item.published)
      throw Error('신규 임무의 초안/공개 스냅샷을 확인하세요: ' + item.id);
    return entry;
  });
}
