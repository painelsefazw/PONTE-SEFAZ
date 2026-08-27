import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';

/**
 * Os totais da nota tem que fechar entre si.
 *
 * Tres achados com a mesma origem: o motor calculava o vNF num lugar e copiava
 * valores do ERP em outro, sem nunca comparar os dois. O schema so olha formato,
 * a previa dava verde, e a SEFAZ recusava depois de transmitir.
 */

function nota(
  itens: Array<{ q: string; v: string; desc?: string }>,
  extra: Partial<FiscalContextInput> = {},
  pagamento?: FiscalContextInput['pagamento'],
): () => any {
  const total = itens.reduce(
    (a, i) => a + Number(i.q) * Number(i.v) - Number(i.desc ?? '0'), 0);
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
    itens: itens.map((it, n) => ({
      codigo: `00${n + 1}`, descricao: `PRODUTO ${n + 1}`, ncm: '84715010', cfop: '5102',
      unidade: 'UN', quantidade: it.q, valorUnitario: it.v,
      ...(it.desc ? { desconto: it.desc } : {}),
      icms: { origem: '0', csosn: '102' } as never,
      pis: { cst: '99' }, cofins: { cst: '99' },
    })),
    pagamento: pagamento ?? { formas: [{ tipo: '01', valor: total.toFixed(2) }] },
    naturezaOperacao: 'VENDA', serie: '1', numero: '1',
    dataEmissao: '2026-08-16T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '0', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
    ...extra,
  };
  return () => buildNFe(input);
}

describe('desconto maior que a nota', () => {
  test('recusa em vez de deixar o vNF ficar negativo', () => {
    // Desconto em centavos mandado como reais: R$ 500,00 numa nota de R$ 100,00.
    // O rateio dava ao item um desconto maior que o proprio valor.
    expect(nota([{ q: '1', v: '100.00', desc: '500.00' }], {}, {
      formas: [{ tipo: '90', valor: '0.00' }],
    })).toThrow(/DESCONTO_MAIOR_QUE_A_NOTA/);
  });

  test('desconto IGUAL ao total tambem e recusado', () => {
    // Este e o pior dos dois: vNF 0,00 PASSA no schema, passa na previa e e
    // transmitido. Nota de valor zero, autorizada.
    expect(nota([{ q: '1', v: '100.00', desc: '100.00' }], {}, {
      formas: [{ tipo: '90', valor: '0.00' }],
    })).toThrow(/DESCONTO_MAIOR_QUE_A_NOTA/);
  });

  test('a recusa cita os dois valores', () => {
    // "desconto invalido" sozinho manda o operador procurar onde.
    expect(nota([{ q: '1', v: '100.00', desc: '500.00' }], {}, {
      formas: [{ tipo: '90', valor: '0.00' }],
    })).toThrow(/R\$ 500\.00.*R\$ 100\.00/s);
  });

  test('a recusa aponta a causa provavel, em vez de so negar', () => {
    expect(nota([{ q: '1', v: '100.00', desc: '500.00' }], {}, {
      formas: [{ tipo: '90', valor: '0.00' }],
    })).toThrow(/erro de unidade \(valor em centavos\)/);
  });

  test('desconto menor que o total passa', () => {
    expect(nota([{ q: '1', v: '100.00', desc: '10.00' }])).not.toThrow();
  });

  test('desconto de um centavo a menos que o total ainda passa', () => {
    // A fronteira exata importa: e o limite entre nota valida e nota de R$ 0,00.
    expect(nota([{ q: '1', v: '100.00', desc: '99.99' }])).not.toThrow();
  });
});

describe('pagamento contra o vNF', () => {
  test('uma forma so e sem troco: CORRIGE, nao recusa', () => {
    // O ERP mandou o valor do pedido, sem o frete que ele nao somou. Recusar
    // por causa disso seria birra: ha uma unica leitura possivel.
    const nfe = nota([{ q: '1', v: '100.00' }], {}, { formas: [{ tipo: '01', valor: '90.00' }] })();
    expect(nfe.pag.detPag[0].vPag).toBe('100.00');
    expect(nfe.total.ICMSTot.vNF).toBe('100.00');
  });

  test('varias formas: RECUSA dizendo os dois numeros', () => {
    // Aqui a diferenca pode ser um pagamento faltando, e escolher em qual forma
    // somar mudaria a nota.
    expect(nota([{ q: '1', v: '100.00' }], {}, {
      formas: [{ tipo: '01', valor: '40.00' }, { tipo: '03', valor: '40.00' }],
    })).toThrow(/PAGAMENTO_DIVERGENTE/);
  });

  test('a recusa mostra a diferenca calculada', () => {
    expect(nota([{ q: '1', v: '100.00' }], {}, {
      formas: [{ tipo: '01', valor: '40.00' }, { tipo: '03', valor: '40.00' }],
    })).toThrow(/diferenca de R\$ 20\.00/);
  });

  test('varias formas que fecham passam', () => {
    expect(nota([{ q: '1', v: '100.00' }], {}, {
      formas: [{ tipo: '01', valor: '60.00' }, { tipo: '03', valor: '40.00' }],
    })).not.toThrow();
  });

  test('tPag 90 com valor e contradicao', () => {
    expect(nota([{ q: '1', v: '100.00' }], {}, {
      formas: [{ tipo: '90', valor: '100.00' }],
    })).toThrow(/PAGAMENTO_INCOERENTE/);
  });

  test('nota SEM pagamento mantem vPag zerado e vNF cheio', () => {
    // Remessa, bonificacao, comodato, brinde: mercadoria circula, dinheiro nao.
    // A correcao automatica nao pode escrever o valor da nota aqui.
    const nfe = nota([{ q: '1', v: '100.00' }], {}, { formas: [{ tipo: '90', valor: '0.00' }] })();
    expect(nfe.pag.detPag[0].vPag).toBe('0.00');
    expect(nfe.total.ICMSTot.vNF).toBe('100.00');
  });

  test('troco entra na conta', () => {
    // Pagou 150 em dinheiro numa nota de 100 e levou 50 de troco: fecha.
    expect(nota([{ q: '1', v: '100.00' }], {}, {
      formas: [{ tipo: '01', valor: '150.00' }], troco: '50.00',
    })).not.toThrow();
  });

  test('troco que nao fecha e recusado, e a mensagem cita o troco', () => {
    expect(nota([{ q: '1', v: '100.00' }], {}, {
      formas: [{ tipo: '01', valor: '150.00' }], troco: '20.00',
    })).toThrow(/ja descontado o troco de R\$ 20\.00/);
  });
});
