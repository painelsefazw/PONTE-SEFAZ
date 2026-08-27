import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { duplicarNota, limparDemonstrativo } from '../../src/domain/DuplicarNota';

function makeInput(over: Partial<FiscalContextInput> = {}): FiscalContextInput {
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
      email: 'cliente@exemplo.com',
      endereco: {
        logradouro: 'RUA B', numero: '2', bairro: 'CENTRO',
        codigoMunicipio: '3530607', nomeMunicipio: 'MOGI DAS CRUZES',
        uf: 'SP', cep: '08810240', fone: '1133334444',
      },
    },
    itens: [{
      codigo: '682700',
      descricao: 'CANETA DE BISTURI ELETRICA',
      ncm: '90189029',
      cfop: '5102',
      unidade: 'UN',
      quantidade: '2',
      valorUnitario: '1265.00',
      icms: { origem: '0', csosn: '102' },
      pis: { cst: '99' },
      cofins: { cst: '99' },
    }],
    pagamento: { formas: [{ tipo: '01', valor: '2530.00' }] },
    naturezaOperacao: 'VENDA DE MERCADORIA',
    serie: '800',
    numero: '42',
    dataEmissao: '2026-08-03T10:00:00-03:00',
    finalidade: '1',
    tipoOperacao: '1',
    destino: '1',
    indFinal: '1',
    presenca: '1',
    ambiente: '2',
    municipioFG: '3530607',
    ufEmitente: 'SP',
    modFrete: '9',
    ...over,
  };
}

