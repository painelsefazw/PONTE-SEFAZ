import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';

/**
 * O codigo de ICMS do item tem que combinar com o regime da empresa.
 *
 * A divisao NAO e "Simples x normal" — foi assim que a primeira versao errou.
 * O MOC amarra pelo numero do CRT: 1 e 4 usam CSOSN; 2 e 3 usam CST. O CRT 2 e
 * Simples com excesso de sublimite, e cai no lado do CST porque ali o ICMS saiu
 * do DAS. O `isSimples` do app.ts dizia `1 || 2`, invertido nos dois extremos.
 *
 * Dois erros comuns, nenhum deles pego antes — e os dois com previa verde,
 * porque o XSD aceita os dois grupos: quem recusa e a regra de negocio da SEFAZ,
 * nao o schema.
 *
 *  (a) Empresa do Simples cujo ERP manda `cst: '00'` gerava <ICMS00>, grupo de
 *      regime normal numa empresa do Simples.
 *  (b) Empresa que saiu do Simples e tem `cst_csosn = '102'` no cadastro do
 *      produto — a coluna e a mesma para os dois tipos de codigo — gerava
 *      <ICMSSN102>, grupo do Simples numa empresa de regime normal.
 *
 * Pior que os dois: o default de `buildICMS` empurrava QUALQUER codigo
 * desconhecido para dentro do ICMSSN102. CSOSN 900 saia como
 * <ICMSSN102><CSOSN>900</CSOSN>, que o XSD reprova falando de "CSOSN" — campo
 * que o operador nunca digitou. E item sem CST nem CSOSN virava 102 valido: nota
 * AUTORIZADA com uma tributacao que ninguem escolheu.
 *
 * A suite tinha o proprio defeito dentro dela: uma fixture guardava CSOSN 102 no
 * campo `cst` e passava, porque o motor aceitava calado.
 *
 * Recusa em vez de converter: CST e CSOSN nao tem equivalencia de mao dupla, e
 * adivinhar a correspondencia mudaria o imposto.
 */

function nota(crt: string, icms: Record<string, string>, mod?: '55' | '65'): () => unknown {
  const input: FiscalContextInput = {
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
      unidade: 'UN', quantidade: '1', valorUnitario: '100.00',
      icms: icms as never,
      pis: { cst: '99' }, cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '100.00' }] },
    naturezaOperacao: 'VENDA', serie: '1', numero: '1',
    dataEmissao: '2026-08-16T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '0', presenca: '1', ambiente: '2',
    ...(mod ? { mod } : {}),
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
  };
  return () => buildNFe(input);
}

describe('a divisao e pelo CRT, nao por "Simples x normal"', () => {
  test('CRT 2 — excesso de sublimite — usa CST, nao CSOSN', () => {
    // O ICMS saiu do DAS: a empresa segue as normas de quem nao e optante.
    // Tratar o CRT 2 como Simples recusaria emissao legitima.
    expect(nota('2', { origem: '0', cst: '00', pICMS: '18' })).not.toThrow();
    expect(nota('2', { origem: '0', csosn: '102' })).toThrow(/rejeicao 591/);
  });

  test('a recusa do CRT 2 explica por que, em vez de so negar', () => {
    expect(nota('2', { origem: '0', csosn: '102' })).toThrow(/o ICMS saiu do DAS/);
  });

  test('CRT 4 — MEI — usa CSOSN, nao CST', () => {
    expect(nota('4', { origem: '0', csosn: '102' })).not.toThrow();
    expect(nota('4', { origem: '0', cst: '00', pICMS: '18' })).toThrow(/rejeicao 590/);
  });
});

describe('o MEI e mais restrito que o Simples comum', () => {
  test('CSOSN 400 vale na NF-e do MEI', () => {
    expect(nota('4', { origem: '0', csosn: '400' }, '55')).not.toThrow();
  });

  test('CSOSN 400 NAO vale na NFC-e do MEI', () => {
    // N12a-81: no modelo 65 o MEI so tem 102 e 300. Rejeicao 782, obrigatoria
    // em producao desde 01/04/2025 — nao e "a criterio da UF".
    expect(nota('4', { origem: '0', csosn: '400' }, '65')).toThrow(/rejeicao 782/);
  });

  test('CSOSN valido no Simples comum mas fora da lista do MEI e recusado', () => {
    expect(nota('4', { origem: '0', csosn: '103' })).toThrow(/nao vale para MEI/);
    expect(nota('1', { origem: '0', csosn: '103' })).not.toThrow();
  });
});

