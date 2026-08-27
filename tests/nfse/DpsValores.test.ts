import {
  DpsXmlGenerator, decimalDps, gerarDhEmiDps, gerarCompetencia,
} from '../../src/infrastructure/nfse/DpsXmlGenerator';
import { DpsContextInput } from '../../src/domain/nfse/DpsContext';

/**
 * Valores, retenções federais e dedução da base.
 *
 * As estruturas aqui foram validadas contra a produção restrita da SEFIN: os
 * cinco arranjos testados passam o schema e param só no credenciamento (E0084).
 */

function contexto(valores: Partial<DpsContextInput['valores']> = {}): DpsContextInput {
  return {
    ambiente: '2',
    serie: '1',
    numero: '1',
    dataEmissao: '2026-07-29T10:00:00-03:00',
    competencia: '2026-07-01',
    codigoMunicipioEmissor: '3550308',
    tipoEmitente: '1',
    prestador: {
      cnpj: '29920163000174',
      razaoSocial: 'PRESTADOR LTDA',
      endereco: {
        logradouro: 'AV PAULISTA', numero: '1636', bairro: 'BELA VISTA',
        codigoMunicipio: '3550308', uf: 'SP', cep: '01310200',
      },
      opSimplesNacional: '1',
      regimeEspecial: '0',
    },
    tomador: { cnpj: '33645647000120', razaoSocial: 'CLIENTE LTDA' },
    servico: {
      codigoTributacaoNacional: '010101',
      descricao: 'CONSULTORIA',
      codigoMunicipioPrestacao: '3550308',
    },
    valores: {
      valorServico: '10000.00',
      tributacaoISSQN: '1',
      aliquotaISS: '5.00',
      // '1' = NÃO retido. Não trocar para '2' achando que é "não": '2' é
      // retido pelo tomador, e passa a exigir o endereço dele.
      issRetido: '1',
      ...valores,
    },
  };
}

const gerar = (v?: Partial<DpsContextInput['valores']>) => new DpsXmlGenerator().gerar(contexto(v));

/**
 * Os tipos TSDecNV2 não aceitam "número com decimais": o padrão exige
 * exatamente 2 casas ou nenhuma, e proíbe zero à esquerda. Dado de ERP viola
 * isso o tempo todo, e a recusa vem como E1235 sem dizer o campo.
 */
describe('normalizacao de decimais', () => {
  test('completa a segunda casa decimal', () => {
    expect(decimalDps('100.5')).toBe('100.50');
    expect(decimalDps('1234')).toBe('1234.00');
  });

  test('aceita virgula, que e o que o operador digita', () => {
    expect(decimalDps('1.234,56')).toBe('1234.56');
    expect(decimalDps('1234,5')).toBe('1234.50');
  });

  test('remove zero a esquerda', () => {
    expect(decimalDps('0100.00')).toBe('100.00');
    expect(decimalDps('000123,45')).toBe('123.45');
  });

  // Truncar perde centavo, e centavo perdido em nota fiscal e divergencia de
  // conciliacao. Por isso arredonda.
  test('arredonda a terceira casa em vez de truncar', () => {
    expect(decimalDps('100.567')).toBe('100.57');
    expect(decimalDps('100.564')).toBe('100.56');
    expect(decimalDps('100.565')).toBe('100.57');
  });

  test('propaga o carry corretamente', () => {
    expect(decimalDps('9.999')).toBe('10.00');
    expect(decimalDps('0.999')).toBe('1.00');
    expect(decimalDps('99.995')).toBe('100.00');
  });

  test('zero sai como 0.00, que o padrao aceita', () => {
    expect(decimalDps('0')).toBe('0.00');
    expect(decimalDps('0,004')).toBe('0.00');
  });

  test('vazio nao virou zero — some do XML', () => {
    expect(decimalDps('')).toBeUndefined();
    expect(decimalDps(undefined)).toBeUndefined();
    expect(decimalDps(null)).toBeUndefined();
  });

  test('recusa o que nao e numero positivo', () => {
    expect(() => decimalDps('-10', 'vServ')).toThrow(/NFSE_VALOR_INVALIDO/);
    expect(() => decimalDps('abc', 'vServ')).toThrow(/vServ/);
    expect(() => decimalDps('1'.repeat(16))).toThrow(/15 dígitos/);
  });

  test('normaliza tambem o que ja estava no DPS', () => {
    const xml = gerar({ valorServico: '10.000,5', aliquotaISS: '5' });
    expect(xml).toContain('<vServ>10000.50</vServ>');
    expect(xml).toContain('<pAliq>5.00</pAliq>');
  });
});

