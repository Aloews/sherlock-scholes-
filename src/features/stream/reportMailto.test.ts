import { describe, it, expect } from 'vitest';
import { buildReportMailto } from './reportMailto';

describe('buildReportMailto', () => {
  it('builds a mailto link with encoded subject and body', () => {
    const link = buildReportMailto('abuse@example.com', 'Copyright complaint', 'Please review.');
    expect(link).toBe('mailto:abuse@example.com?subject=Copyright%20complaint&body=Please%20review.');
  });

  it('percent-encodes spaces as %20, not +', () => {
    const link = buildReportMailto('a@b.com', 'a b', 'c d');
    expect(link).not.toContain('+');
    expect(link).toContain('%20');
  });

  it('encodes special characters (&, =, newlines) safely', () => {
    const link = buildReportMailto('a@b.com', 'Q&A = test', 'line1\nline2');
    expect(link).toContain('Q%26A');
    expect(link).toContain('%3D');
    expect(link).toContain('line1%0Aline2');
  });
});
