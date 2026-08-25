/**
 * Builds a `mailto:` link for a rights-holder complaint about the Live TV
 * relay (see docs/ADR/0004). Kept as a pure function so the encoding is
 * unit-testable without a DOM.
 */
export function buildReportMailto(contact: string, subject: string, body: string): string {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${contact}?${params.toString().replace(/\+/g, '%20')}`;
}
