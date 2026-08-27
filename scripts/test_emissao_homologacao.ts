import * as fs from 'fs';
import { buildNFe } from '../src/domain/FiscalContext';
import { generateAccessKey } from '../src/domain/NFeKeyGenerator';
import { XmlGenerator } from '../src/infrastructure/xml/XmlGenerator';
import { Signer } from '../src/infrastructure/crypto/Signer';
import { SoapClient } from '../src/infrastructure/soap/SoapClient';
import { parseAutorizacaoResponse } from '../src/infrastructure/soap/ResponseParser';
import { getEndpoints } from '../src/infrastructure/soap/SefazEndpoints';
import { XsdValidator } from '../src/infrastructure/validation/XsdValidator';

async function main() {
  const pfxPath = 'C:/Users/Usuario/Downloads/170225080666e798.pfx';
  const pfxPassword = 'Lidera123';

  console.log('=== EMISSAO NF-e HOMOLOGACAO ===\n');

  // 1. Build NFe
  console.log('1. Construindo NF-e...');
  const nfe = buildNFe({
    emitente: {
      cnpj: '62050825000178',
      razaoSocial: 'LIDERA AGRO COMERCIALIZACAO E PRODUCAO DE FRUTAS LTDA',
      fantasia: 'LIDERA AGRO QUALIDADE E COMPROMISSO',
      ie: '0052668460000',
      crt: '3',
      endereco: {
        logradouro: 'EST LINHA UM',
        numero: '642',
        bairro: 'BELA VISTA',
        codigoMunicipio: '3135050',
        nomeMunicipio: 'JAIBA',
        uf: 'MG',
        cep: '39508000',
      },
    },
    destinatario: {
      cnpj: '62050825000178',
      razaoSocial: 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      endereco: {
        logradouro: 'EST LINHA UM',
        numero: '642',
        bairro: 'BELA VISTA',
        codigoMunicipio: '3135050',
        nomeMunicipio: 'JAIBA',
        uf: 'MG',
        cep: '39508000',
      },
      indIEDest: '1',
      ie: '0052668460000',
    },
    itens: [{
      codigo: '001',
      descricao: 'MANGA TOMMY ATKINS',
      ncm: '08045020',
      cfop: '5102',
      unidade: 'KG',
      quantidade: '1.0000',
      valorUnitario: '5.00',
      icms: { origem: '0', cst: '00', modBC: '3', vBC: '5.00', pICMS: '18.00', vICMS: '0.90' },
      pis: { cst: '99' },
      cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '5.00' }] },
    serie: '1',
    numero: '1',
    naturezaOperacao: 'VENDA',
    dataEmissao: (() => {
      const now = new Date();
      const off = -now.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
      const mm = String(Math.abs(off) % 60).padStart(2, '0');
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${hh}:${mm}`;
    })(),
    finalidade: '1',
    tipoOperacao: '1',
    destino: '1',
    presenca: '1',
    ambiente: '2',
    municipioFG: '3135050',
    ufEmitente: 'MG',
  });
  console.log('   NFe construida: emit=', nfe.emit.CNPJ, 'dest=', nfe.dest.CNPJ);
  console.log('   vProd=', nfe.total.ICMSTot.vProd, 'vNF=', nfe.total.ICMSTot.vNF);

  // 2. Generate access key
  console.log('\n2. Gerando chave de acesso...');
  const { chave: chaveAcesso, cDV } = generateAccessKey({
    cUF: nfe.ide.cUF,
    dhEmi: nfe.ide.dhEmi,
    cnpj: nfe.emit.CNPJ!,
    mod: nfe.ide.mod,
    serie: nfe.ide.serie,
    nNF: nfe.ide.nNF,
    tpEmis: nfe.ide.tpEmis,
    cNF: nfe.ide.cNF,
  });
  nfe.ide.cDV = cDV;
  console.log('   Chave:', chaveAcesso);
  console.log('   DV:', cDV);

  // 3. Generate XML
  console.log('\n3. Gerando XML...');
  const xmlGen = new XmlGenerator();
  const xml = xmlGen.generateInfNFe(nfe, chaveAcesso);
  console.log('   XML gerado:', xml.length, 'chars');

  // 4. Validate structurally
  console.log('\n4. Validacao estrutural...');
  const validator = new XsdValidator('./schemas');
  const validation = validator.validate(xml);
  if (!validation.valid) {
    console.log('   ERROS:');
    for (const err of validation.errors) {
      console.log('   -', err.message, err.path ? `(${err.path})` : '');
    }
    return;
  }
  console.log('   XML valido estruturalmente');

  // 5. Sign XML
  console.log('\n5. Assinando XML...');
  const pfxBuffer = fs.readFileSync(pfxPath);
  const signer = new Signer(pfxBuffer, pfxPassword);
  const certInfo = signer.getCertificateInfo();
  console.log('   Certificado:', certInfo.subject.substring(0, 80));
  console.log('   Valido ate:', certInfo.validTo);

  const signedXml = signer.sign(xml, `NFe${chaveAcesso}`);
  console.log('   XML assinado:', signedXml.length, 'chars');
  console.log('   Possui <Signature>:', signedXml.includes('<Signature'));

  // 6. Wrap in SOAP envelope
  console.log('\n6. Montando lote...');
  const loteId = Date.now().toString();
  const envelope = xmlGen.wrapEnvelope(signedXml, loteId);
  console.log('   Lote ID:', loteId);

  // DEBUG: Save full XML for analysis
  fs.writeFileSync('./debug_nfe_xml.txt', xml, 'utf-8');
  fs.writeFileSync('./debug_signed_xml.txt', signedXml, 'utf-8');
  fs.writeFileSync('./debug_envelope.txt', envelope, 'utf-8');
  console.log('   DEBUG: XML files saved');

  // 7. Send to SEFAZ
  console.log('\n7. Enviando para SEFAZ MG homologacao...');
  const soapClient = new SoapClient({
    timeout: 30000,
    pfxBuffer,
    pfxPassword,
  });

  const endpoints = getEndpoints('MG', '2');
  console.log('   Endpoint:', endpoints.NfeAutorizacao);

  // Debug: print what SoapClient will send
  const debugSoap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">',
    '  <soap12:Header/>',
    '  <soap12:Body>',
    '    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">',
    `      ${envelope}`,
    '    </nfeDadosMsg>',
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n');
  console.log('\n--- DEBUG: SOAP Envelope (first 2000 chars) ---');
  console.log(debugSoap.substring(0, 2000));
  console.log('--- END DEBUG ---\n');

  try {
    const responseXml = await soapClient.send(
      envelope,
      endpoints.NfeAutorizacao,
      'NfeAutorizacao',
    );

    console.log('\n=== RESPOSTA SEFAZ ===');
    console.log(responseXml.substring(0, 3000));

    // 8. Parse response
    console.log('\n=== PARSING ===');
    const parsed = parseAutorizacaoResponse(responseXml);
    console.log('cStat (lote):', parsed.cStat);
    console.log('xMotivo (lote):', parsed.xMotivo);

    if (parsed.protNFe) {
      const prot = parsed.protNFe.infProt;
      console.log('\n--- Protocolo ---');
      console.log('cStat:', prot.cStat);
      console.log('xMotivo:', prot.xMotivo);
      console.log('nProt:', prot.nProt);
      console.log('chNFe:', prot.chNFe);
      console.log('dhRecbto:', prot.dhRecbto);

      if (prot.cStat === '100') {
        console.log('\n*** NF-e AUTORIZADA COM SUCESSO! ***');
      } else {
        console.log('\n*** NF-e REJEITADA ***');
      }
    }
  } catch (err: any) {
    console.error('\n=== ERRO ===');
    console.error(err.message);
    if (err.soapFault) console.error('SOAP Fault:', err.soapFault);
  }
}

main().catch(console.error);
