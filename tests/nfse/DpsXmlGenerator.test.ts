import { DpsXmlGenerator } from '../../src/infrastructure/nfse/DpsXmlGenerator';
import { compactar, descompactar } from '../../src/infrastructure/nfse/SefinClient';
import { DpsContextInput } from '../../src/domain/nfse/DpsContext';
import { exigeObra } from '../../src/domain/nfse/RegrasServico';

/**
 * DPS — Declaração de Prestação de Serviços.
 *
 * A ordem dos elementos é a mesma armadilha da NF-e: fora de ordem, a rejeição
 * é de schema e não diz o campo. Por isso a ordem é travada aqui, e não só a
 * presença dos valores.
 */

function contexto(over: Partial<DpsContextInput> = {}): DpsContextInput {
  return {
    ambiente: '2',
    serie: '1',
    numero: '1',
    dataEmissao: '2026-07-29T10:00:00-03:00',
    competencia: '2026-07-01',
    codigoMunicipioEmissor: '3530607',
    tipoEmitente: '1',
    prestador: {
      cnpj: '50229544000106',
      im: '12345',
      razaoSocial: 'EMPRESA DE SERVICOS LTDA',
      endereco: {
        logradouro: 'RUA A', numero: '100', bairro: 'CENTRO',
        codigoMunicipio: '3530607', uf: 'SP', cep: '08710000',
      },
      opSimplesNacional: '3',
      regimeApuracaoSN: '1',
      regimeEspecial: '0',
    },
    tomador: {
      cnpj: '33645647000120',
      razaoSocial: 'CLIENTE LTDA',
      endereco: {
        logradouro: 'RUA B', numero: '200', bairro: 'CENTRO',
        codigoMunicipio: '3530607', uf: 'SP', cep: '08810240',
      },
    },
    servico: {
      // 01.01.01 — não é serviço de obra, então serve de caso base.
      codigoTributacaoNacional: '010101',
      descricao: 'ANALISE E DESENVOLVIMENTO DE SISTEMAS',
      codigoMunicipioPrestacao: '3530607',
    },
    valores: {
      valorServico: '1000.00',
      tributacaoISSQN: '1',
      aliquotaISS: '5.00',
      // tpRetISSQN '1' = NÃO retido. '2' significa retido pelo tomador.
      issRetido: '1',
    },
    ...over,
  };
}

const gerar = (o?: Partial<DpsContextInput>) => new DpsXmlGenerator().gerar(contexto(o));

