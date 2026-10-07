// How the API spells a segment's publish interval, in words.

const HOUR_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6, eight: 8, twelve: 12, twentyfour: 24 };

export function describePublishInterval(v?: string): string {
  const f = (v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!f) return 'unknown';
  if (['norefresh', 'notscheduled', 'none'].includes(f)) return 'not scheduled';
  const hours = HOUR_WORDS[f];
  if (hours) return hours === 1 ? 'every hour' : `every ${hours} hours`;
  return (v ?? '').toLowerCase().replace(/_/g, ' ');
}
