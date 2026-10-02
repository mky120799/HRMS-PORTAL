import { DOMParser } from '@xmldom/xmldom';

const PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';

export class SamlCheckError extends Error {}

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message: string) => errors.push(message),
      fatalError: (message: string) => errors.push(message),
    },
  }).parseFromString(xml, 'text/xml');
  if (errors.length || !doc?.documentElement) throw new SamlCheckError('Malformed SAML XML');
  return doc;
}

/**
 * Checks `@node-saml/node-saml` leaves to the application: that the response was
 * addressed to *this* ACS URL. Without it, a signed assertion an IdP issued for a
 * different service provider that trusts the same IdP could be posted here.
 *
 * - `Response/@Destination`, when present, must equal the ACS URL.
 * - The validated (signed) assertion must contain a bearer
 *   `SubjectConfirmationData` whose `Recipient` equals the ACS URL.
 *
 * Returns the assertion ID and the latest moment it could still be accepted,
 * for single-use (replay) enforcement.
 */
export function checkSamlAddressing(samlResponseXml: string, assertionXml: string, acsUrl: string) {
  const response = parse(samlResponseXml).documentElement!;
  if (response.localName !== 'Response' || response.namespaceURI !== PROTOCOL_NS) {
    throw new SamlCheckError('Not a SAML response');
  }
  const destination = response.getAttribute('Destination');
  if (destination && destination !== acsUrl) throw new SamlCheckError('SAML response Destination does not match this service');

  const assertion = parse(assertionXml).documentElement!;
  if (assertion.localName !== 'Assertion' || assertion.namespaceURI !== ASSERTION_NS) {
    throw new SamlCheckError('Not a SAML assertion');
  }
  const assertionId = assertion.getAttribute('ID');
  if (!assertionId) throw new SamlCheckError('SAML assertion has no ID');

  const confirmations = Array.from(assertion.getElementsByTagNameNS(ASSERTION_NS, 'SubjectConfirmationData'));
  const matching = confirmations.find((node) => node.getAttribute('Recipient') === acsUrl);
  if (!matching) throw new SamlCheckError('SAML assertion Recipient does not match this service');

  const notOnOrAfter = matching.getAttribute('NotOnOrAfter');
  const parsed = notOnOrAfter ? Date.parse(notOnOrAfter) : NaN;
  return {
    assertionId,
    // Keep the replay record until the assertion could no longer be accepted (expiry plus clock skew).
    acceptableUntil: new Date((Number.isFinite(parsed) ? parsed : Date.now() + 5 * 60_000) + 5 * 60_000),
  };
}