/**
 * Data de emissão e competência.
 *
 * A SEFIN ignora o rótulo de fuso e lê a hora como se fosse de Brasília:
 * comprovado enviando o mesmo instante com `+00:00` (recusado por E0008) e com
 * `-03:00` (aceito). Isso torna o fuso do servidor relevante — e o servidor de
 * produção roda em UTC, enquanto a máquina de desenvolvimento roda em UTC-3.
 *
 * Estes testes fixam o instante e conferem a saída, então valem em qualquer
 * fuso onde a suíte rodar.
 */
describe('data no fuso de Brasilia', () => {
  // 30/07/2026 01:48 UTC = 29/07/2026 22:48 em Brasília.
  const instante = new Date('2026-07-30T01:48:00.000Z');

  test('emite a hora de Brasilia, nao a do servidor', () => {
    // Com a margem de 60s: 22:47:00.
    expect(gerarDhEmiDps(instante)).toBe('2026-07-29T22:47:00-03:00');
  });

  test('o rotulo de fuso e o de Brasilia', () => {
    expect(gerarDhEmiDps(instante)).toMatch(/-03:00$/);
    expect(gerarDhEmiDps(instante)).not.toContain('+00:00');
  });

  test('a data recua junto quando a hora de Brasilia e do dia anterior', () => {
    // 01/08 02:30 UTC = 31/07 23:30 em Brasília: dia e mês diferentes.
    const virada = new Date('2026-08-01T02:30:00.000Z');
    expect(gerarDhEmiDps(virada)).toContain('2026-07-31T');
    expect(gerarCompetencia(virada)).toBe('2026-07-01');
  });

  test('competencia e o primeiro dia do mes de Brasilia', () => {
    expect(gerarCompetencia(instante)).toBe('2026-07-01');
    expect(gerarCompetencia(new Date('2026-03-15T12:00:00.000Z'))).toBe('2026-03-01');
  });

  // Sem a margem a SEFIN recusa mesmo com o relógio correto.
  test('aplica a margem de 60s', () => {
    const dh = gerarDhEmiDps(instante);
    const semMargem = gerarDhEmiDps(new Date(instante.getTime() + 60000));
    expect(dh).toBe('2026-07-29T22:47:00-03:00');
    expect(semMargem).toBe('2026-07-29T22:48:00-03:00');
  });
});

/**
 * Retenção do ISSQN.
 *
 * `tpRetISSQN` é 1 = NÃO retido, 2 = retido pelo tomador, 3 = pelo
 * intermediário — o contrário da intuição, e o contrário do `issRetido` de
 * outros emissores, onde 1 costuma ser "sim".
 *
 * Trocar os dois inverte quem paga o ISS na nota. Não é erro de schema: a nota
 * é autorizada com o tributo atribuído a quem não deve, e aí só o cancelamento
 * resolve. Por isso a polaridade está travada aqui.
 */
describe('polaridade do tpRetISSQN', () => {
  test('o padrao e NAO retido', () => {
    expect(gerar()).toContain('<tpRetISSQN>1</tpRetISSQN>');
    expect(gerar({ issRetido: undefined })).toContain('<tpRetISSQN>1</tpRetISSQN>');
  });

  test('1 e nao retido, 2 e retido pelo tomador', () => {
    expect(gerar({ issRetido: '1' })).toContain('<tpRetISSQN>1</tpRetISSQN>');
    const comEndereco = { ...contexto().tomador, endereco: contexto().prestador.endereco };
    const xml = new DpsXmlGenerator().gerar({ ...contexto(), tomador: comEndereco, valores: { ...contexto().valores, issRetido: '2' } });
    expect(xml).toContain('<tpRetISSQN>2</tpRetISSQN>');
  });

  test('valor fora de 1-3 e recusado', () => {
    expect(() => gerar({ issRetido: '9' as any })).toThrow(/NFSE_RETENCAO_ISS_INVALIDA/);
  });

  // E0237 na SEFIN: retido exige o endereço nacional do tomador. A mensagem de
  // lá fala de retenção, o que confunde quem não pediu retenção nenhuma.
  test('retido sem endereco do tomador e recusado com o motivo', () => {
    expect(() => gerar({ issRetido: '2' })).toThrow(/NFSE_TOMADOR_SEM_ENDERECO/);
    expect(() => gerar({ issRetido: '3' })).toThrow(/E0237/);
  });

  test('nao retido dispensa o endereco do tomador', () => {
    expect(() => gerar({ issRetido: '1' })).not.toThrow();
  });
});

