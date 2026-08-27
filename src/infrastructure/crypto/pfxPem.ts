import * as forge from 'node-forge';

/**
 * Extrai cert + chave privada + cadeia (PEM) de um certificado A1 (.pfx).
 *
 * Por que não passar o `.pfx` direto pro `https` do Node: o OpenSSL 3 (Node 18+,
 * runtime da Vercel) recusa PKCS12 com criptografia legada — comum nos A1
 * brasileiros — com "Unsupported PKCS12 PFX data". O node-forge lê o PFX por
 * conta própria e devolve PEM, que o TLS aceita sem depender do OpenSSL 3.
 *
 * Regra do `cert` x `ca`: no A1 brasileiro o certificado do titular tem o CNPJ
 * no CN (contém ":"); os demais bags são a cadeia (CA). Se nada casar, cai no
 * primeiro certificado.
 */
export function extractPemFromPfx(
  pfxBuffer: Buffer,
  password: string,
): { cert: string; key: string; ca: string[] } {
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];

  let cert = '';
  const ca: string[] = [];

  for (const bag of certBags) {
    if (bag.cert) {
      const pem = forge.pki.certificateToPem(bag.cert);
      if (bag.cert.subject.getField('CN')?.value?.includes(':')) {
        cert = pem;
      } else {
        ca.push(pem);
      }
    }
  }

  if (!cert && certBags.length > 0 && certBags[0].cert) {
    cert = forge.pki.certificateToPem(certBags[0].cert);
  }

  let key = '';
  if (keyBags.length > 0 && keyBags[0].key) {
    key = forge.pki.privateKeyToPem(keyBags[0].key);
  }

  return { cert, key, ca };
}
