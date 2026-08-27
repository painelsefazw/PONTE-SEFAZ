/**
 * Valida o XML gerado contra o XSD oficial da SEFAZ.
 *
 * O `XsdValidator` do projeto confere presenca de campo, nao schema — ordem de
 * elemento passa por ele e e rejeitada pela SEFAZ com cStat 225, que aponta o
 * campo seguinte ao errado e nao ajuda a achar a causa. Este teste fecha essa
 * folga no unico lugar onde ela aparece de graca: antes de transmitir.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';

const SCHEMAS = path.join(__dirname, '../../schemas');
const CHAVE = '35260850229544000106558000000000421234567890';

function makeInput(over: Partial<FiscalContextInput> = {}): FiscalContextInput {
  return {
    emitente: {
      cnpj: '50229544000106', razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '454941321110', crt: '1',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO', codigoMunicipio: '3530607',
        nomeMunicipio: 'MOGI DAS CRUZES', uf: 'SP', cep: '08810240',
      },
    },
    destinatario: {
      cnpj: '33645647000120', razaoSocial: 'CLIENTE LTDA',
      indIEDest: '1', ie: '454635504116',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO', codigoMunicipio: '3530607',
        nomeMunicipio: 'MOGI DAS CRUZES', uf: 'SP', cep: '08810240',
      },
    },
    itens: [{
      codigo: '682700', descricao: 'CANETA DE BISTURI ELETRICA', ncm: '90189029',
      cfop: '5102', unidade: 'UN', quantidade: '2', valorUnitario: '1265.00',
      icms: { origem: '0', csosn: '102' }, pis: { cst: '99' }, cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '2530.00' }] },
    naturezaOperacao: 'VENDA DE MERCADORIA', serie: '800', numero: '42',
    dataEmissao: '2026-08-03T10:00:00-03:00', finalidade: '1', tipoOperacao: '1',
    destino: '1', indFinal: '1', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
    ...over,
  };
}

function gerarXml(over: Partial<FiscalContextInput> = {}): string {
  const infNFe = new XmlGenerator().generateInfNFe(buildNFe(makeInput(over)), CHAVE);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${infNFe}`;
}

async function validar(xml: string): Promise<{ errors: string[] }> {
  const { validateXML } = require('xmllint-wasm/index-node.js');
  const preload = fs.readdirSync(SCHEMAS)
    .filter(f => f.endsWith('.xsd'))
    .map(f => ({ fileName: f, contents: fs.readFileSync(path.join(SCHEMAS, f), 'utf8') }));

  const r = await validateXML({
    xml: [{ fileName: 'nota.xml', contents: xml }],
    schema: [fs.readFileSync(path.join(SCHEMAS, 'nfe_v4.00.xsd'), 'utf8')],
    preload,
  });
  const errors: string[] = (r.errors || [])
    .map((e: any) => e.message || e.rawMessage || String(e));

  // A assinatura entra depois, no Signer — validar aqui e de proposito: o
  // objetivo e pegar erro de estrutura antes de assinar. A unica queixa
  // esperada e a Signature ausente; qualquer outra e defeito de verdade.
  return { errors: errors.filter(m => !m.includes('xmldsig#}Signature')) };
}

describe('XML da NF-e contra o XSD oficial', () => {
  jest.setTimeout(120_000);

  test('nota com vTotTrib e demonstrativo IBS/CBS valida no schema', async () => {
    const { errors } = await validar(gerarXml({
      informacoesAdicionais: { complementar: 'PEDIDO 4471' },
    }));
    expect(errors).toEqual([]);
  });

  test('vTotTrib sai depois de vNF, no fim do ICMSTot', () => {
    const xml = gerarXml();
    expect(xml).toMatch(/<vNF>[\d.]+<\/vNF><vTotTrib>[\d.]+<\/vTotTrib><\/ICMSTot>/);
  });

  test('nota do regime normal com ST valida no schema', async () => {
    const { errors } = await validar(gerarXml({
      emitente: { ...makeInput().emitente, crt: '3' },
      itens: [{
        ...makeInput().itens[0],
        cest: '1300100',
        icms: {
          origem: '0', cst: '10', modBC: '3', vBC: '2530.00',
          pICMS: '18.00', vICMS: '455.40',
          modBCST: '4', pMVAST: '40.00', vBCST: '3542.00',
          pICMSST: '18.00', vICMSST: '182.16',
        },
      }],
    }));
    expect(errors).toEqual([]);
  });
});
