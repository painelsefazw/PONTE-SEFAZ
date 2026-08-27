import * as fs from 'fs';
import { SoapClient } from '../src/infrastructure/soap/SoapClient';
import { StatusServicoXmlGenerator } from '../src/infrastructure/xml/StatusServicoXmlGenerator';
import { parseStatusServicoResponse } from '../src/infrastructure/soap/ResponseParser';
import { getEndpoints } from '../src/infrastructure/soap/SefazEndpoints';

async function main() {
  const pfxPath = 'C:/Users/Usuario/Downloads/170225080666e798.pfx';
  const pfxPassword = 'Lidera123';

  console.log('=== TESTE SEFAZ HOMOLOGACAO (via SoapClient) ===');

  const pfxBuffer = fs.readFileSync(pfxPath);
  console.log('PFX carregado:', pfxBuffer.length, 'bytes');

  const soapClient = new SoapClient({
    timeout: 30000,
    pfxBuffer,
    pfxPassword,
  });
  console.log('SoapClient criado com sucesso');

  const xmlGen = new StatusServicoXmlGenerator();
  const xml = xmlGen.generate('2', '31');

  const endpoints = getEndpoints('MG', '2');
  console.log('Endpoint:', endpoints.NfeStatusServico);

  try {
    console.log('\nEnviando StatusServico...');
    const response = await soapClient.send(
      xml,
      endpoints.NfeStatusServico,
      'NfeStatusServico',
    );

    const parsed = parseStatusServicoResponse(response);
    console.log('\n=== RESULTADO ===');
    console.log('cStat:', parsed.cStat);
    console.log('xMotivo:', parsed.xMotivo);
    console.log('tpAmb:', parsed.tpAmb);
    console.log('cUF:', parsed.cUF);
    console.log('dhRecbto:', parsed.dhRecbto);
    console.log('\n*** SEFAZ MG HOMOLOGACAO:', parsed.cStat === '107' ? 'ONLINE ***' : 'OFFLINE ***');
  } catch (err: any) {
    console.error('\nERRO:', err.message);
  }
}

main();