describe('DPS — estrutura', () => {
  test('raiz declara namespace e versao', () => {
    const xml = gerar();
    expect(xml).toContain('xmlns="http://www.sped.fazenda.gov.br/nfse"');
    expect(xml).toContain('versao="1.01"');
    expect(xml).toContain('<infDPS Id="DPS');
  });

  // Ordem do TCInfDPS. Trocar qualquer par rejeita por schema.
  test('os campos do infDPS saem na ordem do XSD', () => {
    const xml = gerar();
    const ordem = ['<tpAmb>', '<dhEmi>', '<verAplic>', '<serie>', '<nDPS>',
      '<dCompet>', '<tpEmit>', '<cLocEmi>', '<prest>', '<toma>', '<serv>', '<valores>'];
    const posicoes = ordem.map((t) => xml.indexOf(t));
    expect(posicoes.every((p) => p > -1)).toBe(true);
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
  });

  // O choice endNac vem ANTES do logradouro — ordem contra-intuitiva.
  test('no endereco, o municipio vem antes do logradouro', () => {
    const xml = gerar();
    const bloco = xml.match(/<end>[\s\S]*?<\/end>/)![0];
    expect(bloco.indexOf('<endNac>')).toBeLessThan(bloco.indexOf('<xLgr>'));
    expect(bloco.indexOf('<cMun>')).toBeLessThan(bloco.indexOf('<CEP>'));
    expect(bloco.indexOf('<nro>')).toBeLessThan(bloco.indexOf('<xBairro>'));
  });

  test('regTrib e emitido — sem ele o schema recusa', () => {
    const xml = gerar();
    expect(xml).toContain('<regTrib>');
    expect(xml).toContain('<opSimpNac>3</opSimpNac>');
    expect(xml).toContain('<regEspTrib>0</regEspTrib>');
  });

  test('regime de apuracao so aparece em optante ME/EPP', () => {
    expect(gerar()).toContain('<regApTribSN>');
    const naoOptante = gerar({
      prestador: { ...contexto().prestador, opSimplesNacional: '1' },
    });
    expect(naoOptante).not.toContain('<regApTribSN>');
  });

  test('tomador com CPF em vez de CNPJ', () => {
    const xml = gerar({
      tomador: { cpf: '11144477735', razaoSocial: 'PESSOA FISICA' },
    });
    expect(xml).toContain('<CPF>11144477735</CPF>');
    expect(xml).not.toContain('<toma><CNPJ>');
  });

  test('codigo de servico sai com os 6 digitos do cTribNac', () => {
    const xml = gerar();
    expect(xml).toContain('<cTribNac>010101</cTribNac>');
  });

  test('limpa formatacao de CNPJ e CEP', () => {
    const xml = gerar({
      prestador: { ...contexto().prestador, cnpj: '50.229.544/0001-06' },
    });
    expect(xml).toContain('<CNPJ>50229544000106</CNPJ>');
    expect(xml).toContain('<CEP>08710000</CEP>');
  });
});

/**
 * Regras levantadas contra a produção restrita da SEFIN. Cada teste aqui
 * corresponde a uma rejeição real que custou uma ida ao servidor para
 * descobrir — o objetivo é que não custe uma segunda.
 */
describe('DPS — regras do codigo de tributacao nacional', () => {
  const obra = { endereco: { cep: '01310100', logradouro: 'AV PAULISTA', numero: '1000', bairro: 'BELA VISTA' } };
  const comCodigo = (cod: string, temObra = false) => () => gerar({
    servico: { ...contexto().servico, codigoTributacaoNacional: cod, obra: temObra ? obra : undefined },
  });

  // O desdobro nacional começa em 01. Assumir 00 rende E0310, que não diz
  // qual das três partes do código está errada.
  test('desdobro 00 e recusado antes de sair da maquina', () => {
    expect(comCodigo('070200')).toThrow(/NFSE_DESDOBRO_INVALIDO/);
    expect(comCodigo('010100')).toThrow(/desdobro nacional começa em 01/);
  });

  test('a mensagem sugere o codigo provavel', () => {
    expect(comCodigo('140100')).toThrow(/140101/);
  });

  test('codigo fora dos 6 digitos e recusado', () => {
    expect(comCodigo('0702')).toThrow(/NFSE_CTRIBNAC_INVALIDO/);
    expect(comCodigo('07020101')).toThrow(/NFSE_CTRIBNAC_INVALIDO/);
  });

  // E0370 na SEFIN.
  test('servico de obra sem o grupo obra e recusado', () => {
    expect(comCodigo('070201')).toThrow(/NFSE_OBRA_OBRIGATORIA/);
    expect(comCodigo('070501')).toThrow(/NFSE_OBRA_OBRIGATORIA/);
  });

  // E0372 — o inverso, e igualmente rejeitado.
  test('servico que nao e obra com o grupo obra e recusado', () => {
    expect(comCodigo('010101', true)).toThrow(/NFSE_OBRA_NAO_PERMITIDA/);
    expect(comCodigo('070101', true)).toThrow(/NFSE_OBRA_NAO_PERMITIDA/);
  });

  // 07.01 (projeto) e 07.03 (elaboração de planos) não são obra; 07.02 e
  // 07.04 a 07.08 são. A fronteira dentro do mesmo item é o que engana.
  test('a fronteira de obra fica dentro do item 07', () => {
    expect(exigeObra('070101')).toBe(false);
    expect(exigeObra('070301')).toBe(false);
    expect(exigeObra('070201')).toBe(true);
    expect(exigeObra('070801')).toBe(true);
    expect(exigeObra('071901')).toBe(true);
    expect(exigeObra('072101')).toBe(false);
  });

  test('obra com endereco sai na ordem do TCEnderObraEvento', () => {
    const xml = gerar({
      servico: { ...contexto().servico, codigoTributacaoNacional: '070201', obra },
    });
    const bloco = xml.match(/<obra>[\s\S]*?<\/obra>/)![0];
    expect(bloco.indexOf('<CEP>')).toBeLessThan(bloco.indexOf('<xLgr>'));
    expect(bloco.indexOf('<nro>')).toBeLessThan(bloco.indexOf('<xBairro>'));
    // obra fica entre cServ e infoCompl.
    expect(xml.indexOf('</cServ>')).toBeLessThan(xml.indexOf('<obra>'));
  });

  test('obra por CNO dispensa o endereco', () => {
    const xml = gerar({
      servico: {
        ...contexto().servico,
        codigoTributacaoNacional: '070201',
        obra: { codigoObra: '123456789012' },
      },
    });
    expect(xml).toContain('<cObra>123456789012</cObra>');
    expect(xml).not.toContain('<obra><end>');
  });

  test('obra sem CNO, CIB nem endereco e recusada', () => {
    expect(() => gerar({
      servico: { ...contexto().servico, codigoTributacaoNacional: '070201', obra: {} },
    })).toThrow(/NFSE_OBRA_INCOMPLETA/);
  });
});

