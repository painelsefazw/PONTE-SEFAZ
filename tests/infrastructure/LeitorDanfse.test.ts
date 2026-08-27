/**
 * Lido contra uma NFS-e de produção real (Mogi das Cruzes, emitida pelo sistema
 * do município), anonimizada nos dados do tomador. Os valores fiscais e todo o
 * bloco IBS/CBS estão intactos — é a única amostra que temos do bloco novo
 * preenchido de verdade.
 */
import * as fs from 'fs';
import * as path from 'path';
import { lerDanfse } from '../../src/infrastructure/pdf/danfse/LeitorDanfse';

const xml = fs.readFileSync(
  path.join(__dirname, '../fixtures/nfse/nfse-real-ibscbs.xml'), 'utf8');

describe('LeitorDanfse — NFS-e real com IBS/CBS', () => {
  const d = lerDanfse(xml);

  test('identificação da nota', () => {
    expect(d.chaveAcesso).toBe('35306071252372968000142000000000776426070602320288');
    expect(d.chaveAcesso).toHaveLength(50);
    expect(d.numero).toBe('7764');
    expect(d.numeroDps).toBe('7764');
    expect(d.serieDps).toBe('49998');
    expect(d.competencia).toBe('2026-07-01');
    expect(d.municipioEmissor).toBe('MOGI DAS CRUZES');
    expect(d.tipoAmbiente).toBe('1');
    expect(d.cancelada).toBe(false);
  });

  test('prestador vem do emit, com endereço e contato', () => {
    expect(d.prestador.documento).toBe('52372968000142');
    expect(d.prestador.im).toBe('17514');
    expect(d.prestador.nome).toContain('CENTRO DE ORTOPEDIA');
    expect(d.prestador.municipio).toBe('3530607');
    expect(d.prestador.uf).toBe('SP');
    expect(d.prestador.endereco).toContain('BARAO DE JACEGUAI');
    expect(d.prestador.optanteSimples).toBe('1');
  });

  test('tomador pessoa física', () => {
    expect(d.tomador.documento).toBe('11144477735');
    expect(d.tomador.nome).toContain('MARIA');
    expect(d.tomador.endereco).toContain('RUA DE TESTE');
    // A NT manda imprimir traço onde o XML não traz nada.
    expect(d.tomador.im).toBeUndefined();
    expect(d.tomador.fone).toBeUndefined();
  });

  test('serviço', () => {
    expect(d.servico.codigoTributacaoNacional).toBe('040101');
    expect(d.servico.codigoNbs).toBe('123012200');
    expect(d.servico.descricao).toContain('MEDICOS');
    expect(d.servico.descricaoTributacao).toBe('Medicina.');
  });

  test('ISSQN', () => {
    expect(d.issqn.baseCalculo).toBe('300.00');
    expect(d.issqn.aliquota).toBe('3.00');
    expect(d.issqn.apurado).toBe('9.00');
    // tpRetISSQN 1 = NÃO retido; por isso o líquido é o valor cheio.
    expect(d.issqn.retencao).toBe('1');
    expect(d.totais.liquido).toBe('300.00');
  });

  describe('bloco IBS/CBS (NT item 2.1.10)', () => {
    test('os quatorze campos vêm preenchidos', () => {
      expect(d.ibscbs).toMatchObject({
        cst: '200',
        cClassTrib: '200029',
        indicadorOperacao: '030101',
        codigoIncidencia: '3530607',
        municipioIncidencia: 'Mogi das Cruzes',
        baseCalculo: '291.00',
        redAliqIBSUF: '60.00',
        redAliqIBSMun: '60.00',
        redAliqCBS: '60.00',
        aliqIBSUF: '0.10',
        aliqIBSMun: '0.00',
        aliqEfetivaMun: '0.00',
        valorIBSMun: '0.00',
        aliqEfetivaUF: '0.04',
        valorIBSUF: '0.12',
        valorIBSTotal: '0.12',
        aliqCBS: '0.90',
        aliqEfetivaCBS: '0.36',
        valorCBS: '1.05',
      });
    });

    test('exclusões da base = valor do serviço menos a base do IBS/CBS', () => {
      // 300,00 de serviço − 9,00 de ISSQN = 291,00 de base. A NT define a
      // exclusão como somatório de campos do XML, e aqui só o ISSQN existe.
      expect(d.ibscbs.exclusoesReducoes).toBe('9.00');
      expect(Number(d.totais.valorServico) - Number(d.ibscbs.exclusoesReducoes))
        .toBeCloseTo(Number(d.ibscbs.baseCalculo), 2);
    });
  });

  test('totais', () => {
    expect(d.totais.valorServico).toBe('300.00');
    expect(d.totais.totalIbsCbs).toBe('1.17');   // 0,12 de IBS + 1,05 de CBS
    expect(d.totais.tribMunicipais).toBe('9.00');
    expect(d.totais.percentualTributos).toBe(false);
  });

  test('vTotNF sai do XML como está, sem recalcular', () => {
    // O XML traz 300,00 embora líquido + IBS/CBS desse 301,17. A NT proíbe
    // imprimir informação que não conste do arquivo, então o campo é copiado.
    expect(d.totais.liquidoMaisIbsCbs).toBe('300.00');
  });

  test('não inventa informação complementar que não existe', () => {
    expect(d.informacoesComplementares).toEqual([]);
  });
});

describe('LeitorDanfse — casos que a NT trata explicitamente', () => {
  test('nota cancelada é sinalizada pelo cStat 101', () => {
    expect(lerDanfse(xml.replace('<cStat>100</cStat>', '<cStat>101</cStat>')).cancelada)
      .toBe(true);
  });

  test('substituição é detectada pela chave da nota substituída', () => {
    const comSubst = xml.replace('<tpEmit>1</tpEmit>',
      '<tpEmit>1</tpEmit><chSubstda>35306071252372968000142000000000776426070602320111</chSubstda>');
    const d = lerDanfse(comSubst);
    expect(d.substituida).toBe(true);
    expect(d.informacoesComplementares.some(i => i.startsWith('NFS-e Subst.:'))).toBe(true);
  });

  test('informações complementares saem na ordem da NT', () => {
    const comInfo = xml.replace('</cServ>',
      '</cServ><infoCompl><xInfComp>PAGAMENTO EM 30 DIAS</xInfComp><docRef>OS 4471</docRef></infoCompl>');
    expect(lerDanfse(comInfo).informacoesComplementares)
      .toEqual(['Inf. Cont.: PAGAMENTO EM 30 DIAS', 'Doc. Ref.: OS 4471']);
  });

  test('aceita totais de tributos em percentual', () => {
    const comPct = xml
      .replace(/<vTotTrib>[\s\S]*?<\/vTotTrib>/,
        '<pTotTrib><pTotTribFed>1.50</pTotTribFed><pTotTribEst>0.00</pTotTribEst>'
        + '<pTotTribMun>3.00</pTotTribMun></pTotTrib>');
    const d = lerDanfse(comPct);
    expect(d.totais.percentualTributos).toBe(true);
    expect(d.totais.tribMunicipais).toBe('3.00');
  });
});