/**
 * Retenções federais. É o que separa o valor bruto do que o prestador recebe
 * quando o tomador é pessoa jurídica.
 */
describe('retencoes federais (tribFed)', () => {
  const completo = {
    tributosFederais: {
      pisCofins: {
        cst: '01', baseCalculo: '10000.00', aliquotaPis: '0.65', aliquotaCofins: '3.00',
        valorPis: '65.00', valorCofins: '300.00', retido: '1' as const,
      },
      valorRetidoINSS: '1100.00',
      valorRetidoIRRF: '150.00',
      valorRetidoCSLL: '100.00',
    },
  };

  test('emite o grupo na ordem do TCTribFederal', () => {
    const bloco = gerar(completo).match(/<tribFed>[\s\S]*?<\/tribFed>/)![0];
    const ordem = ['<piscofins>', '<vRetCP>', '<vRetIRRF>', '<vRetCSLL>'];
    const pos = ordem.map((t) => bloco.indexOf(t));
    expect(pos.every((p) => p > -1)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  // tribFed vem entre tribMun e totTrib.
  test('tribFed fica no lugar certo dentro de trib', () => {
    const xml = gerar(completo);
    expect(xml.indexOf('</tribMun>')).toBeLessThan(xml.indexOf('<tribFed>'));
    expect(xml.indexOf('</tribFed>')).toBeLessThan(xml.indexOf('<totTrib>'));
  });

  // O INSS retido chama vRetCP no XSD — CP de contribuicao previdenciaria.
  test('o INSS sai como vRetCP', () => {
    expect(gerar(completo)).toContain('<vRetCP>1100.00</vRetCP>');
  });

  test('PIS e COFINS vao num grupo unico com CST comum', () => {
    const bloco = gerar(completo).match(/<piscofins>[\s\S]*?<\/piscofins>/)![0];
    const ordem = ['<CST>', '<vBCPisCofins>', '<pAliqPis>', '<pAliqCofins>', '<vPis>', '<vCofins>', '<tpRetPisCofins>'];
    const pos = ordem.map((t) => bloco.indexOf(t));
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
    expect(bloco).toContain('<CST>01</CST>');
  });

  test('so as retencoes, sem PIS/COFINS', () => {
    const xml = gerar({ tributosFederais: { valorRetidoIRRF: '150.00' } });
    expect(xml).toContain('<tribFed><vRetIRRF>150.00</vRetIRRF></tribFed>');
    expect(xml).not.toContain('<piscofins>');
  });

  test('grupo vazio nao vira tag vazia', () => {
    expect(gerar({ tributosFederais: {} })).not.toContain('<tribFed>');
    expect(gerar()).not.toContain('<tribFed>');
  });

  test('CST fora de 00-09 e recusado', () => {
    expect(() => gerar({ tributosFederais: { pisCofins: { cst: '1' } } }))
      .toThrow(/NFSE_CST_PISCOFINS_INVALIDO/);
    expect(() => gerar({ tributosFederais: { pisCofins: { cst: '49' } } }))
      .toThrow(/NFSE_CST_PISCOFINS_INVALIDO/);
  });
});

/**
 * IBS/CBS na NFS-e (Reforma Tributária).
 *
 * Estrutura diferente da NF-e: lá o grupo vai por item, com base e alíquotas;
 * aqui vai uma vez por nota e declara só a situação tributária.
 *
 * Limite conhecido: a SEFIN recusa por credenciamento (E0084) **antes** de
 * validar este grupo, então a estrutura está confirmada como aceita pelo schema
 * mas a validade semântica do `cIndOp` não pôde ser verificada contra o
 * ambiente real. Por isso o campo não tem valor padrão — quem emite informa.
 */
describe('IBS/CBS no DPS', () => {
  const comIbsCbs = (ibsCbs: any) => new DpsXmlGenerator().gerar({ ...contexto(), ibsCbs });

  test('nao emite o grupo quando nao pedido', () => {
    expect(gerar()).not.toContain('<IBSCBS>');
  });

  // Último elemento do infDPS, depois de valores.
  test('o grupo vai no fim do infDPS', () => {
    const xml = comIbsCbs({ codigoIndicadorOperacao: '000001' });
    expect(xml.indexOf('</valores>')).toBeLessThan(xml.indexOf('<IBSCBS>'));
    expect(xml).toMatch(/<\/IBSCBS><\/infDPS>/);
  });

  test('ordem do TCRTCInfoIBSCBS', () => {
    const bloco = comIbsCbs({ codigoIndicadorOperacao: '000001', usoConsumoPessoal: '1' })
      .match(/<IBSCBS>[\s\S]*?<\/IBSCBS>/)![0];
    const ordem = ['<finNFSe>', '<indFinal>', '<cIndOp>', '<indDest>', '<valores>'];
    const pos = ordem.map((t) => bloco.indexOf(t));
    expect(pos.every((p) => p > -1)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  // Tributação integral: os mesmos códigos da NF-e.
  test('o padrao e tributacao integral', () => {
    const xml = comIbsCbs({ codigoIndicadorOperacao: '000001' });
    expect(xml).toContain('<CST>000</CST>');
    expect(xml).toContain('<cClassTrib>000001</cClassTrib>');
    expect(xml).toContain('<finNFSe>0</finNFSe>');
    expect(xml).toContain('<indDest>0</indDest>');
  });

  test('aceita outra situacao tributaria', () => {
    const xml = comIbsCbs({ codigoIndicadorOperacao: '000001', cst: '200', classificacaoTributaria: '200001' });
    expect(xml).toContain('<CST>200</CST>');
    expect(xml).toContain('<cClassTrib>200001</cClassTrib>');
  });

  test('credito presumido so aparece quando informado', () => {
    expect(comIbsCbs({ codigoIndicadorOperacao: '000001' })).not.toContain('<cCredPres>');
    expect(comIbsCbs({ codigoIndicadorOperacao: '000001', codigoCreditoPresumido: '01' }))
      .toContain('<cCredPres>01</cCredPres>');
  });

  test('recusa cIndOp fora dos 6 digitos', () => {
    expect(() => comIbsCbs({ codigoIndicadorOperacao: '1' })).toThrow(/NFSE_CINDOP_INVALIDO/);
    expect(() => comIbsCbs({ codigoIndicadorOperacao: '1234567' })).toThrow(/Anexo VII/);
  });

  test('recusa CST e classificacao com tamanho errado', () => {
    expect(() => comIbsCbs({ codigoIndicadorOperacao: '000001', cst: '00' }))
      .toThrow(/NFSE_CST_IBSCBS_INVALIDO/);
    expect(() => comIbsCbs({ codigoIndicadorOperacao: '000001', classificacaoTributaria: '001' }))
      .toThrow(/NFSE_CCLASSTRIB_INVALIDO/);
  });
});

/**
 * Dedução e redução da base — subempreitada e material aplicado saem da base
 * do ISS. Caso comum da construção civil.
 */
describe('deducao e reducao (vDedRed)', () => {
  test('por valor absoluto', () => {
    const xml = gerar({ deducaoReducao: { valor: '2.000,00' } });
    expect(xml).toContain('<vDedRed><vDR>2000.00</vDR></vDedRed>');
  });

  test('por percentual', () => {
    const xml = gerar({ deducaoReducao: { percentual: '30' } });
    expect(xml).toContain('<vDedRed><pDR>30.00</pDR></vDedRed>');
  });

  // vDedRed vem depois dos descontos e antes de trib.
  test('fica no lugar certo dentro de valores', () => {
    const xml = gerar({ deducaoReducao: { valor: '2000.00' }, descontoIncondicionado: '100.00' });
    expect(xml.indexOf('</vDescCondIncond>')).toBeLessThan(xml.indexOf('<vDedRed>'));
    expect(xml.indexOf('</vDedRed>')).toBeLessThan(xml.indexOf('<trib>'));
  });

  // O XSD e um choice: os dois juntos sao rejeitados por schema.
  test('percentual e valor juntos sao recusados', () => {
    expect(() => gerar({ deducaoReducao: { percentual: '30', valor: '2000.00' } }))
      .toThrow(/NFSE_DEDUCAO_AMBIGUA/);
  });

  test('grupo vazio nao vira tag vazia', () => {
    expect(gerar({ deducaoReducao: {} })).not.toContain('<vDedRed>');
    expect(gerar()).not.toContain('<vDedRed>');
  });
});
