import { DpsXmlGenerator } from '../../src/infrastructure/nfse/DpsXmlGenerator';
import { DpsContextInput } from '../../src/domain/nfse/DpsContext';

/**
 * Tributação do ISSQN.
 *
 * O campo `tributacaoISSQN` tem quatro valores, e **dois deles exigem um grupo
 * adicional** que não é óbvio pelo XSD, porque os grupos são `minOccurs="0"`:
 *
 *   '2' imunidade  → exige `tpImunidade`     (SEFIN recusa com E0592)
 *   '3' exportação → exige `comExt`          (SEFIN recusa com E0330)
 *
 * Os dois estavam expostos na interface sem os grupos, então as duas opções
 * levavam a rejeição. Cada caso abaixo foi confirmado contra a produção
 * restrita: com o grupo, passa; sem, a SEFIN recusa.
 */

function contexto(over: {
  valores?: Partial<DpsContextInput['valores']>;
  servico?: Partial<DpsContextInput['servico']>;
} = {}): DpsContextInput {
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
      codigoTributacaoNacional: '140401',
      descricao: 'MANUTENCAO',
      codigoMunicipioPrestacao: '3550308',
      ...over.servico,
    },
    valores: {
      valorServico: '1000.00',
      tributacaoISSQN: '1',
      aliquotaISS: '5.00',
      issRetido: '1',
      ...over.valores,
    },
  };
}

const gerar = (o?: Parameters<typeof contexto>[0]) => new DpsXmlGenerator().gerar(contexto(o));

const COM_EXT = {
  modoPrestacao: '1' as const,
  vinculoEntrePartes: '0' as const,
  codigoMoeda: '220',
  valorMoedaEstrangeira: '200.00',
  mecanismoFomentoPrestador: '01',
  mecanismoFomentoTomador: '01',
  movimentacaoTemporaria: '1' as const,
  compartilharComMdic: '0' as const,
};

describe('imunidade do ISSQN', () => {
  test('imunidade sem o tipo e recusada antes de sair', () => {
    expect(() => gerar({ valores: { tributacaoISSQN: '2' } })).toThrow(/NFSE_IMUNIDADE_SEM_TIPO/);
    // A mensagem lista as opções, senão o operador não tem onde consultar.
    expect(() => gerar({ valores: { tributacaoISSQN: '2' } })).toThrow(/Templos de qualquer culto/);
    expect(() => gerar({ valores: { tributacaoISSQN: '2' } })).toThrow(/E0592/);
  });

  test('com o tipo, emite tpImunidade', () => {
    const xml = gerar({ valores: { tributacaoISSQN: '2', tipoImunidade: '2' } });
    expect(xml).toContain('<tribISSQN>2</tribISSQN>');
    expect(xml).toContain('<tpImunidade>2</tpImunidade>');
  });

  // O XSD diz "somente para o caso de Imunidade".
  test('tipo de imunidade em operacao tributavel e recusado', () => {
    expect(() => gerar({ valores: { tributacaoISSQN: '1', tipoImunidade: '1' } }))
      .toThrow(/NFSE_IMUNIDADE_INDEVIDA/);
  });

  test('tipo fora de 0-5 e recusado', () => {
    expect(() => gerar({ valores: { tributacaoISSQN: '2', tipoImunidade: '9' as any } }))
      .toThrow(/NFSE_IMUNIDADE_INVALIDA/);
  });

  // tpImunidade vem depois de tribISSQN e antes de tpRetISSQN.
  test('a ordem dentro de tribMun e a do XSD', () => {
    const bloco = gerar({ valores: { tributacaoISSQN: '2', tipoImunidade: '1' } })
      .match(/<tribMun>[\s\S]*?<\/tribMun>/)![0];
    expect(bloco.indexOf('<tribISSQN>')).toBeLessThan(bloco.indexOf('<tpImunidade>'));
    expect(bloco.indexOf('<tpImunidade>')).toBeLessThan(bloco.indexOf('<tpRetISSQN>'));
  });
});

