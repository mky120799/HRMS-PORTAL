import { checkSamlAddressing } from './saml-checks';

const ACS = 'https://hrms.example.com/api/v1/auth/saml/callback/p1';

const assertion = (recipient: string, id = '_a1') => `
<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0">
  <saml:Subject>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData Recipient="${recipient}" NotOnOrAfter="2030-01-01T00:05:00Z"/>
    </saml:SubjectConfirmation>
  </saml:Subject>
</saml:Assertion>`;

const response = (destination?: string) =>
  `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1" Version="2.0"${destination ? ` Destination="${destination}"` : ''}></samlp:Response>`;

describe('checkSamlAddressing', () => {
  it('accepts a response addressed to this ACS URL and returns the assertion id', () => {
    const result = checkSamlAddressing(response(ACS), assertion(ACS), ACS);
    expect(result.assertionId).toBe('_a1');
    expect(result.acceptableUntil.toISOString()).toBe('2030-01-01T00:10:00.000Z');
  });

  it('accepts a response without Destination (it is optional when signed assertions carry Recipient)', () => {
    expect(() => checkSamlAddressing(response(), assertion(ACS), ACS)).not.toThrow();
  });

  it('rejects a response sent to another service provider', () => {
    expect(() => checkSamlAddressing(response('https://other.example.com/acs'), assertion(ACS), ACS)).toThrow(/Destination/);
    expect(() => checkSamlAddressing(response(ACS), assertion('https://other.example.com/acs'), ACS)).toThrow(/Recipient/);
  });

  it('rejects malformed or wrong documents', () => {
    expect(() => checkSamlAddressing('<not-xml', assertion(ACS), ACS)).toThrow();
    expect(() => checkSamlAddressing(assertion(ACS), assertion(ACS), ACS)).toThrow(/Not a SAML response/);
    expect(() => checkSamlAddressing(response(ACS), assertion(ACS, ''), ACS)).toThrow(/no ID/);
  });
});
