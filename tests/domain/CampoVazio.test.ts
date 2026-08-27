import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';

/**
 * Vazio nao e o mesmo que ausente.
 *
 * A conferencia de tamanho minimo ja existia e era boa — 'C' de bairro era
 * recusado com TEXTO_CURTO. Mas a guarda tinha `texto.length > 0`, entao
 * logradouro `""` (o ERP que manda o campo em branco) atravessava calado: a tag
 * sumia do XML e a SEFAZ devolvia 225 apontando o campo SEGUINTE ao que faltou.
 *
 * Ou seja: exatamente o erro cego que a funcao existe para evitar, escapando
 * pela unica porta que ela mesma tinha deixado aberta.
 */

function nota(mudanca: (i: FiscalContextInput) => void): () => unknown {
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
    }],
    pagamento: { formas: [{ tipo: '01', valor: '100.00' }] },
    naturezaOperacao: 'VENDA', serie: '1', numero: '1',
    dataEmissao: '2026-08-16T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    indFinal: '0', presenca: '1', ambiente: '2',
    municipioFG: '3530607', ufEmitente: 'SP', modFrete: '9',
  };
  mudanca(input);
  return () => buildNFe(input);
}

describe('campo obrigatorio vazio e recusado', () => {
  test('logradouro do destinatario', () => {
    expect(nota(i => { i.destinatario.endereco.logradouro = ''; }))
      .toThrow(/TEXTO_CURTO: o campo "logradouro" veio vazio/);
  });

  test('bairro do destinatario', () => {
    expect(nota(i => { i.destinatario.endereco.bairro = ''; }))
      .toThrow(/TEXTO_CURTO: o campo "bairro" veio vazio/);
  });

  test('razao social', () => {
    expect(nota(i => { i.destinatario.razaoSocial = ''; }))
      .toThrow(/TEXTO_CURTO: o campo "razão social" veio vazio/);
  });

  test('so espacos conta como vazio', () => {
    expect(nota(i => { i.destinatario.endereco.logradouro = '   '; }))
      .toThrow(/veio vazio/);
  });

  test('a mensagem do vazio explica por que a SEFAZ acusa o campo errado', () => {
    // Sem isso o operador olha o campo que a SEFAZ nomeou — que esta certo.
    expect(nota(i => { i.destinatario.endereco.logradouro = ''; }))
      .toThrow(/a tag some do XML e a SEFAZ reclama do campo seguinte/);
  });
});

describe('o que ja funcionava nao mudou', () => {
  test('uma letra continua sendo recusada com a mensagem antiga', () => {
    expect(nota(i => { i.destinatario.endereco.bairro = 'C'; }))
      .toThrow(/está com "C" — 1 caractere\(s\)/);
  });

  test('texto valido passa', () => {
    expect(nota(() => { /* sem mudanca */ })).not.toThrow();
  });

  test('campo opcional vazio continua passando', () => {
    // `xFant` nao tem minimo: nome fantasia em branco e legitimo.
    expect(nota(i => { i.emitente.fantasia = ''; })).not.toThrow();
  });
});

describe('documento do destinatario', () => {
  test('CNPJ com digito trocado e recusado antes de assinar', () => {
    expect(nota(i => { i.destinatario.cnpj = '33645647000121'; }))
      .toThrow(/não passa no dígito verificador/);
  });

  test('CPF invalido tambem e recusado', () => {
    expect(nota(i => {
      delete (i.destinatario as { cnpj?: string }).cnpj;
      i.destinatario.cpf = '11144477736';
    })).toThrow(/não passa no dígito verificador/);
  });

  test('CNPJ formatado passa e chega limpo no XML', () => {
    // Colar "33.645.647/0001-20" da tela do cliente sempre funcionou. O que nao
    // funcionava era a pontuacao seguir para o XML, onde o XSD so aceita digito.
    const montada = nota(i => { i.destinatario.cnpj = '33.645.647/0001-20'; })() as {
      dest: { CNPJ?: string };
    };
    expect(montada.dest.CNPJ).toBe('33645647000120');
  });

  test('o CNPJ do emitente tambem e conferido', () => {
    expect(nota(i => { i.emitente.cnpj = '11222333000182'; }))
      .toThrow(/CNPJ do emitente/);
  });
});
