import { EmailTemplates, escapeHtml } from './templates';

describe('email templates', () => {
  it('escapes user-controlled values', () => {
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    const email = EmailTemplates.applicationStatus({ candidateName: '<script>alert(1)</script>', jobTitle: 'Dev', companyName: 'Acme', status: 'REJECTED' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
