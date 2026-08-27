import { buildNFe, FiscalContextInput } from '../../src/domain/FiscalContext';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';
import { XsdValidator } from '../../src/infrastructure/validation/XsdValidator';

/**
 * IBS/CBS: o CST manda no valor destacado.
 *
 * O defeito que estes testes fecham apareceu conferindo uma nota de banana. O
 * motor aplicava as aliquotas de transicao de 2026 (0,1% de IBS e 0,9% de CBS)
 * qualquer que fosse o CST. Quem pedia CST 200 — aliquota reduzida — recebia um
 * item que declarava reducao e destacava o tributo cheio na linha de baixo.
 *
 * E "reducao de 100%" sequer era exprimivel: `gRed` nao existia no modelo nem no
 * gerador de XML, embora o XSD oficial ja o aceitasse. Nao havia como emitir
 * aliquota zero, que e como a Reforma escreve fruta fresca (LC 214/2025 art. 148
 * e Anexo XV) — nao existe CST de aliquota zero na tabela oficial; existe o CST
 * 200 com o grupo de reducao dizendo quanto reduz.
 */

/**
 * Uma caixa de banana a R$ 100,00, vendida por empresa do Simples em MG para um
 * revendedor tambem em MG — o cenario exato da nota que revelou o defeito.
 *
 * NCM 08039000 e banana de mesa; 08031000 e banana-da-terra. Nao muda o IBS/CBS
 * (o Anexo XV lista a posicao 08.03 inteira), mas o codigo aqui e o certo.
 */
function notaDeBanana(ibscbs?: Record<string, string>) {
  const input: FiscalContextInput = {
    emitente: {
      cnpj: '50229544000106', razaoSocial: 'ALIANCA ALIMENTOS LTDA',
      ie: '454941321110', crt: '1',
      endereco: {
        logradouro: 'RUA DAS FRUTAS', numero: '100', bairro: 'CENTRO',
        codigoMunicipio: '3134400', nomeMunicipio: 'JAIBA', uf: 'MG', cep: '39508000',
      },
    },
    destinatario: {
      cnpj: '33645647000120', razaoSocial: 'MERCADO REVENDEDOR LTDA',
      indIEDest: '1', ie: '454635504116',
      endereco: {
        logradouro: 'AV COMERCIO', numero: '50', bairro: 'CENTRO',
        codigoMunicipio: '3106200', nomeMunicipio: 'BELO HORIZONTE', uf: 'MG', cep: '30110000',
      },
    },
    itens: [{
      codigo: 'BAN01', descricao: 'BANANA PRATA CX 20KG', ncm: '08039000',
      cfop: '5102', unidade: 'CX', quantidade: '1', valorUnitario: '100.00',
      icms: { origem: '0', csosn: '102' },
      pis: { cst: '99' }, cofins: { cst: '99' },
      ...(ibscbs ? { ibscbs } : {}),
    }],
    pagamento: { formas: [{ tipo: '01', valor: '100.00' }] },
    naturezaOperacao: 'VENDA DE MERCADORIA',
    serie: '1', numero: '10',
    dataEmissao: '2026-08-16T10:00:00-03:00',
    finalidade: '1', tipoOperacao: '1', destino: '1',
    // Destinatario revende: nao e consumidor final.
    indFinal: '0', presenca: '1',
    ambiente: '2', municipioFG: '3134400', ufEmitente: 'MG', modFrete: '9',
  };
  return buildNFe(input);
}

const grupo = (nfe: any) => nfe.det[0].imposto.IBSCBS.gIBSCBS;

describe('CST 200: aliquota reduzida zera o valor e escreve o gRed', () => {
  test('fruta fresca sai com IBS e CBS zerados', () => {
    const g = grupo(notaDeBanana({ cst: '200', cClassTrib: '200014' }));

    // Era este o defeito: 0,10 de IBS e 0,90 de CBS numa banana isenta.
    expect(g.gCBS.vCBS).toBe('0.00');
    expect(g.gIBSUF.vIBSUF).toBe('0.00');
    expect(g.vIBS).toBe('0.00');
  });

  test('a aliquota cheia continua declarada — some so a efetiva', () => {
    const g = grupo(notaDeBanana({ cst: '200', cClassTrib: '200014' }));

    // O grupo nao mente sobre a aliquota do regime; ele diz a aliquota e, ao
    // lado, o quanto dela foi reduzida. Zerar `pCBS` seria outra afirmacao.
    expect(g.gCBS.pCBS).toBe('0.9000');
    expect(g.gCBS.gRed).toEqual({ pRedAliq: '100.0000', pAliqEfet: '0.0000' });
    expect(g.gIBSUF.gRed).toEqual({ pRedAliq: '100.0000', pAliqEfet: '0.0000' });
  });

  test('reducao parcial cobra o que sobrou da aliquota', () => {
    // 60% de reducao sobre 0,9% deixa 0,36% — R$ 0,36 em R$ 100,00.
    const g = grupo(notaDeBanana({ cst: '200', cClassTrib: '200099', pRedAliq: '60' }));

    expect(g.gCBS.gRed).toEqual({ pRedAliq: '60.0000', pAliqEfet: '0.3600' });
    expect(g.gCBS.vCBS).toBe('0.36');
  });

  test('cClassTrib fora da tabela exige o percentual em vez de chutar', () => {
    // Chutar reducao e errar tributo. O motor recusa e diz o que mandar.
    expect(() => notaDeBanana({ cst: '200', cClassTrib: '200099' }))
      .toThrow(/pRedAliq/);
  });

  test('percentual fora de 0 a 100 nao passa', () => {
    expect(() => notaDeBanana({ cst: '200', cClassTrib: '200099', pRedAliq: '120' }))
      .toThrow(/entre 0 e 100/);
  });
});

