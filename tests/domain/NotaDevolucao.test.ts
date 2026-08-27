import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';

/**
 * NF-e de devolução — grupo NFref.
 *
 * A referência à nota original é o que transforma uma nota de entrada em
 * devolução aos olhos do fisco: é ela que liga o estorno do imposto à venda.
 * Sem o grupo, a nota declara finalidade 4 mas não diz de quê.
 */

const CHAVE_ORIGINAL = '35260734051105000191550020000000011234567890';

function entrada(over: Partial<FiscalContextInput> = {}): FiscalContextInput {
  return {
    emitente: {
      cnpj: '34051105000191',
      razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '123456789',
      crt: '3',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
        codigoMunicipio: '3550308', nomeMunicipio: 'SAO PAULO',
        uf: 'SP', cep: '01001000',
      },
    },
    destinatario: {
      cnpj: '11222333000181',
      razaoSocial: 'FORNECEDOR LTDA',
      indIEDest: '9',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO',
        codigoMunicipio: '3550308', nomeMunicipio: 'SAO PAULO',
        uf: 'SP', cep: '01001000',
      },
    },
    itens: [{
      codigo: '001', descricao: 'PRODUTO DEVOLVIDO', ncm: '84713012',
      cfop: '1202', unidade: 'UN', quantidade: '1', valorUnitario: '100.00',
      icms: { origem: '0', cst: '00', pICMS: '18' },
      pis: { cst: '99' }, cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '90', valor: '0.00' }] },
    serie: '1', numero: '1',
    naturezaOperacao: 'DEVOLUCAO DE VENDA',
    dataEmissao: '2026-07-25T10:00:00-03:00',
    finalidade: '4',
    tipoOperacao: '0',
    destino: '1',
    indFinal: '0',
    presenca: '1',
    ambiente: '2',
    municipioFG: '3550308',
    ufEmitente: 'SP',
    modFrete: '9',
    ...over,
  } as FiscalContextInput;
}

describe('NF-e de devolucao (NFref)', () => {
  // Regras aprendidas contra a SEFAZ, nesta ordem:
  //   NFref só no cabeçalho  -> 321 (falta referência por item)
  //   nos dois níveis        -> 1010 (não pode referenciar em ambos)
  //   só por item            -> 100  autorizada
  test('devolucao referencia por item, nao no cabecalho', () => {
    const nfe = buildNFe(entrada({ notasReferenciadas: CHAVE_ORIGINAL }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(xml).toContain('<DFeReferenciado><chaveAcesso>' + CHAVE_ORIGINAL + '</chaveAcesso></DFeReferenciado>');
    expect(xml).not.toContain('<NFref>');
    expect(xml).toContain('<finNFe>4</finNFe>');
    expect(xml).toContain('<tpNF>0</tpNF>');
  });

  test('DFeReferenciado fica no fim do det, depois de infAdProd', () => {
    const nfe = buildNFe(entrada({ notasReferenciadas: CHAVE_ORIGINAL }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    const posImposto = xml.indexOf('</imposto>');
    const posRef = xml.indexOf('<DFeReferenciado>');
    const posFimDet = xml.indexOf('</det>');

    expect(posRef).toBeGreaterThan(posImposto);
    expect(posFimDet).toBeGreaterThan(posRef);
  });

  test('itemReferenciado aponta o item da nota original', () => {
    const e = entrada({ notasReferenciadas: CHAVE_ORIGINAL });
    e.itens[0].itemReferenciado = '3';
    const xml = new XmlGenerator().generateInfNFe(buildNFe(e), '3'.repeat(44));

    expect(xml).toContain('<chaveAcesso>' + CHAVE_ORIGINAL + '</chaveAcesso><nItem>3</nItem>');
  });

  test('itens de notas de origem diferentes referenciam cada um a sua', () => {
    const outra = '35260734051105000191550020000000021234567891';
    const e = entrada({ notasReferenciadas: CHAVE_ORIGINAL });
    e.itens.push({ ...e.itens[0], codigo: '002', notaReferenciada: outra });
    const xml = new XmlGenerator().generateInfNFe(buildNFe(e), '3'.repeat(44));

    expect(xml).toContain('<chaveAcesso>' + CHAVE_ORIGINAL + '</chaveAcesso>');
    expect(xml).toContain('<chaveAcesso>' + outra + '</chaveAcesso>');
  });

  test('finalidade complementar referencia no cabecalho, nao por item', () => {
    const nfe = buildNFe(entrada({ finalidade: '2', notasReferenciadas: CHAVE_ORIGINAL }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(xml).toContain('<NFref><refNFe>' + CHAVE_ORIGINAL + '</refNFe></NFref>');
    expect(xml).not.toContain('<DFeReferenciado>');
  });

  // Posição errada rejeita com cStat 225, que não indica o campo. O layout 4.00
  // clássico punha NFref após cMunFG; a atualização da Reforma moveu para o fim
  // do ide, depois de verProc — confirmado no XSD e contra a SEFAZ.
  test('NFref fica no fim do ide, depois de verProc', () => {
    const nfe = buildNFe(entrada({ finalidade: '2', notasReferenciadas: CHAVE_ORIGINAL }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    const posImp = xml.indexOf('<tpImp>');
    const posVerProc = xml.indexOf('<verProc>');
    const posRef = xml.indexOf('<NFref>');
    const posFimIde = xml.indexOf('</ide>');

    expect(posVerProc).toBeGreaterThan(posImp);
    expect(posRef).toBeGreaterThan(posVerProc);
    expect(posFimIde).toBeGreaterThan(posRef);
  });

  test('aceita varias notas referenciadas no cabecalho', () => {
    const outra = '35260734051105000191550020000000021234567891';
    const nfe = buildNFe(entrada({ finalidade: '2', notasReferenciadas: [CHAVE_ORIGINAL, outra] }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(xml).toContain('<refNFe>' + CHAVE_ORIGINAL + '</refNFe>');
    expect(xml).toContain('<refNFe>' + outra + '</refNFe>');
    expect((xml.match(/<NFref>/g) || []).length).toBe(2);
  });

  test('limpa formatacao da chave colada de tela', () => {
    const suja = ' 3526 0734 0511 0500 0191 5500 2000 0000 0112 3456 7890 ';
    const nfe = buildNFe(entrada({ finalidade: '2', notasReferenciadas: suja }));
    expect(nfe.ide.NFref).toEqual([CHAVE_ORIGINAL]);
  });

  test('recusa chave com tamanho errado em vez de deixar a SEFAZ rejeitar', () => {
    expect(() => buildNFe(entrada({ finalidade: '2', notasReferenciadas: '123456' })))
      .toThrow(/44/);
  });

  test('venda normal nao emite referencia em nenhum nivel', () => {
    const nfe = buildNFe(entrada({ finalidade: '1', tipoOperacao: '1', notasReferenciadas: undefined }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(nfe.ide.NFref).toBeUndefined();
    expect(xml).not.toContain('<NFref>');
    expect(xml).not.toContain('<DFeReferenciado>');
  });
});
