import { XsdValidator } from '../../src/infrastructure/validation/XsdValidator';

/**
 * A previa tem que reprovar o que a SEFAZ reprovaria.
 *
 * `validate()` so testava se as tags APARECIAM no XML — nunca o conteudo. Entao
 * `numero: "0"`, `"00123"` e `serie: "1500"` passavam com verde e morriam na
 * SEFAZ com 225, que nao diz qual campo errou.
 *
 * O `validarSchema()` confere isso de verdade contra o .xsd, mas ele FALHA
 * ABERTO de proposito quando o xmllint nao esta disponivel — e nesse cenario a
 * previa voltava a nao conferir nada. Estas conferencias sao a rede que sobra
 * quando aquela cai, e por isso vivem no validador de estrutura.
 */

function xmlCom(serie: string, nNF: string): string {
  return `<infNFe versao="4.00"><ide><cUF>31</cUF><cNF>12345678</cNF>`
    + `<natOp>VENDA</natOp><mod>55</mod><serie>${serie}</serie><nNF>${nNF}</nNF>`
    + `<dhEmi>2026-08-16T10:00:00-03:00</dhEmi><tpNF>1</tpNF><tpEmis>1</tpEmis>`
    + `<tpAmb>2</tpAmb></ide><emit><CNPJ>11222333000181</CNPJ><xNome>X</xNome>`
    + `<enderEmit></enderEmit><IE>1</IE><CRT>1</CRT></emit><dest></dest>`
    + `<det nItem="1"></det><total></total><transp></transp><pag></pag></infNFe>`;
}

const errosDe = (serie: string, nNF: string) =>
  new XsdValidator().validate(xmlCom(serie, nNF))
    .errors.map(e => e.message).join(' | ');

describe('numero da nota', () => {
  test('zero e recusado', () => {
    // nNF comeca em 1. O zero e o que sai de um contador nao inicializado.
    expect(errosDe('1', '0')).toMatch(/<nNF> esta com "0"/);
  });

  test('zero a esquerda e recusado', () => {
    // "00123" e 123 com enfeite — mas o XSD nao aceita, e a chave levaria outro
    // valor que o XML.
    expect(errosDe('1', '00123')).toMatch(/<nNF> esta com "00123"/);
  });

  test('mais de 9 digitos e recusado', () => {
    expect(errosDe('1', '1234567890')).toMatch(/<nNF>/);
  });

  test('a mensagem diz o que o leiaute espera', () => {
    expect(errosDe('1', '0')).toMatch(/1 a 999999999, sem zero a esquerda/);
  });

  test('numero valido passa', () => {
    expect(errosDe('1', '123')).not.toMatch(/<nNF>/);
  });
});

describe('serie', () => {
  test('acima de 999 e recusada', () => {
    expect(errosDe('1500', '1')).toMatch(/<serie> esta com "1500"/);
  });

  test('com letra e recusada', () => {
    expect(errosDe('A1', '1')).toMatch(/<serie> esta com "A1"/);
  });

  test('zero e valida — e a serie unica', () => {
    expect(errosDe('0', '1')).not.toMatch(/<serie>/);
  });

  test('zero a esquerda e recusado', () => {
    expect(errosDe('001', '1')).toMatch(/<serie> esta com "001"/);
  });

  test('serie valida passa', () => {
    expect(errosDe('889', '1')).not.toMatch(/<serie>/);
  });
});

describe('a conferencia nao inventa erro', () => {
  test('XML sem a tag nao gera erro de padrao — gera o de ausencia', () => {
    // Duas mensagens para o mesmo campo confundem mais do que ajudam.
    const xml = xmlCom('1', '1').replace('<nNF>1</nNF>', '');
    const msgs = new XsdValidator().validate(xml).errors.map(e => e.message).join(' | ');
    expect(msgs).toMatch(/Campo obrigatorio <nNF> nao encontrado/);
    expect(msgs).not.toMatch(/nao casa com o leiaute/);
  });
});
