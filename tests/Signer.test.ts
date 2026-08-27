import * as forge from 'node-forge';
import { Signer, SignerError } from '../src/infrastructure/crypto/Signer';

/**
 * Generates a self-signed test certificate and PFX buffer in-memory.
 */
function generateTestPfx(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: 'EMPRESA TESTE LTDA' },
    { name: 'organizationName', value: 'EMPRESA TESTE LTDA' },
    { name: 'countryName', value: 'BR' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

describe('Signer', () => {
  describe('constructor — invalid PFX data', () => {
    it('should throw SignerError for corrupted PFX binary', () => {
      const invalidBuffer = Buffer.from('this is not a valid pfx file', 'utf8');

      expect(() => new Signer(invalidBuffer, 'any-password')).toThrow(SignerError);
    });

    it('should throw SignerError mentioning PFX parse failure', () => {
      const randomBytes = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        randomBytes[i] = i % 256;
      }

      expect(() => new Signer(randomBytes, 'password')).toThrow(/PFX/i);
    });
  });

  describe('constructor — wrong password', () => {
    it('should throw SignerError for incorrect PFX password', () => {
      const pfxBuffer = generateTestPfx('correct-password');

      expect(() => new Signer(pfxBuffer, 'wrong-password')).toThrow(SignerError);
    });
  });

  describe('sign — with self-signed test certificate', () => {
    it('should produce XML containing a Signature element', () => {
      const pfxBuffer = generateTestPfx('test123');
      const signer = new Signer(pfxBuffer, 'test123');

      const nfeId = 'NFe31240512345678000199550010000000011000000010';
      const sampleXml = [
        '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
        `<infNFe versao="4.00" Id="${nfeId}">`,
        '<ide><cUF>31</cUF></ide>',
        '</infNFe>',
        '</NFe>',
      ].join('');

      const signedXml = signer.sign(sampleXml, nfeId);

      expect(signedXml).toContain('<Signature');
      expect(signedXml).toContain('</Signature>');
    });

    it('should include X509Certificate in the signed XML', () => {
      const pfxBuffer = generateTestPfx('test123');
      const signer = new Signer(pfxBuffer, 'test123');

      const nfeId = 'NFe31240512345678000199550010000000011000000010';
      const sampleXml = [
        '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
        `<infNFe versao="4.00" Id="${nfeId}">`,
        '<ide><cUF>31</cUF></ide>',
        '</infNFe>',
        '</NFe>',
      ].join('');

      const signedXml = signer.sign(sampleXml, nfeId);

      expect(signedXml).toContain('X509Certificate');
    });

    it('should include the Reference URI pointing to the infNFe Id', () => {
      const pfxBuffer = generateTestPfx('test123');
      const signer = new Signer(pfxBuffer, 'test123');

      const nfeId = 'NFe31240512345678000199550010000000011000000010';
      const sampleXml = [
        '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
        `<infNFe versao="4.00" Id="${nfeId}">`,
        '<ide><cUF>31</cUF></ide>',
        '</infNFe>',
        '</NFe>',
      ].join('');

      const signedXml = signer.sign(sampleXml, nfeId);

      expect(signedXml).toContain(`Reference URI="#${nfeId}"`);
    });

    it('should throw SignerError when referenceUri does not match any element', () => {
      const pfxBuffer = generateTestPfx('test123');
      const signer = new Signer(pfxBuffer, 'test123');

      const xmlNoMatch = '<NFe><infNFe Id="NFe999"><data>test</data></infNFe></NFe>';

      expect(() => signer.sign(xmlNoMatch, 'NonExistentId')).toThrow(SignerError);
    });

    it('should return certificate info with subject and validity', () => {
      const pfxBuffer = generateTestPfx('test123');
      const signer = new Signer(pfxBuffer, 'test123');

      const info = signer.getCertificateInfo();

      expect(info.subject).toContain('EMPRESA TESTE LTDA');
      expect(info.validFrom).toBeInstanceOf(Date);
      expect(info.validTo).toBeInstanceOf(Date);
      expect(info.validTo.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