/**
 * Substituição de NFS-e.
 *
 * Não é evento: a SEFIN recusa o pedido de e105102 no POST de eventos com
 * E1861 ("não é aceito pelo método POST da API Eventos"). Declara-se na DPS da
 * nota nova, e o Sistema Nacional cancela a antiga ao autorizar.
 *
 * Confirmado contra a produção restrita: com o grupo, o schema passa e a
 * rejeição vira E0042 (chave substituída inválida) — ou seja, o servidor chegou
 * a avaliar a substituição.
 */
describe('DPS — substituicao', () => {
  const subst = { chaveSubstituida: '9'.repeat(50), motivo: '05' };

  test('nao emite o grupo quando nao ha substituicao', () => {
    expect(gerar()).not.toContain('<subst>');
  });

  // subst vem depois de cLocEmi e antes de prest (TCInfDPS).
  test('o grupo fica entre cLocEmi e prest', () => {
    const xml = gerar({ substituicao: subst });
    expect(xml.indexOf('</cLocEmi>')).toBeLessThan(xml.indexOf('<subst>'));
    expect(xml.indexOf('</subst>')).toBeLessThan(xml.indexOf('<prest>'));
  });

  test('emite chave e motivo', () => {
    const xml = gerar({ substituicao: subst });
    expect(xml).toContain(`<chSubstda>${'9'.repeat(50)}</chSubstda>`);
    expect(xml).toContain('<cMotivo>05</cMotivo>');
    // xMotivo é opcional aqui, diferente do cancelamento.
    expect(xml).not.toContain('<xMotivo>');
  });

  test('descricao do motivo entra quando informada', () => {
    const xml = gerar({
      substituicao: { ...subst, descricaoMotivo: 'Nota rejeitada pelo tomador do servico' },
    });
    expect(xml).toContain('<xMotivo>Nota rejeitada pelo tomador do servico</xMotivo>');
  });

  test('chave de NF-e no lugar da de NFS-e e recusada', () => {
    expect(() => gerar({ substituicao: { ...subst, chaveSubstituida: '9'.repeat(44) } }))
      .toThrow(/NFSE_SUBSTITUIDA_INVALIDA/);
  });

  // Os códigos de substituição têm 2 dígitos; os de cancelamento têm 1.
  test('motivo de cancelamento nao serve para substituicao', () => {
    expect(() => gerar({ substituicao: { ...subst, motivo: '5' } }))
      .toThrow(/NFSE_MOTIVO_SUBST_INVALIDO/);
    expect(() => gerar({ substituicao: { ...subst, motivo: '5' } }))
      .toThrow(/dois dígitos/);
  });

  test('descricao curta e recusada, vazia e aceita', () => {
    expect(() => gerar({ substituicao: { ...subst, descricaoMotivo: 'erro' } }))
      .toThrow(/NFSE_MOTIVO_SUBST_CURTO/);
    expect(() => gerar({ substituicao: { ...subst, descricaoMotivo: '' } })).not.toThrow();
  });
});

