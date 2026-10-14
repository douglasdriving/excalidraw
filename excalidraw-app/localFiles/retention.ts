// Version-history thinning: recent history is kept in full, older history is
// thinned to progressively sparser snapshots. Shared by the dev-server plugin
// (which prunes) and the UI (which explains the policy).

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type RetentionTier = {
  /** versions younger than this fall into the tier */
  maxAge: number;
  /** keep one version per bucket of this size; 0 = keep every version */
  bucket: number;
  label: string;
};

export const RETENTION_TIERS: readonly RetentionTier[] = [
  { maxAge: 15 * MINUTE, bucket: 0, label: "Last 15 minutes: every save" },
  {
    maxAge: 2 * HOUR,
    bucket: 5 * MINUTE,
    label: "Last 2 hours: one per 5 min",
  },
  { maxAge: 2 * DAY, bucket: HOUR, label: "Last 2 days: one per hour" },
  { maxAge: 30 * DAY, bucket: DAY, label: "Last 30 days: one per day" },
  { maxAge: Infinity, bucket: 7 * DAY, label: "Older: one per week" },
];

/**
 * Given version timestamps (ms), returns the ones to delete. Keeps the newest
 * version in each bucket; buckets are aligned to absolute time so repeated
 * pruning is stable. The newest version overall is always kept.
 */
export const getVersionsToPrune = (
  timestamps: readonly number[],
  now: number,
): number[] => {
  const sorted = [...timestamps].sort((a, b) => b - a);
  const keptBuckets = new Set<string>();
  const prune: number[] = [];

  sorted.forEach((timestamp, index) => {
    if (index === 0) {
      return;
    }
    const age = Math.max(0, now - timestamp);
    const tierIndex = RETENTION_TIERS.findIndex((tier) => age < tier.maxAge);
    const tier = RETENTION_TIERS[tierIndex];
    if (tier.bucket === 0) {
      return;
    }
    const key = `${tierIndex}:${Math.floor(timestamp / tier.bucket)}`;
    if (keptBuckets.has(key)) {
      prune.push(timestamp);
    } else {
      keptBuckets.add(key);
    }
  });

  return prune;
};