describe('duplicarNota', () => {
  test('reconstroi destinatario, itens e pagamento', () => {
    const dup = duplicarNota(buildNFe(makeInput()));

    expect(dup.destinatario.cnpj).toBe('33645647000120');
    expect(dup.destinatario.razaoSocial).toBe('CLIENTE LTDA');
    expect(dup.destinatario.ie).toBe('454635504116');
    expect(dup.destinatario.endereco.codigoMunicipio).toBe('3530607');
    expect(dup.destinatario.endereco.cep).toBe('08810240');

    expect(dup.itens).toHaveLength(1);
    expect(dup.itens[0].descricao).toBe('CANETA DE BISTURI ELETRICA');
    expect(dup.itens[0].ncm).toBe('90189029');
    expect(dup.itens[0].quantidade).toBe('2.0000');
    expect(dup.itens[0].valorUnitario).toBe('1265.00');
    expect(dup.itens[0].icms.csosn).toBe('102');

    expect(dup.pagamento.formas).toEqual([{ tipo: '01', valor: '2530.00' }]);
    expect(dup.naturezaOperacao).toBe('VENDA DE MERCADORIA');
    expect(dup.serie).toBe('800');
  });

  test('nao carrega numero, chave, data nem protocolo da original', () => {
    const dup = duplicarNota(buildNFe(makeInput())) as any;
    expect(dup.numero).toBeUndefined();
    expect(dup.dataEmissao).toBeUndefined();
    expect(dup.chaveAcesso).toBeUndefined();
    expect(dup.protocolo).toBeUndefined();
    // O numero da original fica só como referencia para a tela avisar.
    expect(dup.origem.numero).toBe('42');
  });

  test('nao repete o demonstrativo IBS/CBS a cada copia', () => {
    const original = buildNFe(makeInput({
      informacoesAdicionais: { complementar: 'PEDIDO 4471' },
    }));
    expect(original.infAdic!.infCpl).toContain('Reforma Tributaria');

    const dup = duplicarNota(original);
    expect(dup.informacoesAdicionais!.complementar).toBe('PEDIDO 4471');

    // Reemitida, a copia recebe o demonstrativo uma unica vez.
    const copia = buildNFe(makeInput({
      informacoesAdicionais: dup.informacoesAdicionais,
    }));
    const ocorrencias = copia.infAdic!.infCpl!.split('Reforma Tributaria').length - 1;
    expect(ocorrencias).toBe(1);
  });

  test('nota sem texto do usuario nao volta com informacoes adicionais', () => {
    const dup = duplicarNota(buildNFe(makeInput()));
    expect(dup.informacoesAdicionais).toBeUndefined();
  });

  test('copia reemitida gera os mesmos totais da original', () => {
    const original = buildNFe(makeInput());
    const dup = duplicarNota(original);

    const copia = buildNFe(makeInput({
      destinatario: dup.destinatario,
      itens: dup.itens,
      pagamento: dup.pagamento,
      naturezaOperacao: dup.naturezaOperacao,
      tipoOperacao: dup.tipoOperacao,
      indFinal: dup.indFinal,
      presenca: dup.presenca,
      modFrete: dup.modFrete,
      numero: '43',
    }));

    expect(copia.total.ICMSTot.vProd).toBe(original.total.ICMSTot.vProd);
    expect(copia.total.ICMSTot.vNF).toBe(original.total.ICMSTot.vNF);
    expect(copia.total.ICMSTot.vTotTrib).toBe(original.total.ICMSTot.vTotTrib);
    expect(copia.total.IBSCBSTot).toEqual(original.total.IBSCBSTot);
    expect(copia.det[0].imposto).toEqual(original.det[0].imposto);
    expect(copia.ide.nNF).toBe('43');
  });

  test('preserva CST, ST e CEST no regime normal', () => {
    const original = buildNFe(makeInput({
      emitente: { ...makeInput().emitente, crt: '3' },
      itens: [{
        ...makeInput().itens[0],
        cest: '1300100',
        icms: {
          origem: '2', cst: '10', modBC: '3', vBC: '2530.00',
          pICMS: '18.00', vICMS: '455.40',
          modBCST: '4', pMVAST: '40.00', vBCST: '3542.00',
          pICMSST: '18.00', vICMSST: '182.16',
        },
      }],
    }));
    const item = duplicarNota(original).itens[0];

    expect(item.cest).toBe('1300100');
    expect(item.icms.cst).toBe('10');
    expect(item.icms.csosn).toBeUndefined();
    expect(item.icms.origem).toBe('2');
    expect(item.icms.pICMS).toBe('18.00');
    expect(item.icms.pMVAST).toBe('40.00');
    expect(item.icms.pICMSST).toBe('18.00');
  });

  test('preserva PIS/COFINS tributados com aliquota', () => {
    const original = buildNFe(makeInput({
      itens: [{
        ...makeInput().itens[0],
        pis: { cst: '01', aliquota: '1.65' },
        cofins: { cst: '01', aliquota: '7.60' },
      }],
    }));
    const item = duplicarNota(original).itens[0];

    expect(item.pis).toEqual({ cst: '01', aliquota: '1.6500' });
    expect(item.cofins).toEqual({ cst: '01', aliquota: '7.6000' });
  });

  test('omite IBS/CBS quando o item usa a tributacao integral padrao', () => {
    const item = duplicarNota(buildNFe(makeInput())).itens[0];
    expect(item.ibscbs).toBeUndefined();
  });

  test('preserva IBS/CBS quando o item tem tratamento proprio', () => {
    const original = buildNFe(makeInput({
      itens: [{ ...makeInput().itens[0], ibscbs: { cst: '200', cClassTrib: '200014' } }],
    }));
    // A reducao volta junto com o par CST/cClassTrib. Sem ela a copia nao
    // poderia ser remontada: o cClassTrib sozinho nao diz quanto reduz.
    expect(duplicarNota(original).itens[0].ibscbs)
      .toEqual({ cst: '200', cClassTrib: '200014', pRedAliq: '100.0000' });
  });

  test('a copia de um item com reducao propria pode ser emitida de novo', () => {
    const original = buildNFe(makeInput({
      itens: [{ ...makeInput().itens[0], ibscbs: { cst: '200', cClassTrib: '200014' } }],
    }));
    const copia = duplicarNota(original);
    // O ciclo tem de fechar: o que sai da duplicacao volta a entrar no motor.
    // Antes de preservar o pRedAliq isto lancava, e so aparecia em producao.
    const remontada = buildNFe(makeInput({ itens: [{ ...makeInput().itens[0], ...copia.itens[0] }] }));
    const g = remontada.det[0]!.imposto.IBSCBS!.gIBSCBS;
    expect(g.gCBS.vCBS).toBe('0.00');
    expect(g.gCBS.gRed).toEqual({ pRedAliq: '100.0000', pAliqEfet: '0.0000' });
  });

  test('nao devolve SEM GTIN como se fosse EAN digitado', () => {
    const item = duplicarNota(buildNFe(makeInput())).itens[0];
    expect(item.ean).toBeUndefined();
  });

  test('recupera destinatario pessoa fisica', () => {
    const original = buildNFe(makeInput({
      destinatario: {
        cpf: '12345678909',
        razaoSocial: 'JOAO DA SILVA',
        indIEDest: '9',
        endereco: makeInput().destinatario.endereco,
      },
    }));
    const dup = duplicarNota(original);
    expect(dup.destinatario.cpf).toBe('12345678909');
    expect(dup.destinatario.cnpj).toBeUndefined();
    expect(dup.destinatario.indIEDest).toBe('9');
  });
});

describe('limparDemonstrativo', () => {
  test('remove o demonstrativo e o separador, preservando o texto do usuario', () => {
    const texto = 'PEDIDO 4471 | Reforma Tributaria (LC 214/2025) - Base IBS/CBS R$ 10,00'
      + ' | IBS R$ 0,01 (0,10%) | CBS R$ 0,09 (0,90%)';
    expect(limparDemonstrativo(texto)).toBe('PEDIDO 4471');
  });

  test('devolve undefined quando so havia o demonstrativo', () => {
    expect(limparDemonstrativo('Reforma Tributaria (LC 214/2025) - Base IBS/CBS R$ 10,00'))
      .toBeUndefined();
  });

  test('mantem intacto o texto que nao tem demonstrativo', () => {
    expect(limparDemonstrativo('OBS | CONTATO 11 99999-0000'))
      .toBe('OBS | CONTATO 11 99999-0000');
  });

  test('nao quebra com campo vazio', () => {
    expect(limparDemonstrativo(undefined)).toBeUndefined();
    expect(limparDemonstrativo('')).toBeUndefined();
  });
});
