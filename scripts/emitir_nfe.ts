/**
 * Script parametrizado de emissão NF-e 4.00
 *
 * Uso:
 *   npx ts-node scripts/emitir_nfe.ts <arquivo.json>
 *   npx ts-node scripts/emitir_nfe.ts scripts/exemplo_nfe.json
 *   npx ts-node scripts/emitir_nfe.ts scripts/exemplo_nfe.json --producao
 *
 * O emitente e certificado vêm do .env (via loadConfig). O JSON fornece destinatário, itens e pagamento.
 * Por padrão usa o ambiente do .env (NFE_AMBIENTE). Flag --producao força ambiente=1.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildNFe } from '../src/domain/FiscalContext';
import { generateAccessKey } from '../src/domain/NFeKeyGenerator';
import { XmlGenerator } from '../src/infrastructure/xml/XmlGenerator';
import { Signer } from '../src/infrastructure/crypto/Signer';
import { SoapClient } from '../src/infrastructure/soap/SoapClient';
import { parseAutorizacaoResponse } from '../src/infrastructure/soap/ResponseParser';
import { getEndpoints } from '../src/infrastructure/soap/SefazEndpoints';
import { XsdValidator } from '../src/infrastructure/validation/XsdValidator';
import { loadConfig } from '../src/config';
import type { FiscalContextInput } from '../src/domain/FiscalContext';

function gerarDhEmi(): string {
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Input JSON schema
// ---------------------------------------------------------------------------
interface InputJson {
  destinatario: {
    cnpj?: string;
    cpf?: string;
    razaoSocial: string;
    indIEDest: string;
    ie?: string;
    email?: string;
    endereco: {
      logradouro: string;
      numero: string;
      complemento?: string;
      bairro: string;
      codigoMunicipio: string;
      nomeMunicipio: string;
      uf: string;
      cep: string;
      fone?: string;
    };
  };
  itens: Array<{
    codigo: string;
    descricao: string;
    ncm: string;
    cfop: string;
    unidade: string;
    quantidade: string;
    valorUnitario: string;
    ean?: string;
    cest?: string;
    icms: { origem: string; cst?: string; csosn?: string; modBC?: string; vBC?: string; pICMS?: string; vICMS?: string; pRedBC?: string; vICMSDeson?: string; motDesICMS?: string };
    pis: { cst: string; aliquota?: string };
    cofins: { cst: string; aliquota?: string };
  }>;
  pagamento: { formas: Array<{ tipo: string; valor: string }>; troco?: string };
  serie: string;
  numero: string;
  naturezaOperacao: string;
  finalidade?: string;
  tipoOperacao?: string;
  destino?: string;
  presenca?: string;
  modFrete?: string;
  informacoesAdicionais?: { fisco?: string; complementar?: string };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const jsonPath = args.find(a => !a.startsWith('--'));
  const forceProducao = args.includes('--producao');

  if (!jsonPath) {
    console.error('Uso: npx ts-node scripts/emitir_nfe.ts <arquivo.json> [--producao]');
    console.error('Exemplo: npx ts-node scripts/emitir_nfe.ts scripts/exemplo_nfe.json');
    process.exit(1);
  }

  const resolvedPath = path.resolve(jsonPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Arquivo nao encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  const inputData: InputJson = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  const config = loadConfig();
  const ambiente = forceProducao ? '1' : config.ambiente;

  const ambienteLabel = ambiente === '1' ? 'PRODUCAO' : 'HOMOLOGACAO';
  console.log(`=== EMISSAO NF-e ${ambienteLabel} ===\n`);
  console.log(`Emitente: ${config.razaoSocial} (${config.cnpjEmitente}) — ${config.uf}`);

  const destRazao = ambiente === '2'
    ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
    : inputData.destinatario.razaoSocial;

  const fiscalInput: FiscalContextInput = {
    emitente: {
      cnpj: config.cnpjEmitente,
      razaoSocial: config.razaoSocial,
      fantasia: config.fantasia || undefined,
      ie: config.ie,
      crt: config.crt,
      endereco: {
        logradouro: config.endereco.logradouro,
        numero: config.endereco.numero,
        complemento: config.endereco.complemento,
        bairro: config.endereco.bairro,
        codigoMunicipio: config.endereco.codigoMunicipio,
        nomeMunicipio: config.endereco.nomeMunicipio,
        uf: config.uf,
        cep: config.endereco.cep,
        fone: config.endereco.fone,
      },
    },
    destinatario: {
      cnpj: inputData.destinatario.cnpj,
      cpf: inputData.destinatario.cpf,
      razaoSocial: destRazao,
      indIEDest: inputData.destinatario.indIEDest,
      ie: inputData.destinatario.ie,
      email: inputData.destinatario.email,
      endereco: inputData.destinatario.endereco,
    },
    itens: inputData.itens,
    pagamento: inputData.pagamento,
    serie: inputData.serie,
    numero: inputData.numero,
    naturezaOperacao: inputData.naturezaOperacao,
    dataEmissao: gerarDhEmi(),
    finalidade: inputData.finalidade || '1',
    tipoOperacao: inputData.tipoOperacao || '1',
    destino: inputData.destino || '1',
    presenca: inputData.presenca || '1',
    ambiente,
    municipioFG: config.endereco.codigoMunicipio,
    ufEmitente: config.uf,
    modFrete: inputData.modFrete,
    informacoesAdicionais: inputData.informacoesAdicionais,
  };

  // 1. Build NFe
  console.log('\n1. Construindo NF-e...');
  const nfe = buildNFe(fiscalInput);
  console.log('   Destinatario:', nfe.dest.CNPJ || nfe.dest.CPF);
  console.log('   Itens:', nfe.det.length);
  console.log('   vProd:', nfe.total.ICMSTot.vProd, ' vNF:', nfe.total.ICMSTot.vNF);

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

  // 3. Generate XML
  console.log('\n3. Gerando XML...');
  const xmlGen = new XmlGenerator();
  const xml = xmlGen.generateInfNFe(nfe, chaveAcesso);
  console.log('   XML:', xml.length, 'chars');

  // 4. Validate structurally
  console.log('\n4. Validacao estrutural...');
  const validator = new XsdValidator('./schemas');
  const validation = validator.validate(xml);
  if (!validation.valid) {
    console.error('   ERROS DE VALIDACAO:');
    for (const err of validation.errors) {
      console.error('   -', err.message, err.path ? `(${err.path})` : '');
    }
    process.exit(1);
  }
  console.log('   XML valido');

  // 5. Sign
  console.log('\n5. Assinando XML...');
  const pfxBuffer = fs.readFileSync(config.pfxPath);
  const signer = new Signer(pfxBuffer, config.pfxPassword);
  const certInfo = signer.getCertificateInfo();
  console.log('   Certificado:', certInfo.subject.substring(0, 80));
  console.log('   Valido ate:', certInfo.validTo);
  const signedXml = signer.sign(xml, `NFe${chaveAcesso}`);
  console.log('   Assinado:', signedXml.length, 'chars');

  // 6. Wrap envelope
  console.log('\n6. Montando lote...');
  const loteId = Date.now().toString();
  const envelope = xmlGen.wrapEnvelope(signedXml, loteId);

  // Save debug files
  const debugDir = path.resolve('debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, 'nfe_xml.txt'), xml, 'utf-8');
  fs.writeFileSync(path.join(debugDir, 'nfe_signed.txt'), signedXml, 'utf-8');
  fs.writeFileSync(path.join(debugDir, 'nfe_envelope.txt'), envelope, 'utf-8');
  console.log('   Debug salvo em debug/');

  // 7. Send to SEFAZ
  const endpoints = getEndpoints(config.uf, ambiente);
  console.log(`\n7. Enviando para SEFAZ ${config.uf} ${ambienteLabel}...`);
  console.log('   Endpoint:', endpoints.NfeAutorizacao);

  const soapClient = new SoapClient({
    timeout: config.timeoutMs,
    pfxBuffer,
    pfxPassword: config.pfxPassword,
  });

  try {
    const responseXml = await soapClient.send(
      envelope,
      endpoints.NfeAutorizacao,
      'NfeAutorizacao',
    );

    // 8. Parse response
    console.log('\n=== RESPOSTA SEFAZ ===');
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
        console.log('Chave de acesso:', chaveAcesso);
        console.log('Protocolo:', prot.nProt);

        const outPath = path.resolve('output');
        if (!fs.existsSync(outPath)) fs.mkdirSync(outPath, { recursive: true });
        const nfeFileName = `NFe_${chaveAcesso}.xml`;
        fs.writeFileSync(path.join(outPath, nfeFileName), signedXml, 'utf-8');
        console.log(`XML salvo: output/${nfeFileName}`);
      } else {
        console.log('\n*** NF-e REJEITADA ***');
        console.log('Corrija o problema e tente novamente.');
        process.exit(1);
      }
    }
  } catch (err: any) {
    console.error('\n=== ERRO ===');
    console.error(err.message);
    if (err.soapFault) console.error('SOAP Fault:', err.soapFault);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