describe('DPS — identificador', () => {
  // O Id é a referência da assinatura e a chave do HEAD /dps/{id}, que evita
  // emissão duplicada em timeout. Formato errado quebra as duas coisas.
  test('monta o Id no formato do Sistema Nacional', () => {
    const id = DpsXmlGenerator.montarId(contexto());
    expect(id).toMatch(/^DPS\d{42}$/);
    expect(id.slice(0, 3)).toBe('DPS');
    expect(id.slice(3, 10)).toBe('3530607');
    expect(id.slice(10, 11)).toBe('2');            // 2 = CNPJ
    expect(id.slice(11, 25)).toBe('50229544000106');
    expect(id.slice(25, 30)).toBe('00001');        // série
    expect(id.slice(30)).toBe('000000000000001');  // número
  });

  // O Id sempre foi montado só com dígitos. Se serie/nDPS saíssem crus, o
  // identificador e o corpo da nota poderiam discordar, e um valor inválido só
  // apareceria como E1235 — que não diz o campo.
  test('serie e numero saem normalizados, igual ao Id', () => {
    const xml = gerar({ serie: 'A-1', numero: '00.123' });
    expect(xml).toContain('<serie>1</serie>');
    // TSNumDPS é [1-9][0-9]{0,14}: zero à esquerda é recusado por schema.
    expect(xml).toContain('<nDPS>123</nDPS>');
    expect(DpsXmlGenerator.montarId(contexto({ serie: 'A-1', numero: '00.123' })))
      .toBe(DpsXmlGenerator.montarId(contexto({ serie: '1', numero: '123' })));
  });

  // As duas regras são opostas, e ficam em campos vizinhos: a série aceita
  // zero à esquerda e proíbe o valor zerado; o número proíbe zero à esquerda.
  test('serie aceita zero a esquerda, mas nao pode ser zero', () => {
    expect(gerar({ serie: '001' })).toContain('<serie>001</serie>');
    expect(() => gerar({ serie: '000' })).toThrow(/NFSE_SERIE_INVALIDA/);
    expect(() => gerar({ serie: '123456' })).toThrow(/NFSE_SERIE_INVALIDA/);
  });

  test('numero zerado ou longo demais e recusado', () => {
    expect(() => gerar({ numero: '0' })).toThrow(/NFSE_NUMERO_INVALIDO/);
    expect(() => gerar({ numero: '1234567890123456' })).toThrow(/NFSE_NUMERO_INVALIDO/);
  });

  test('numeros diferentes geram Ids diferentes', () => {
    const a = DpsXmlGenerator.montarId(contexto({ numero: '1' }));
    const b = DpsXmlGenerator.montarId(contexto({ numero: '2' }));
    expect(a).not.toBe(b);
  });
});

describe('compactacao para a API', () => {
  test('gzip e base64 sao reversiveis', () => {
    const xml = gerar();
    expect(descompactar(compactar(xml))).toBe(xml);
  });

  test('o base64 nao carrega caractere invalido', () => {
    expect(compactar(gerar())).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
