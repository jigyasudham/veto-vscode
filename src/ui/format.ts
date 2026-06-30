// Small, pure formatting helpers shared by the status bar and HUD.

export function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Verdict glyph used in the HUD header badge. */
export function verdictGlyph(verdict: string | undefined): string {
  switch ((verdict ?? '').toUpperCase()) {
    case 'GREEN':  return '●';
    case 'RED':    return '●';
    case 'YELLOW': return '●';
    default:       return '○';
  }
}

/** A unicode progress bar, e.g. ▓▓▓▓░░░░░ for a 0–100 percentage. */
export function bar(pct: number, width = 9): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}
