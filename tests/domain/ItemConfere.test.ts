import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';

/**
 * Conferencias do item que faltavam.
 *
 * Todas com a mesma assinatura: o XSD aceita o valor isoladamente, entao a
 * previa fica verde. O que quebra e a RELACAO entre campos — ou, pior, nada
 * quebra e a nota sai autorizada errada.
 */

function nota(mudanca: Record<string, unknown>): () => any {
  const input: FiscalContextInput = {
    emitente: {
      cnpj: '11222333000181', razaoSocial: 'EMPRESA TESTE LTDA',
      ie: '454941321110', crt: '1',
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
      unidade: 'UN', quantidade: '1', valorUnitario: '100.00',
      icms: { origem: '0', csosn: '102' } as never,
      pis: { cst: '99' }, cofins: { cst: '99' },
      ...mudanca,
    } as never],
    pagamento: { formas: [{ tipo: '90', valor: '0.00' }] },
    naturezaOperacao: 'VENDA', serie: '1', numero: '1',
    dataEmissao: '2026-08-16T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '0', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
  };
  return () => buildNFe(input);
}

describe('nota de valor zero — o desfecho mais caro', () => {
  test('quantidade zero e recusada', () => {
    // Passa no XSD (o pattern aceita zero explicitamente), a SEFAZ autoriza, e
    // a empresa fica com nota de R$ 0,00, numeracao consumida e nada para
    // cancelar depois de 24h. Nenhuma rejeicao avisa.
    expect(nota({ quantidade: '0' })).toThrow(/QUANTIDADE_INVALIDA/);
  });

  test('a recusa explica o que aconteceria se passasse', () => {
    expect(nota({ quantidade: '0' })).toThrow(/AUTORIZADA valendo R\$ 0,00/);
  });

  test('quantidade negativa e recusada', () => {
    expect(nota({ quantidade: '-1' })).toThrow(/QUANTIDADE_INVALIDA/);
  });

  test('valor unitario zero e recusado, com a saida para brinde', () => {
    expect(nota({ valorUnitario: '0' })).toThrow(/VALOR_UNITARIO_ZERO/);
    expect(nota({ valorUnitario: '0' })).toThrow(/brinde ou bonificação/);
  });

  test('valor negativo aponta a devolucao como caminho certo', () => {
    // Estorno mal formatado. Antes so o XSD travava, com mensagem crua.
    expect(nota({ valorUnitario: '-10' })).toThrow(/nota de devolução \(finalidade 4\)/);
  });
});

describe('campo ausente nao vira valor inventado', () => {
  test('quantidade ausente recusa em vez de virar 1', () => {
    expect(nota({ quantidade: undefined })).toThrow(/QUANTIDADE_AUSENTE/);
  });

  test('valor unitario ausente recusa em vez de virar 0', () => {
    expect(nota({ valorUnitario: undefined })).toThrow(/VALORUNITARIO_AUSENTE/);
  });

  test('a recusa diz por que nao ha padrao possivel', () => {
    expect(nota({ quantidade: undefined })).toThrow(/nota com número que ninguém pediu/);
  });

  test('a mensagem localiza o item', () => {
    expect(nota({ quantidade: '0', descricao: 'CAIXA DE BANANA' }))
      .toThrow(/item 1 \(CAIXA DE BANANA\)/);
  });
});

describe('unidade comercial', () => {
  test('acima de 6 caracteres recusa nomeando o valor', () => {
    // uCom e replicado em uTrib, entao o valor errado aparece duas vezes no XML
    // e a mensagem do libxml nao diz qual item nem que o problema e o tamanho.
    expect(nota({ unidade: 'CAIXA C/12' })).toThrow(/UNIDADE_INVALIDA/);
    expect(nota({ unidade: 'CAIXA C/12' })).toThrow(/10 caracteres/);
  });

  test('a recusa sugere a abreviacao em vez de truncar', () => {
    // Truncar mudaria o que esta sendo vendido: 'CAIXA' e 'CAIXA C/12' sao
    // quantidades diferentes.
    expect(nota({ unidade: 'CAIXA C/12' })).toThrow(/CX, CX12/);
  });

  test('exatamente 6 caracteres passa', () => {
    expect(nota({ unidade: 'CX1200' })).not.toThrow();
  });
});

describe('quantidade x vProd — a conta que a SEFAZ refaz', () => {
  test('quantidade com mais de 4 casas nao gera divergencia', () => {
    // 1.00005 x 1000 = 1000.05, mas o XML leva qCom '1.0001' (4 casas) e a
    // SEFAZ refaz: 1.0001 x 1000 = 1000.10. Cinco centavos, rejeicao 526.
    // Arredondar antes de multiplicar usa os mesmos numeros que ela vai usar.
    const nfe = nota({ quantidade: '1.00005', valorUnitario: '1000.00' })();
    const det = nfe.det[0].prod;
    const refeita = Number(det.qCom) * Number(det.vUnCom);
    expect(Number(det.vProd)).toBeCloseTo(refeita, 2);
    expect(det.qCom).toBe('1.0001');
    expect(det.vProd).toBe('1000.10');
  });

  test('a conta bate em varias quantidades quebradas', () => {
    // Peso de balanca e rateio de kg produzem casas decimais o tempo todo.
    for (const q of ['0.33333', '2.000049', '7.12345', '1.99999']) {
      const det = nota({ quantidade: q, valorUnitario: '13.37' })().det[0].prod;
      const refeita = Number(det.qCom) * Number(det.vUnCom);
      expect(Number(det.vProd)).toBeCloseTo(refeita, 2);
    }
  });

  test('quantidade inteira continua saindo igual', () => {
    const det = nota({ quantidade: '3', valorUnitario: '10.00' })().det[0].prod;
    expect(det.vProd).toBe('30.00');
  });
});
