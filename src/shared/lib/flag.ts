// ISO 3166-1 alpha-2 country code -> emoji flag.
//
// Regular two-letter codes become regional-indicator pairs (RU -> 🇷🇺). The
// three UK home nations that have their own emoji use subdivision tag
// sequences (GB-ENG/GB-SCT/GB-WLS); everything else without a valid two-letter
// code (e.g. historical states stored as nothing) yields null -> no flag.

// 🏴 + lowercase subdivision tag chars + cancel tag.
function tagFlag(subdivision: string): string {
  const base = String.fromCodePoint(0x1f3f4);
  const tags = [...subdivision]
    .map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0)))
    .join('');
  return base + tags + String.fromCodePoint(0xe007f);
}

const SUBDIVISION_FLAGS: Record<string, string> = {
  'GB-ENG': tagFlag('gbeng'),
  'GB-SCT': tagFlag('gbsct'),
  'GB-WLS': tagFlag('gbwls'),
};

export function isoToFlag(code?: string | null): string | null {
  if (!code) return null;
  if (SUBDIVISION_FLAGS[code]) return SUBDIVISION_FLAGS[code];
  const cc = code.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}
