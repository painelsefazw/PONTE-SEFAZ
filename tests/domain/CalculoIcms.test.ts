import { buildNFe, FiscalContextInput, FiscalContextItem } from '../../src/domain/FiscalContext';

/**
 * O ICMS derivado da alíquota.
 *
 * O motor aceitava `pICMS` e emitia `vBC` e `vICMS` zerados: a nota saía com a
 * alíquota declarada e o imposto ausente. A SEFAZ aceita — é schema-válido — e a
 * nota está fiscalmente errada. O painel do Emissor não caía nisso porque manda
 * os valores calculados no navegador; quem caía era o formato plano da API, que
 * é justamente o que as plataformas geradas usam.
 *
 * A propriedade que sustenta a segurança desta mudança está no primeiro bloco:
 * **valor informado nunca é recalculado.** É o que garante que nenhuma nota de
 * quem já emite hoje mudou.
 */

const item = (over: Partial<FiscalContextItem> = {}): FiscalContextItem => ({
  codigo: '001', descricao: 'PRODUTO', ncm: '84713012', cfop: '5102',
  unidade: 'UN', quantidade: '2', valorUnitario: '100.00',
  icms: { origem: '0', cst: '00', pICMS: '18' },
  pis: { cst: '99' }, cofins: { cst: '99' },
  ...over,
} as FiscalContextItem);

function nota(itens: FiscalContextItem[]): FiscalContextInput {
  return {
    emitente: {
      cnpj: '50229544000106', razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '454941321110', crt: '3',
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO', codigoMunicipio: '3530607',
        nomeMunicipio: 'MOGI DAS CRUZES', uf: 'SP', cep: '08810240',
      },
    },
    destinatario: {
      cnpj: '33645647000120', razaoSocial: 'CLIENTE LTDA', indIEDest: '9',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO', codigoMunicipio: '3530607',
        nomeMunicipio: 'MOGI DAS CRUZES', uf: 'SP', cep: '08810240',
      },
    },
    itens,
    pagamento: { formas: [{ tipo: '01', valor: '200.00' }] },
    naturezaOperacao: 'VENDA', serie: '880', numero: '1',
    dataEmissao: '2026-08-03T10:00:00-03:00', finalidade: '1', tipoOperacao: '1',
    destino: '1', indFinal: '1', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
  } as FiscalContextInput;
}

const icmsDe = (i: FiscalContextItem): any => {
  const grupo = (buildNFe(nota([i])) as any).det[0].imposto.ICMS;
  return grupo[Object.keys(grupo)[0]!];
};

describe('valor informado nunca e recalculado', () => {
  it('vBC e vICMS explicitos passam intactos — e por isso nenhuma nota existente mudou', () => {
    const r = icmsDe(item({
      icms: { origem: '0', cst: '00', pICMS: '18', vBC: '123.45', vICMS: '22.22' },
    } as any));
    expect(r.vBC).toBe('123.45');
    expect(r.vICMS).toBe('22.22');
  });

  it('so o vBC informado e respeitado; o vICMS ausente sai dele', () => {
    const r = icmsDe(item({ icms: { origem: '0', cst: '00', pICMS: '10', vBC: '500.00' } } as any));
    expect(r.vBC).toBe('500.00');
    expect(r.vICMS).toBe('50.00');
  });
});

describe('ICMS proprio a partir da aliquota', () => {
  it('CST 00: 2 x 100,00 a 18% da 36,00 (antes saia 0,00)', () => {
    const r = icmsDe(item());
    expect(r.vBC).toBe('200.00');
    expect(r.vICMS).toBe('36.00');
  });

  it('sem aliquota, nem a base e derivada — senao o DIFAL nasceria sozinho', () => {
    // A partilha interestadual sai do vBC. Preencher a base de uma nota que nao
    // declara quanto tributa faria aparecer imposto que ninguem pediu.
    const r = icmsDe(item({ icms: { origem: '0', cst: '00' } } as any));
    expect(r.vBC).toBe('0.00');
    expect(r.vICMS).toBe('0.00');
  });

  it('aliquota zero explicita tambem nao deriva base', () => {
    const r = icmsDe(item({ icms: { origem: '0', cst: '00', pICMS: '0' } } as any));
    expect(r.vBC).toBe('0.00');
  });

  it('a base e o valor da operacao: menos desconto, mais frete, seguro e despesas', () => {
    const r = icmsDe(item({
      desconto: '20.00', frete: '30.00', seguro: '5.00', despesas: '5.00',
    }));
    // 200 - 20 + 30 + 5 + 5 = 220
    expect(r.vBC).toBe('220.00');
    expect(r.vICMS).toBe('39.60');
  });

  it('CST 20: a reducao de base entra antes da aliquota', () => {
    const r = icmsDe(item({
      icms: { origem: '0', cst: '20', pICMS: '18', pRedBC: '30' },
    } as any));
    // 200 x 70% = 140; 140 x 18% = 25,20
    expect(r.vBC).toBe('140.00');
    expect(r.vICMS).toBe('25.20');
  });

  it('arredonda para duas casas', () => {
    const r = icmsDe(item({
      quantidade: '3', valorUnitario: '33.33',
      icms: { origem: '0', cst: '00', pICMS: '7' },
    } as any));
    expect(r.vBC).toBe('99.99');
    expect(r.vICMS).toBe('7.00');
  });
});

