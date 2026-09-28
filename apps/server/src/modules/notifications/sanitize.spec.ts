import { sanitizeRichText } from './notifications.service';

describe('sanitizeRichText', () => {
  it('keeps formatting but strips scripts, handlers and unsafe links', () => {
    const out = sanitizeRichText('<p onclick="x()">Hi <strong>all</strong><script>alert(1)</script><a href="javascript:evil()">x</a><a href="https://ok.test">ok</a></p>');
    expect(out).toContain('<strong>all</strong>');
    expect(out).not.toMatch(/script|onclick|javascript:/);
    expect(out).toContain('href="https://ok.test"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