describe('combustivel monofasico e a excecao expressa da regra', () => {
  test('o guard de regime nao barra CST monofasico no Simples', () => {
    // Excecao da N12-20: CST 02, 15, 53 e 61 valem para CRT 1 e 4. Barrar por
    // regime quebraria posto de combustivel optante pelo Simples.
    for (const cst of ['02', '15', '61']) {
      expect(nota('1', { origem: '0', cst })).not.toThrow(/rejeicao 590/);
    }
  });

  test('monofasico pede os valores ad rem em vez de inventar', () => {
    // Tributacao AD REM sai da QUANTIDADE vezes um valor por unidade, vindo da
    // tabela do combustivel. O motor nao tem essa tabela — e mandar zero
    // afirmaria que nao ha imposto, com a nota saindo AUTORIZADA errada.
    expect(nota('1', { origem: '0', cst: '02' })).toThrow(/exige adRemICMS, vICMSMono/);
    expect(nota('1', { origem: '0', cst: '02', adRemICMS: '1.2200', vICMSMono: '12.20' }))
      .not.toThrow();
  });

  test('CST comum continua recusado no Simples', () => {
    expect(nota('1', { origem: '0', cst: '00', pICMS: '18' })).toThrow(/rejeicao 590/);
  });
});

describe('Simples Nacional usa CSOSN, nao CST', () => {
  test('CST de regime normal em empresa do Simples e recusado', () => {
    expect(nota('1', { origem: '0', cst: '00', pICMS: '18' }))
      .toThrow(/CST 00 de ICMS em empresa do Simples Nacional \(CRT 1\)/);
  });

  test('a recusa diz qual codigo usar no lugar', () => {
    // Mensagem que manda procurar sem dizer onde nao serve para nada.
    expect(nota('1', { origem: '0', cst: '00', pICMS: '18' })).toThrow(/CSOSN/);
  });

  test('CSOSN continua passando normalmente', () => {
    expect(nota('1', { origem: '0', csosn: '102' })).not.toThrow();
  });
});

describe('Regime normal usa CST, nao CSOSN', () => {
  test('CSOSN em empresa de regime normal e recusado', () => {
    expect(nota('3', { origem: '0', csosn: '102' }))
      .toThrow(/CSOSN 102 em empresa de Regime Normal \(CRT 3\)/);
  });

  test('CST continua passando normalmente', () => {
    expect(nota('3', { origem: '0', cst: '00', pICMS: '18' })).not.toThrow();
  });
});

describe('coluna trocada no cadastro e nomeada como tal', () => {
  test('CSOSN de 3 digitos gravado no campo do CST', () => {
    // O caso real: `webapp_produtos.cst_csosn` guarda os dois tipos na mesma
    // coluna, entao a troca acontece sozinha quando a empresa muda de regime.
    expect(nota('3', { origem: '0', cst: '102' }))
      .toThrow(/Parece um CSOSN do Simples salvo no campo do CST/);
  });

  test('CST de 2 digitos gravado no campo do CSOSN', () => {
    expect(nota('1', { origem: '0', csosn: '00' }))
      .toThrow(/Parece um CST de regime normal salvo no campo do CSOSN/);
  });
});

describe('o default silencioso virou recusa', () => {
  test('item sem CST e sem CSOSN nao vira 102 por conta propria', () => {
    // Este era o pior: nota AUTORIZADA com tributacao que ninguem escolheu.
    expect(nota('1', { origem: '0' })).toThrow(/nao informou CST nem CSOSN/);
  });

  test('CSOSN valido mas ainda nao implementado recusa nomeando o codigo', () => {
    // Antes, QUALQUER codigo desconhecido virava <ICMSSN102><CSOSN>xxx</CSOSN>,
    // e a rejeicao falava de "CSOSN" numa empresa que nunca digitou o campo.
    // O 203 (ST + isencao por faixa) e o que resta sem grupo montado.
    expect(nota('1', { origem: '0', csosn: '203' }))
      .toThrow(/CSOSN 203 ainda nao e suportado/);
  });

  test('todo CST valido do leiaute tem grupo montado', () => {
    // Este teste comecou ao contrario — afirmava que CST 90 NAO era suportado.
    // Com os grupos 30, 51, 90 e os monofasicos implementados, nao sobrou CST
    // valido sem montagem, e a afirmacao util virou esta.
    const comValor: Record<string, Record<string, string>> = {
      '02': { adRemICMS: '1.2200', vICMSMono: '12.20' },
      '15': { adRemICMS: '1.22', vICMSMono: '12.20', adRemICMSReten: '0.50', vICMSMonoReten: '5.00' },
      '61': { adRemICMSRet: '1.22', vICMSMonoRet: '12.20' },
    };
    for (const cst of ['00', '10', '20', '30', '40', '41', '50', '51', '53', '60', '70', '90']) {
      expect(nota('3', { origem: '0', cst, pICMS: '18', ...(comValor[cst] ?? {}) }))
        .not.toThrow(/ainda nao e suportado/);
    }
  });

  test('codigo que nao existe em tabela nenhuma tambem e nomeado', () => {
    expect(nota('1', { origem: '0', csosn: '999' })).toThrow(/999/);
    expect(nota('3', { origem: '0', cst: '99' })).toThrow(/99/);
  });
});

describe('a mensagem localiza o item', () => {
  test('diz o numero do item, nao so o codigo', () => {
    // Numa nota de trinta itens, "CSOSN invalido" sem o numero manda procurar.
    expect(nota('3', { origem: '0', csosn: '102' })).toThrow(/item 1:/);
  });
});
