import * as fs from 'fs';
import axios from 'axios';
import * as https from 'https';
import * as forge from 'node-forge';

async function main() {
  const pfxPath = 'C:/Users/Usuario/Downloads/170225080666e798.pfx';
  const pfxPassword = 'Lidera123';
  const cnpj = '62050825000178';

  console.log('=== CONSULTA CADASTRO CONTRIBUINTE MG ===\n');

  const pfxBuffer = fs.readFileSync(pfxPath);
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pfxPassword);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];

  let cert = '';
  const ca: string[] = [];
  for (const bag of certBags) {
    if (bag.cert) {
      const pem = forge.pki.certificateToPem(bag.cert);
      if (bag.cert.subject.getField('CN')?.value?.includes(':')) cert = pem;
      else ca.push(pem);
    }
  }
  if (!cert && certBags.length > 0 && certBags[0].cert) {
    cert = forge.pki.certificateToPem(certBags[0].cert);
  }
  const key = keyBags.length > 0 && keyBags[0].key ? forge.pki.privateKeyToPem(keyBags[0].key) : '';

  const agent = new https.Agent({ cert, key, ca, rejectUnauthorized: false });

  const consXml = `<ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>MG</UF><CNPJ>${cnpj}</CNPJ></infCons></ConsCad>`;

  const envelope = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">',
    '  <soap12:Header/>',
    '  <soap12:Body>',
    '    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4">',
    `      ${consXml}`,
    '    </nfeDadosMsg>',
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n');

  // Cadastro sempre consulta a base de producao
  const endpoint = 'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4';
  console.log('Endpoint:', endpoint);

  const response = await axios.post(endpoint, envelope, {
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    timeout: 30000,
    httpsAgent: agent,
    responseType: 'text',
    validateStatus: () => true,
  });

  console.log('\n=== RESPOSTA (status', response.status, ') ===');
  console.log(String(response.data).substring(0, 5000));
}

main().catch((e) => console.error('ERRO:', e.message));
