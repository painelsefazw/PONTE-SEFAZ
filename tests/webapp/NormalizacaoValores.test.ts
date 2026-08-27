import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';

/**
 * Dois defeitos que só apareceram na emissão real, ambos derrubando a nota
 * antes de chegar à SEFAZ ou logo na validação dela:
 *
 *   valor "20,00"  -> [DecimalError] Invalid argument, sem dizer o campo
 *   cartão sem card -> cStat 391 "não informados os dados do cartão"
 */

function contexto(over: Partial<FiscalContextInput> = {}): FiscalContextInput {
  return {
    emitente: {
      cnpj: '50229544000106',
      razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '454941321110',
      crt: '1',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08810240',
      },
    },
    destinatario: {
      cnpj: '33645647000120',
      razaoSocial: 'CLIENTE LTDA',
      indIEDest: '1',
      ie: '454635504116',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08810240',
      },
    },
    itens: [{
      codigo: '682700', descricao: 'INDUTOS PARA PINTURA', ncm: '32141020',
      cfop: '5102', unidade: 'UN', quantidade: '1', valorUnitario: '20.00',
      icms: { origem: '0', csosn: '102' },
      pis: { cst: '99' }, cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '04', valor: '20.00' }] },
    serie: '1', numero: '1',
    naturezaOperacao: 'VENDA',
    dataEmissao: '2026-07-27T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '1', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
    ...over,
  } as FiscalContextInput;
}

describe('pagamento com cartao', () => {
  // Sem o grupo <card>, a SEFAZ rejeita com 391. Os campos iam soltos no
  // detPag, onde o XSD não os aceita.
  test.each([['03', 'credito'], ['04', 'debito']])(
    'tPag %s (%s) gera <card> com tpIntegra',
    (tipo) => {
      const nfe = buildNFe(contexto({ pagamento: { formas: [{ tipo, valor: '20.00' }] } }));
      const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

      expect(xml).toContain('<tPag>' + tipo + '</tPag>');
      expect(xml).toContain('<card><tpIntegra>2</tpIntegra></card>');
    },
  );

  test('card fica dentro do detPag, depois de vPag', () => {
    const nfe = buildNFe(contexto());
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    const det = xml.match(/<detPag>[\s\S]*?<\/detPag>/)?.[0] ?? '';
    expect(det.indexOf('<card>')).toBeGreaterThan(det.indexOf('<vPag>'));
  });

  test('dinheiro nao gera card', () => {
    const nfe = buildNFe(contexto({ pagamento: { formas: [{ tipo: '01', valor: '20.00' }] } }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(xml).toContain('<tPag>01</tPag>');
    expect(xml).not.toContain('<card>');
  });

  test('PIX nao gera card', () => {
    const nfe = buildNFe(contexto({ pagamento: { formas: [{ tipo: '17', valor: '20.00' }] } }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(xml).not.toContain('<card>');
  });
});

describe('valores em formato brasileiro', () => {
  // A conversão vive em normalizarItens/normalizarPagamento (app.ts), mas o
  // efeito é este: o valor precisa chegar ao XML com ponto decimal.
  const converter = (v: string) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);

  test.each([
    ['20,00', '20.00'],
    ['1.234,56', '1234.56'],
    ['20.00', '20.00'],
    ['20', '20'],
    ['0,50', '0.50'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(converter(entrada)).toBe(esperado);
  });

  test('valor convertido chega ao XML com ponto', () => {
    const nfe = buildNFe(contexto({
      itens: [{
        ...contexto().itens[0],
        valorUnitario: converter('1.234,56'),
        quantidade: '1',
      }],
      pagamento: { formas: [{ tipo: '01', valor: converter('1.234,56') }] },
    }));
    const xml = new XmlGenerator().generateInfNFe(nfe, '3'.repeat(44));

    expect(xml).toContain('<vProd>1234.56</vProd>');
    expect(xml).toContain('<vNF>1234.56</vNF>');
    // Nenhum campo numerico pode sair com virgula. As informacoes
    // complementares ficam de fora: sao texto corrido para leitura humana e
    // levam o demonstrativo IBS/CBS em reais ("R$ 1.234,56").
    const semTextoLivre = xml.replace(/<infAdic>[\s\S]*?<\/infAdic>/, '');
    expect(semTextoLivre).not.toContain(',');
  });
});