describe('substituicao tributaria', () => {
  it('CST 10: base majorada pela MVA, menos o ICMS proprio', () => {
    const r = icmsDe(item({
      icms: { origem: '0', cst: '10', pICMS: '18', pMVAST: '40', pICMSST: '18' },
    } as any));
    // base 200 x 1,40 = 280; 280 x 18% = 50,40; menos os 36,00 proprios = 14,40
    expect(r.vBC).toBe('200.00');
    expect(r.vICMS).toBe('36.00');
    expect(r.vBCST).toBe('280.00');
    expect(r.vICMSST).toBe('14.40');
  });

  it('o IPI entra na base da ST', () => {
    const r = icmsDe(item({
      icms: { origem: '0', cst: '10', pICMS: '18', pMVAST: '40', pICMSST: '18' },
      ipi: { cst: '50', pIPI: '10' },
    } as any));
    // IPI 10% de 200 = 20; (200 + 20) x 1,40 = 308
    expect(r.vBCST).toBe('308.00');
  });

  it('reducao de base da ST e aplicada', () => {
    const r = icmsDe(item({
      icms: { origem: '0', cst: '10', pICMS: '18', pMVAST: '40', pRedBCST: '50', pICMSST: '18' },
    } as any));
    // 280 x 50% = 140
    expect(r.vBCST).toBe('140.00');
  });

  it('vICMSST nunca fica negativo — nao havendo o que recolher, e zero', () => {
    const r = icmsDe(item({
      icms: { origem: '0', cst: '10', pICMS: '25', pMVAST: '0', pICMSST: '12' },
    } as any));
    expect(Number(r.vICMSST)).toBeGreaterThanOrEqual(0);
    expect(r.vICMSST).toBe('0.00');
  });

  it('vBCST e vICMSST informados passam intactos', () => {
    const r = icmsDe(item({
      icms: {
        origem: '0', cst: '10', pICMS: '18', pMVAST: '40', pICMSST: '18',
        vBCST: '999.00', vICMSST: '111.00',
      },
    } as any));
    expect(r.vBCST).toBe('999.00');
    expect(r.vICMSST).toBe('111.00');
  });
});

describe('o que nao tem base nem valor continua sem', () => {
  it.each(['40', '41', '50'])('CST %s nao ganha vBC nem vICMS', (cst) => {
    const r = icmsDe(item({ icms: { origem: '0', cst } } as any));
    expect(r.vBC).toBeUndefined();
    expect(r.vICMS).toBeUndefined();
  });

  it('CST 60 (ST ja retido) segue so com os campos de retencao', () => {
    const r = icmsDe(item({ icms: { origem: '0', cst: '60' } } as any));
    expect(r.vBC).toBeUndefined();
    expect(r.CST).toBe('60');
  });
});

/**
 * DIFAL: a diferenca entre a aliquota interna do estado de destino e a
 * interestadual, devida na venda para consumidor final nao contribuinte de outra
 * UF.
 *
 * A aliquota interna do destino e do PRODUTO naquele estado — cesta basica e
 * bebida nao pagam o mesmo em lugar nenhum. Por isso ela e por item: um valor
 * unico para a nota inteira so acerta por acidente, e o 18% fixo que existia
 * antes erra na maioria dos estados.
 */
describe('DIFAL com aliquota do destino por item', () => {
  const notaInterestadual = (itens: FiscalContextItem[]): FiscalContextInput => ({
    ...nota(itens),
    destino: '2',
    indFinal: '1',
    destinatario: {
      cnpj: '33645647000120', razaoSocial: 'CLIENTE LTDA', indIEDest: '9',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO', codigoMunicipio: '3106200',
        nomeMunicipio: 'BELO HORIZONTE', uf: 'MG', cep: '30130000',
      },
    },
  } as FiscalContextInput);

  const difalDe = (i: FiscalContextItem): any =>
    (buildNFe(notaInterestadual([i])) as any).det[0].imposto.ICMSUFDest;

  it('usa a aliquota do item, nao os 18% fixos', () => {
    const r = difalDe(item({ pICMSUFDest: '20' } as any));
    expect(r.pICMSUFDest).toBe('20.00');
    // SP -> MG nacional e 12%; a diferenca de 8% sobre 200,00 da 16,00
    expect(r.pICMSInter).toBe('12.00');
    expect(r.vICMSUFDest).toBe('16.00');
  });

  it('cada item pode ter a sua — e o que torna o calculo correto', () => {
    expect(difalDe(item({ pICMSUFDest: '25' } as any)).vICMSUFDest).toBe('26.00');
    expect(difalDe(item({ pICMSUFDest: '17' } as any)).vICMSUFDest).toBe('10.00');
  });

  it('sem aliquota do item, cai no padrao — e e esse caso que a rota avisa', () => {
    expect(difalDe(item()).pICMSUFDest).toBe('18.00');
  });

  it('o FCP do destino passa a ser calculado', () => {
    const r = difalDe(item({ pICMSUFDest: '18', pFCPUFDest: '2' } as any));
    expect(r.pFCPUFDest).toBe('2.00');
    expect(r.vBCFCPUFDest).toBe('200.00');
    expect(r.vFCPUFDest).toBe('4.00');
  });

  it('sem FCP informado o grupo nao aparece — nao se inventa adicional', () => {
    const r = difalDe(item({ pICMSUFDest: '18' } as any));
    expect(r.pFCPUFDest).toBeUndefined();
    expect(r.vFCPUFDest).toBeUndefined();
  });

  it('mercadoria importada usa a interestadual de 4%', () => {
    const r = difalDe(item({
      pICMSUFDest: '18', icms: { origem: '1', cst: '00', pICMS: '18' },
    } as any));
    expect(r.pICMSInter).toBe('4.00');
    expect(r.vICMSUFDest).toBe('28.00');
  });
});