describe('o par CST x cClassTrib e conferido antes de sair', () => {
  test('cClassTrib que nao comeca pelo CST e recusado', () => {
    // Regra da NT: os tres primeiros digitos do cClassTrib sao o proprio CST.
    // Sem esta conferencia a nota ia para a SEFAZ e voltava como 1024.
    expect(() => notaDeBanana({ cst: '200', cClassTrib: '000001' }))
      .toThrow(/1024/);
  });

  test('CST trocado sem cClassTrib nao herda o padrao de tributacao integral', () => {
    // O par 200/000001 nao existe na tabela. Herdar o padrao montava
    // exatamente esse par invalido, em silencio.
    expect(() => notaDeBanana({ cst: '200' })).toThrow(/cClassTrib/);
  });
});

describe('o que ja funcionava continua igual', () => {
  test('sem informar nada, a venda comum segue tributada integralmente', () => {
    const nfe: any = notaDeBanana();
    const g = grupo(nfe);

    expect(nfe.det[0].imposto.IBSCBS.CST).toBe('000');
    expect(nfe.det[0].imposto.IBSCBS.cClassTrib).toBe('000001');
    expect(g.gCBS.vCBS).toBe('0.90');
    expect(g.gIBSUF.vIBSUF).toBe('0.10');
    // Sem reducao nao existe grupo de reducao — ele e opcional no XSD.
    expect(g.gCBS.gRed).toBeUndefined();
  });

  test('CST nao tributado nao destaca valor', () => {
    // Vale a mesma regra do CST 200, sem gRed: um CST que diz "nao tributado"
    // com valor ao lado e contradicao dentro da propria linha.
    const g = grupo(notaDeBanana({ cst: '400', cClassTrib: '400001' }));

    expect(g.gCBS.vCBS).toBe('0.00');
    expect(g.vIBS).toBe('0.00');
    expect(g.gCBS.gRed).toBeUndefined();
  });

  test('o total da nota fecha com os itens zerados', () => {
    const nfe: any = notaDeBanana({ cst: '200', cClassTrib: '200014' });

    // Total que nao fecha com a soma dos itens e rejeicao na hora.
    expect(nfe.total.IBSCBSTot.gCBS.vCBS).toBe('0.00');
    expect(nfe.total.IBSCBSTot.gIBS.vIBS).toBe('0.00');
    // E sem tributo destacado o "valor aproximado dos tributos" tambem e zero.
    expect(nfe.total.ICMSTot.vTotTrib).toBe('0.00');
  });
});

describe('o XML sai valido para a SEFAZ', () => {
  test('gRed entra entre a aliquota e o valor, como o XSD exige', () => {
    const nfe = notaDeBanana({ cst: '200', cClassTrib: '200014' });
    const xml = new XmlGenerator().generateInfNFe(nfe as any, '3'.repeat(44));

    // A ordem nao e intuitiva — o natural seria o gRed depois do valor — e
    // trocar rende rejeicao de schema (225), que nao diz qual campo errou.
    expect(xml).toMatch(/<pCBS>0\.9000<\/pCBS><gRed><pRedAliq>100\.0000<\/pRedAliq><pAliqEfet>0\.0000<\/pAliqEfet><\/gRed><vCBS>0\.00<\/vCBS>/);
    expect(xml).toMatch(/<pIBSUF>0\.1000<\/pIBSUF><gRed>.*?<\/gRed><vIBSUF>0\.00<\/vIBSUF>/);
  });

  test('passa no schema oficial', async () => {
    const nfe = notaDeBanana({ cst: '200', cClassTrib: '200014' });
    const xml = new XmlGenerator().generateInfNFe(nfe as any, '3'.repeat(44));
    const r = await new XsdValidator().validarSchema(xml);

    // `disponivel` falso significa que o xmllint nao rodou; ai o teste nao
    // provaria nada e e melhor dizer isso do que passar de graca.
    expect(r.disponivel).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });
});
