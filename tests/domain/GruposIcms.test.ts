import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';
import { XsdValidator } from '../../src/infrastructure/validation/XsdValidator';

/**
 * Os grupos de ICMS que faltavam.
 *
 * Ate agora o motor recusava estes CST/CSOSN nomeando o codigo — comportamento
 * correto, e melhor que inventar tributacao —, mas parada seca para quem precisa
 * deles. Quem pedisse ICMSSN101 simplesmente nao emitia.
 *
 * Cada grupo e conferido contra o XSD OFICIAL, e nao contra o que eu acho que a
 * ordem deveria ser: em varios deles a base da ST vem antes da aliquota, e
 * trocar rende cStat 225 — que nao diz qual campo errou.
 */

function nota(crt: string, icms: Record<string, string>): FiscalContextInput {
  return {
    emitente: {
      cnpj: '50229544000106', razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '454941321110', crt: crt as FiscalContextInput['emitente']['crt'],
      endereco: {
        logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08810240',
      },
    },
    destinatario: {
      cnpj: '33645647000120', razaoSocial: 'CLIENTE LTDA',
      indIEDest: '1', ie: '454635504116',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08810240',
      },
    },
    itens: [{
      codigo: '001', descricao: 'PRODUTO', ncm: '84715010', cfop: '5102',
      unidade: 'UN', quantidade: '2', valorUnitario: '100.00',
      icms: icms as never,
      pis: { cst: '99' }, cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '200.00' }] },
    naturezaOperacao: 'VENDA', serie: '1', numero: '1',
    dataEmissao: '2026-08-16T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '0', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
  };
}

const grupo = (crt: string, icms: Record<string, string>) =>
  (buildNFe(nota(crt, icms)) as any).det[0].imposto.ICMS;

const xml = (crt: string, icms: Record<string, string>) =>
  new XmlGenerator().generateInfNFe(buildNFe(nota(crt, icms)) as any, '3'.repeat(44));

describe('CSOSN 101 — o que transfere credito', () => {
  test('calcula o credito a partir do percentual', () => {
    // 2 x 100,00 a 2,5% = 5,00. E o valor que o COMPRADOR aproveita — sem este
    // grupo, empresa do Simples nao tinha como dar credito a cliente do regime
    // normal, e perdia a venda para o concorrente que tinha.
    const g = grupo('1', { origem: '0', csosn: '101', pCredSN: '2.50' });
    expect(g.ICMSSN101.pCredSN).toBe('2.50');
    expect(g.ICMSSN101.vCredICMSSN).toBe('5.00');
  });

  test('valor explicito do ERP vence o calculo', () => {
    const g = grupo('1', { origem: '0', csosn: '101', pCredSN: '2.50', vCredICMSSN: '4.99' });
    expect(g.ICMSSN101.vCredICMSSN).toBe('4.99');
  });
});

describe('CSOSN 900 e CST 90 — "outras" so levam o que foi informado', () => {
  test('sem proprio e sem ST, o grupo sai enxuto', () => {
    // Preencher com zeros afirmaria tributacao que ninguem pediu. O 900 e um
    // curinga: o que nao foi dito nao deve aparecer.
    const g = grupo('1', { origem: '0', csosn: '900' });
    expect(g.ICMSSN900.CSOSN).toBe('900');
    expect(g.ICMSSN900.vBC).toBeUndefined();
    expect(g.ICMSSN900.vBCST).toBeUndefined();
  });

  test('com aliquota, calcula o proprio', () => {
    const g = grupo('1', { origem: '0', csosn: '900', pICMS: '18' });
    expect(g.ICMSSN900.vBC).toBe('200.00');
    expect(g.ICMSSN900.vICMS).toBe('36.00');
  });

  test('CST 90 segue a mesma regra', () => {
    const semNada = grupo('3', { origem: '0', cst: '90' });
    expect(semNada.ICMS90.vBC).toBeUndefined();
    const comAliq = grupo('3', { origem: '0', cst: '90', pICMS: '12' });
    expect(comAliq.ICMS90.vICMS).toBe('24.00');
  });
});

