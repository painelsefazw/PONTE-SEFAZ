import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';

/**
 * PIS e COFINS — cada CST pertence a um grupo diferente no XSD:
 *
 *   PISAliq  CST 01, 02       tributado, com base e alíquota
 *   PISNT    CST 04 a 08      não tributado, só o CST
 *   PISOutr  CST 49 a 99      demais operações
 *
 * O motor mandava tudo que não fosse 01/02 para PISOutr com CST fixo em 99.
 * Escolher "isenta" produzia "outras operações" — a nota autoriza e sai com a
 * tributação errada, que é o pior tipo de defeito fiscal.
 */

function contexto(pisCst: string, cofinsCst: string, aliq?: string): FiscalContextInput {
  return {
    emitente: {
      cnpj: '34051105000191', razaoSocial: 'EMPRESA TESTE', ie: '123456789', crt: '3',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
        codigoMunicipio: '3550308', nomeMunicipio: 'SAO PAULO', uf: 'SP', cep: '01001000',
      },
    },
    destinatario: {
      cnpj: '11222333000181', razaoSocial: 'CLIENTE', indIEDest: '9',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO',
        codigoMunicipio: '3550308', nomeMunicipio: 'SAO PAULO', uf: 'SP', cep: '01001000',
      },
    },
    itens: [{
      codigo: '001', descricao: 'PRODUTO', ncm: '84713012', cfop: '5102',
      unidade: 'UN', quantidade: '1', valorUnitario: '100.00',
      icms: { origem: '0', cst: '00', pICMS: '18' },
      pis: { cst: pisCst, aliquota: aliq },
      cofins: { cst: cofinsCst, aliquota: aliq },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '100.00' }] },
    serie: '1', numero: '1', naturezaOperacao: 'VENDA',
    dataEmissao: '2026-07-28T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '1', presenca: '1', ambiente: '2',
    municipioFG: '3550308', ufEmitente: 'SP', modFrete: '9',
  } as FiscalContextInput;
}

const gerar = (pis: string, cofins: string, aliq?: string) =>
  new XmlGenerator().generateInfNFe(buildNFe(contexto(pis, cofins, aliq)), '3'.repeat(44));

describe('roteamento de CST de PIS/COFINS', () => {
  test.each(['01', '02'])('CST %s vai para o grupo tributado, com alíquota', (cst) => {
    const xml = gerar(cst, cst, '1.6500');
    expect(xml).toContain('<PISAliq><CST>' + cst + '</CST>');
    expect(xml).toContain('<pPIS>1.6500</pPIS>');
    expect(xml).toContain('<COFINSAliq><CST>' + cst + '</CST>');
  });

  // Antes qualquer um destes virava CST 99 em PISOutr.
  test.each(['04', '05', '06', '07', '08'])('CST %s vai para o grupo nao tributado', (cst) => {
    const xml = gerar(cst, cst);
    expect(xml).toContain('<PISNT><CST>' + cst + '</CST></PISNT>');
    expect(xml).toContain('<COFINSNT><CST>' + cst + '</CST></COFINSNT>');
    expect(xml).not.toContain('<PISOutr>');
  });

  test.each(['49', '50', '99'])('CST %s vai para outras operacoes, preservado', (cst) => {
    const xml = gerar(cst, cst);
    expect(xml).toContain('<PISOutr><CST>' + cst + '</CST>');
    expect(xml).toContain('<COFINSOutr><CST>' + cst + '</CST>');
  });

  test('CST nao tributado nao soma aos totais da nota', () => {
    const nfe = buildNFe(contexto('07', '07'));
    expect(nfe.total.ICMSTot.vPIS).toBe('0.00');
    expect(nfe.total.ICMSTot.vCOFINS).toBe('0.00');
  });

  test('CST tributado soma ao total', () => {
    const nfe = buildNFe(contexto('01', '01', '1.6500'));
    expect(nfe.total.ICMSTot.vPIS).toBe('1.65');
    expect(nfe.total.ICMSTot.vCOFINS).toBe('1.65');
  });

  test('padrao 99 continua funcionando como antes', () => {
    const xml = gerar('99', '99');
    expect(xml).toContain('<PISOutr><CST>99</CST>');
    expect(xml).toContain('<COFINSOutr><CST>99</CST>');
  });
});