describe('exportacao de servico', () => {
  test('exportacao sem comercio exterior e recusada', () => {
    expect(() => gerar({ valores: { tributacaoISSQN: '3' } }))
      .toThrow(/NFSE_EXPORTACAO_SEM_COMEXT/);
    expect(() => gerar({ valores: { tributacaoISSQN: '3' } })).toThrow(/E0330/);
  });

  test('com o grupo, emite comExt na ordem do XSD', () => {
    const xml = gerar({ valores: { tributacaoISSQN: '3' }, servico: { comercioExterior: COM_EXT } });
    const bloco = xml.match(/<comExt>[\s\S]*?<\/comExt>/)![0];
    const ordem = ['<mdPrestacao>', '<vincPrest>', '<tpMoeda>', '<vServMoeda>',
      '<mecAFComexP>', '<mecAFComexT>', '<movTempBens>', '<mdic>'];
    const pos = ordem.map((t) => bloco.indexOf(t));
    expect(pos.every((p) => p > -1)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  // comExt vem entre cServ e obra (TCServ).
  test('comExt fica no lugar certo dentro de serv', () => {
    const xml = gerar({ valores: { tributacaoISSQN: '3' }, servico: { comercioExterior: COM_EXT } });
    expect(xml.indexOf('</cServ>')).toBeLessThan(xml.indexOf('<comExt>'));
  });

  test('comercio exterior fora da exportacao e recusado', () => {
    expect(() => gerar({ valores: { tributacaoISSQN: '1' }, servico: { comercioExterior: COM_EXT } }))
      .toThrow(/NFSE_COMEXT_INDEVIDO/);
  });

  test('campo faltando no grupo e apontado pelo nome', () => {
    const semMoeda = { ...COM_EXT, codigoMoeda: '' };
    expect(() => gerar({ valores: { tributacaoISSQN: '3' }, servico: { comercioExterior: semMoeda } }))
      .toThrow(/codigoMoeda/);
  });

  test('moeda fora de 3 digitos e recusada', () => {
    const moedaRuim = { ...COM_EXT, codigoMoeda: '22' };
    expect(() => gerar({ valores: { tributacaoISSQN: '3' }, servico: { comercioExterior: moedaRuim } }))
      .toThrow(/NFSE_MOEDA_INVALIDA/);
  });

  test('mecanismo de fomento sai com 2 digitos', () => {
    const xml = gerar({
      valores: { tributacaoISSQN: '3' },
      servico: { comercioExterior: { ...COM_EXT, mecanismoFomentoPrestador: '1' } },
    });
    expect(xml).toContain('<mecAFComexP>01</mecAFComexP>');
  });
});

describe('exigibilidade suspensa', () => {
  test('emite tpSusp e nProcesso', () => {
    const xml = gerar({
      valores: { exigibilidadeSuspensa: { tipo: '1', numeroProcesso: '12345678920268260100' } },
    });
    expect(xml).toContain('<tpSusp>1</tpSusp>');
  });

  // TSNumProcExigSuspensa exige 30 dígitos; o número do CNJ tem 20.
  test('completa o numero do CNJ até 30 digitos', () => {
    const xml = gerar({
      valores: { exigibilidadeSuspensa: { tipo: '1', numeroProcesso: '1234567-89.2026.8.26.0100' } },
    });
    const proc = xml.match(/<nProcesso>(\d+)<\/nProcesso>/)![1];
    expect(proc).toHaveLength(30);
    expect(proc).toBe('000000000012345678920268260100');
  });

  test('tipo fora de 1-2 e recusado', () => {
    expect(() => gerar({ valores: { exigibilidadeSuspensa: { tipo: '3' as any, numeroProcesso: '1' } } }))
      .toThrow(/NFSE_EXIGSUSP_TIPO_INVALIDO/);
  });

  test('numero vazio ou longo demais e recusado', () => {
    expect(() => gerar({ valores: { exigibilidadeSuspensa: { tipo: '1', numeroProcesso: '' } } }))
      .toThrow(/NFSE_EXIGSUSP_PROCESSO_INVALIDO/);
    expect(() => gerar({ valores: { exigibilidadeSuspensa: { tipo: '1', numeroProcesso: '1'.repeat(31) } } }))
      .toThrow(/NFSE_EXIGSUSP_PROCESSO_INVALIDO/);
  });
});

describe('beneficio municipal', () => {
  test('emite nBM com a reducao por percentual', () => {
    const xml = gerar({
      valores: { beneficioMunicipal: { numero: '12345678901234', percentualReducao: '50' } },
    });
    expect(xml).toContain('<nBM>12345678901234</nBM>');
    expect(xml).toContain('<pRedBCBM>50.00</pRedBCBM>');
  });

  test('reducao por valor', () => {
    const xml = gerar({
      valores: { beneficioMunicipal: { numero: '12345678901234', valorReducao: '200,00' } },
    });
    expect(xml).toContain('<vRedBCBM>200.00</vRedBCBM>');
    expect(xml).not.toContain('<pRedBCBM>');
  });

  // O número é gerado pelo Sistema Nacional; inventado retorna E0541.
  test('numero fora de 14 digitos e recusado com a explicacao', () => {
    expect(() => gerar({ valores: { beneficioMunicipal: { numero: '123' } } }))
      .toThrow(/NFSE_BENEFICIO_INVALIDO/);
    expect(() => gerar({ valores: { beneficioMunicipal: { numero: '123' } } }))
      .toThrow(/gerado pelo Sistema Nacional/);
  });

  test('valor e percentual juntos sao recusados', () => {
    expect(() => gerar({
      valores: { beneficioMunicipal: { numero: '12345678901234', valorReducao: '1', percentualReducao: '1' } },
    })).toThrow(/NFSE_BENEFICIO_AMBIGUO/);
  });

  // BM vem depois de exigSusp e antes de tpRetISSQN.
  test('a ordem dos grupos opcionais em tribMun', () => {
    const bloco = gerar({
      valores: {
        exigibilidadeSuspensa: { tipo: '1', numeroProcesso: '1'.repeat(20) },
        beneficioMunicipal: { numero: '12345678901234', percentualReducao: '10' },
      },
    }).match(/<tribMun>[\s\S]*?<\/tribMun>/)![0];
    expect(bloco.indexOf('<exigSusp>')).toBeLessThan(bloco.indexOf('<BM>'));
    expect(bloco.indexOf('<BM>')).toBeLessThan(bloco.indexOf('<tpRetISSQN>'));
  });
});

/**
 * Grupos opcionais do serviço e do documento.
 *
 * `explRod` (pedágio) não aparece aqui de propósito: o XSD publicado tem o
 * elemento, mas o schema em produção não o conhece — ele lista os filhos
 * aceitos de `serv` na mensagem de erro e são só `comExt, obra, atvEvento,
 * infoCompl`.
 */
describe('intermediario e atividade de evento', () => {
  test('intermediario usa a mesma estrutura do tomador', () => {
    const xml = new DpsXmlGenerator().gerar({
      ...contexto(),
      intermediario: { cnpj: '50229544000106', razaoSocial: 'INTERMEDIARIO LTDA' },
    });
    expect(xml).toContain('<interm><CNPJ>50229544000106</CNPJ>');
    expect(xml).toContain('<xNome>INTERMEDIARIO LTDA</xNome>');
    // interm vem entre toma e serv.
    expect(xml.indexOf('</toma>')).toBeLessThan(xml.indexOf('<interm>'));
    expect(xml.indexOf('</interm>')).toBeLessThan(xml.indexOf('<serv>'));
  });

  test('sem intermediario o grupo nao aparece', () => {
    expect(gerar()).not.toContain('<interm>');
  });

  const evento = {
    nome: 'FEIRA DE NEGOCIOS 2026',
    dataInicio: '2026-07-10',
    dataFim: '2026-07-12',
  };

  test('evento por codigo da prefeitura', () => {
    const xml = gerar({ servico: { atividadeEvento: { ...evento, codigoEvento: 'EVT2026001' } } });
    expect(xml).toContain('<idAtvEvt>EVT2026001</idAtvEvt>');
    expect(xml).not.toContain('<atvEvento><end>');
  });

  test('evento por endereco quando nao ha codigo', () => {
    const xml = gerar({
      servico: {
        atividadeEvento: {
          ...evento,
          endereco: { cep: '01310100', logradouro: 'AV PAULISTA', numero: '1000', bairro: 'BELA VISTA' },
        },
      },
    });
    const bloco = xml.match(/<atvEvento>[\s\S]*?<\/atvEvento>/)![0];
    expect(bloco).toContain('<CEP>01310100</CEP>');
    expect(bloco.indexOf('<dtIni>')).toBeLessThan(bloco.indexOf('<dtFim>'));
  });

  // O XSD é um choice: código OU endereço, nunca os dois nem nenhum.
  test('evento sem codigo e sem endereco e recusado', () => {
    expect(() => gerar({ servico: { atividadeEvento: evento } }))
      .toThrow(/NFSE_EVENTO_SEM_IDENTIFICACAO/);
  });

  test('evento com codigo e endereco e recusado', () => {
    expect(() => gerar({
      servico: {
        atividadeEvento: {
          ...evento,
          codigoEvento: 'E1',
          endereco: { cep: '01310100', logradouro: 'A', numero: '1', bairro: 'B' },
        },
      },
    })).toThrow(/NFSE_EVENTO_AMBIGUO/);
  });

  test('periodo invertido e recusado', () => {
    expect(() => gerar({
      servico: {
        atividadeEvento: { ...evento, dataInicio: '2026-07-12', dataFim: '2026-07-10', codigoEvento: 'E1' },
      },
    })).toThrow(/NFSE_EVENTO_PERIODO_INVALIDO/);
  });

  test('data fora do formato AAAA-MM-DD e recusada', () => {
    expect(() => gerar({
      servico: { atividadeEvento: { ...evento, dataInicio: '10/07/2026', codigoEvento: 'E1' } },
    })).toThrow(/NFSE_EVENTO_DATA_INVALIDA/);
  });
});

describe('nao incidencia', () => {
  // Único dos quatro que não exige grupo nenhum.
  test('passa sem grupo adicional', () => {
    const xml = gerar({ valores: { tributacaoISSQN: '4' } });
    expect(xml).toContain('<tribISSQN>4</tribISSQN>');
    expect(xml).not.toContain('<tpImunidade>');
    expect(xml).not.toContain('<comExt>');
  });
});