describe('CST 51 — diferimento', () => {
  test('separa o que se paga agora do que fica para depois', () => {
    // 200,00 a 18% = 36,00 de operacao. Diferindo 33,33%, ficam 12,00 para
    // depois e 24,00 para agora. `vICMS` e o que se paga AGORA — trocar os dois
    // faz a empresa recolher o valor errado.
    const g = grupo('3', { origem: '0', cst: '51', pICMS: '18', pDif: '33.3333' });
    expect(g.ICMS51.vICMSOp).toBe('36.00');
    expect(g.ICMS51.vICMSDif).toBe('12.00');
    expect(g.ICMS51.vICMS).toBe('24.00');
  });
});

describe('CST 30 e CSOSN 202 — so a ST', () => {
  test('CST 30 destaca ST e nao destaca proprio', () => {
    const g = grupo('3', { origem: '0', cst: '30', pMVAST: '40', pICMSST: '18' });
    expect(g.ICMS30.vBCST).toBe('280.00');
    expect(g.ICMS30.vICMSST).toBe('50.40');
    expect(g.ICMS30.vBC).toBeUndefined();
  });

  test('CSOSN 202 e o 201 sem o credito', () => {
    const g = grupo('1', { origem: '0', csosn: '202', pMVAST: '40', pICMSST: '18' });
    expect(g.ICMSSN202.vICMSST).toBe('50.40');
    expect(g.ICMSSN202.pCredSN).toBeUndefined();
  });
});

describe('monofasico de combustivel', () => {
  test('nao calcula: leva o que veio da tabela do combustivel', () => {
    // Ad rem e quantidade x valor por unidade. O motor nao tem essa tabela, e
    // deduzir seria inventar tributo num regime que nem usa base de calculo.
    const g = grupo('3', { origem: '0', cst: '02', qBCMono: '2.0000', adRemICMS: '1.2200', vICMSMono: '2.44' });
    expect(g.ICMS02).toEqual({
      orig: '0', CST: '02', qBCMono: '2.0000', adRemICMS: '1.2200', vICMSMono: '2.44',
    });
  });

  test('CST 61 leva os campos de retencao', () => {
    const g = grupo('3', { origem: '0', cst: '61', adRemICMSRet: '1.22', vICMSMonoRet: '2.44' });
    expect(g.ICMS61.vICMSMonoRet).toBe('2.44');
  });
});

describe('o XML sai valido para a SEFAZ', () => {
  const casos: Array<[string, string, Record<string, string>]> = [
    ['ICMS30', '3', { origem: '0', cst: '30', pMVAST: '40', pICMSST: '18' }],
    ['ICMS51', '3', { origem: '0', cst: '51', pICMS: '18', pDif: '50' }],
    ['ICMS90', '3', { origem: '0', cst: '90', pICMS: '18' }],
    ['ICMSSN101', '1', { origem: '0', csosn: '101', pCredSN: '2.50' }],
    ['ICMSSN202', '1', { origem: '0', csosn: '202', pMVAST: '40', pICMSST: '18' }],
    ['ICMSSN900', '1', { origem: '0', csosn: '900', pICMS: '18' }],
    ['ICMS02', '3', { origem: '0', cst: '02', qBCMono: '2.0000', adRemICMS: '1.2200', vICMSMono: '2.44' }],
    ['ICMS15', '3', { origem: '0', cst: '15', adRemICMS: '1.22', vICMSMono: '2.44', adRemICMSReten: '0.50', vICMSMonoReten: '1.00' }],
    ['ICMS53', '3', { origem: '0', cst: '53', adRemICMS: '1.22', vICMSMono: '2.44' }],
    ['ICMS61', '3', { origem: '0', cst: '61', adRemICMSRet: '1.22', vICMSMonoRet: '2.44' }],
  ];

  test.each(casos)('%s passa no schema oficial', async (nome, crt, icms) => {
    const x = xml(crt, icms);
    expect(x).toContain(`<${nome}>`);

    const r = await new XsdValidator().validarSchema(x);
    // `disponivel` falso significa que o xmllint nao rodou; ai o teste nao
    // provaria nada e e melhor dizer isso do que passar de graca.
    expect(r.disponivel).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
