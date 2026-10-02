import { mappedRole, samlIdentity } from './sso-mapping';

describe('mappedRole', () => {
  const mapping = { 'HR-Team': 'HR_ADMIN', Engineering: 'EMPLOYEE', Owners: 'ADMIN', Bogus: 'ROOT', Regional: 'custom:REGIONAL_HR' };

  it('returns the role of the first mapped group the user belongs to (case-insensitive)', () => {
    expect(mappedRole(mapping, ['engineering', 'hr-team'])).toEqual({ role: 'HR_ADMIN' });
    expect(mappedRole(mapping, ['Engineering'])).toEqual({ role: 'EMPLOYEE' });
  });

  it('maps to workspace custom roles by key', () => {
    expect(mappedRole(mapping, ['regional'])).toEqual({ customRoleKey: 'REGIONAL_HR' });
  });

  it('never grants ADMIN or unknown roles from an IdP', () => {
    expect(mappedRole(mapping, ['Owners'])).toBeNull();
    expect(mappedRole(mapping, ['Bogus'])).toBeNull();
  });

  it('returns null without a mapping or matching group', () => {
    expect(mappedRole(null, ['HR-Team'])).toBeNull();
    expect(mappedRole(mapping, [])).toBeNull();
    expect(mappedRole(mapping, ['Sales'])).toBeNull();
  });
});

describe('samlIdentity', () => {
  it('uses common attribute names by default, falling back to NameID for email', () => {
    expect(samlIdentity({ nameID: 'Ada@Example.com', givenName: 'Ada', sn: 'Lovelace', groups: ['HR-Team'] }, null)).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      groups: ['HR-Team'],
    });
    expect(
      samlIdentity({ 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'x@corp.com' }, undefined).email,
    ).toBe('x@corp.com');
  });

  it('uses a configured attribute exclusively', () => {
    const profile = { nameID: 'opaque-id', email: 'wrong@corp.com', workEmail: 'right@corp.com', dept: 'Finance;Payroll' };
    expect(samlIdentity(profile, { email: 'workEmail', groups: 'dept' })).toMatchObject({
      email: 'right@corp.com',
      groups: ['Finance', 'Payroll'],
    });
    expect(samlIdentity({ nameID: 'a@corp.com' }, { email: 'workEmail' }).email).toBeUndefined();
  });
});
