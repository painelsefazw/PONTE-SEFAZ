import { EventoNfseXmlGenerator, CancelamentoInput } from '../../src/infrastructure/nfse/EventoNfseXmlGenerator';
import { parseNfse } from '../../src/infrastructure/nfse/NfseParser';

/**
 * Cancelamento e leitura da NFS-e.
 *
 * A chave da NFS-e tem 50 dígitos e a da NF-e tem 44 — quem já mexe no motor
 * da NF-e passa a chave errada sem perceber, e a rejeição vem só do servidor.
 * Por isso o comprimento é checado aqui.
 */

const CHAVE = '3'.repeat(50);

function entrada(over: Partial<CancelamentoInput> = {}): CancelamentoInput {
  return {
    ambiente: '2',
    chaveAcesso: CHAVE,
    cnpjAutor: '50229544000106',
    motivo: '1',
    justificativa: 'Servico faturado em duplicidade para o mesmo cliente',
    dataEvento: '2026-07-29T10:00:00-03:00',
    ...over,
  };
}

const gerar = (o?: Partial<CancelamentoInput>) => new EventoNfseXmlGenerator().gerarCancelamento(entrada(o));

describe('cancelamento de NFS-e', () => {
  test('monta o pedido na ordem do TCInfPedReg', () => {
    const xml = gerar();
    const ordem = ['<tpAmb>', '<verAplic>', '<dhEvento>', '<CNPJAutor>', '<chNFSe>', '<e101101>'];
    const pos = ordem.map((t) => xml.indexOf(t));
    expect(pos.every((p) => p > -1)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  // O XSD publicado tem nPedRegEvento entre chNFSe e o grupo do evento; o
  // ambiente real não conhece o elemento e recusa o pedido por schema.
  test('nao emite nPedRegEvento, que o ambiente real recusa', () => {
    expect(gerar()).not.toContain('nPedRegEvento');
  });

  test('raiz e assinatura seguem o padrao do Sistema Nacional', () => {
    const xml = gerar();
    expect(xml).toContain('<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">');
    expect(xml).toContain('<infPedReg Id="PRE');
  });

  // 'PRE' + chave(50) + tipo do evento(6). O XSD publicado manda somar mais 3
  // do nPedRegEvento; o ambiente real recusa esse formato.
  test('o Id do pedido tem 56 digitos, nao os 59 do XSD publicado', () => {
    const id = EventoNfseXmlGenerator.montarId(CHAVE);
    expect(id).toHaveLength(3 + 56);
    expect(id).toMatch(/^PRE\d{56}$/);
    expect(id).toBe('PRE' + CHAVE + '101101');
  });

  // xDesc é enumeração fechada: qualquer variação é recusada por schema.
  test('a descricao do evento e o texto exato da enumeracao', () => {
    expect(gerar()).toContain('<xDesc>Cancelamento de NFS-e</xDesc>');
  });

  test('o tipo do evento de cancelamento e 101101', () => {
    expect(gerar()).toContain('<e101101>');
    expect(EventoNfseXmlGenerator.montarId(CHAVE).endsWith('101101')).toBe(true);
  });

  // A chave da NFS-e tem 50; a da NF-e, 44.
  test('recusa chave de NF-e no lugar da chave de NFS-e', () => {
    expect(() => gerar({ chaveAcesso: '3'.repeat(44) })).toThrow(/NFSE_CHAVE_INVALIDA/);
    expect(() => gerar({ chaveAcesso: '3'.repeat(44) })).toThrow(/44/);
  });

  // TSMotivo tem minLength 15 no XSD.
  test('justificativa curta e recusada antes de sair da maquina', () => {
    expect(() => gerar({ justificativa: 'erro' })).toThrow(/NFSE_JUSTIFICATIVA_CURTA/);
    expect(() => gerar({ justificativa: 'x'.repeat(256) })).toThrow(/NFSE_JUSTIFICATIVA_LONGA/);
  });

  test('so aceita os tres codigos de justificativa do XSD', () => {
    expect(gerar({ motivo: '2' })).toContain('<cMotivo>2</cMotivo>');
    expect(gerar({ motivo: '9' })).toContain('<cMotivo>9</cMotivo>');
    expect(() => gerar({ motivo: '3' as any })).toThrow(/NFSE_MOTIVO_INVALIDO/);
  });

  test('limpa formatacao do CNPJ do autor', () => {
    expect(gerar({ cnpjAutor: '50.229.544/0001-06' })).toContain('<CNPJAutor>50229544000106</CNPJAutor>');
  });
});

describe('leitura da NFS-e autorizada', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">`
    + `<infNFSe Id="NFS${'7'.repeat(50)}">`
    + `<xLocEmi>Sao Paulo</xLocEmi><xLocPrestacao>Sao Paulo</xLocPrestacao>`
    + `<nNFSe>451</nNFSe><cLocIncid>3550308</cLocIncid>`
    + `<verAplic>SEFIN</verAplic><ambGer>1</ambGer><tpEmis>1</tpEmis>`
    + `<cStat>100</cStat><dhProc>2026-07-29T15:40:00-03:00</dhProc><nDFSe>77</nDFSe>`
    + `<emit><CNPJ>29920163000174</CNPJ><IM>9988</IM><xNome>QUEIJARIA PACHECO LTDA</xNome></emit>`
    + `<valores><vBC>100.00</vBC><pAliqAplic>2.90</pAliqAplic>`
    + `<vISSQN>2.90</vISSQN><vTotalRet>0.00</vTotalRet><vLiq>97.10</vLiq></valores>`
    + `<DPS><infDPS Id="DPS3550308229920163000174000010000000000000451">`
    + `<prest><CNPJ>29920163000174</CNPJ></prest></infDPS></DPS>`
    + `</infNFSe></NFSe>`;

  test('extrai identificacao e chave do atributo Id', () => {
    const n = parseNfse(xml);
    expect(n.chaveAcesso).toBe('7'.repeat(50));
    expect(n.numero).toBe('451');
    expect(n.numeroDfse).toBe('77');
    expect(n.status).toBe('100');
    expect(n.dataProcessamento).toBe('2026-07-29T15:40:00-03:00');
    expect(n.municipioIncidencia).toBe('3550308');
  });

  test('le o emitente sem confundir com o prestador do DPS embutido', () => {
    const n = parseNfse(xml);
    expect(n.emitente?.razaoSocial).toBe('QUEIJARIA PACHECO LTDA');
    expect(n.emitente?.im).toBe('9988');
  });

  // Estes são os valores apurados pelo município, que podem diferir do que
  // enviamos: alíquota, redução e benefício são aplicados do lado de lá.
  test('le os valores apurados, nao os enviados', () => {
    const n = parseNfse(xml);
    expect(n.valores.baseCalculo).toBe('100.00');
    expect(n.valores.aliquotaAplicada).toBe('2.90');
    expect(n.valores.issqn).toBe('2.90');
    expect(n.valores.liquido).toBe('97.10');
  });

  test('recupera o Id do DPS de origem', () => {
    expect(parseNfse(xml).idDps).toBe('DPS3550308229920163000174000010000000000000451');
  });

  test('nao quebra com XML incompleto', () => {
    const n = parseNfse('<NFSe><infNFSe><nNFSe>9</nNFSe></infNFSe></NFSe>');
    expect(n.numero).toBe('9');
    expect(n.valores.liquido).toBeUndefined();
    expect(n.emitente).toBeUndefined();
  });
});
