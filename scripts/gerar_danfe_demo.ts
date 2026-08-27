/**
 * Gera XML assinado + DANFE PDF de demonstração (sem transmitir à SEFAZ).
 * Uso: npx ts-node scripts/gerar_danfe_demo.ts <payload.json>
 *
 * O PDF sai com protocolo "DEMONSTRACAO - SEM AUTORIZACAO SEFAZ" — serve para
 * conferir leiaute e dados antes do credenciamento ou de emitir de verdade.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildNFe, UF_TO_IBGE } from '../src/domain/FiscalContext';
import { generateAccessKey } from '../src/domain/NFeKeyGenerator';
import { XmlGenerator } from '../src/infrastructure/xml/XmlGenerator';
import { Signer } from '../src/infrastructure/crypto/Signer';
import { DanfeGenerator } from '../src/infrastructure/pdf/DanfeGenerator';
import { loadConfig, getPfxBuffer } from '../src/config';
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

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error('Uso: npx ts-node scripts/gerar_danfe_demo.ts <payload.json>');
    process.exit(1);
  }

  const config = loadConfig();
  const body = JSON.parse(fs.readFileSync(payloadPath, 'utf-8'));
  const ambiente = (body.ambiente || config.ambiente) as '1' | '2';

  const destRazao = ambiente === '2'
    ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
    : body.destinatario.razaoSocial;

  const ufDest = body.destinatario?.endereco?.uf || config.uf;
  const destino = ufDest === 'EX' ? '3' : (ufDest === config.uf ? '1' : '2');

  const input: FiscalContextInput = {
    emitente: {
      cnpj: config.cnpjEmitente,
      razaoSocial: config.razaoSocial,
      fantasia: config.fantasia || undefined,
      ie: config.ie,
      crt: config.crt,
      endereco: { ...config.endereco, uf: config.uf },
    },
    destinatario: { ...body.destinatario, razaoSocial: destRazao },
    itens: body.itens,
    pagamento: body.pagamento,
    serie: body.serie || '1',
    numero: body.numero || '1',
    naturezaOperacao: body.naturezaOperacao || 'VENDA',
    dataEmissao: gerarDhEmi(),
    finalidade: body.finalidade || '1',
    tipoOperacao: body.tipoOperacao || '1',
    destino,
    indFinal: body.indFinal || '1',
    presenca: body.presenca || '1',
    ambiente,
    municipioFG: config.endereco.codigoMunicipio,
    ufEmitente: config.uf,
    modFrete: body.modFrete || '9',
    informacoesAdicionais: body.informacoesAdicionais || undefined,
    pICMSUFDest: body.pICMSUFDest || undefined,
  };

  const nfe = buildNFe(input);
  const { chave, cDV } = generateAccessKey({
    cUF: nfe.ide.cUF, dhEmi: nfe.ide.dhEmi, cnpj: nfe.emit.CNPJ!,
    mod: nfe.ide.mod, serie: nfe.ide.serie, nNF: nfe.ide.nNF,
    tpEmis: nfe.ide.tpEmis, cNF: nfe.ide.cNF,
  });
  nfe.ide.cDV = cDV;

  const xml = new XmlGenerator().generateInfNFe(nfe, chave);
  const signer = new Signer(getPfxBuffer(config), config.pfxPassword);
  const signedXml = signer.sign(xml, `NFe${chave}`);

  const danfe = new DanfeGenerator();
  const pdf = await danfe.generate({
    nfe,
    chaveAcesso: chave,
    nProt: 'DEMONSTRACAO - SEM AUTORIZACAO SEFAZ',
    dhRecbto: new Date().toISOString(),
  });

  const outDir = path.resolve('output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const xmlPath = path.join(outDir, `NFe_${chave}_DEMO.xml`);
  const pdfPath = path.join(outDir, `DANFE_${chave}_DEMO.pdf`);
  fs.writeFileSync(xmlPath, signedXml, 'utf-8');
  fs.writeFileSync(pdfPath, pdf);

  console.log('Chave de acesso:', chave);
  console.log('XML assinado :', xmlPath);
  console.log('DANFE PDF    :', pdfPath);
  if (!UF_TO_IBGE[config.uf]) console.warn('AVISO: UF invalida na config');
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
