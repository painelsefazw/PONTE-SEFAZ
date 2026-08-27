import { generateAccessKey } from '../../src/domain/NFeKeyGenerator';

/**
 * A chave de acesso nao pode discordar do XML.
 *
 * `pad()` fazia `.padStart(length,'0').slice(-length)` — o slice CORTAVA em vez
 * de reclamar. Com `serie: "1500"` a chave levava '500' e o XML levava 1500; com
 * um numero de 10 digitos a chave levava os 9 ultimos. O Id assinado deixa de
 * corresponder a concatenacao dos campos e a SEFAZ recusa (502) sem dizer qual
 * campo errou.
 *
 * Pior que a rejeicao: a previa devolvia essa chave com ar de correta, e o
 * operador conferia na tela um numero que nao existe.
 */

const base = {
  cUF: '31',
  dhEmi: '2026-08-16T10:00:00-03:00',
  cnpj: '11222333000181',
  mod: '55',
  serie: '1',
  nNF: '123',
  tpEmis: '1',
  cNF: '12345678',
};

const chave = (mudanca: Partial<typeof base>) => generateAccessKey({ ...base, ...mudanca });

describe('o que nao cabe e recusado, nao cortado', () => {
  test('serie de 4 digitos recusa nomeando o valor', () => {
    expect(() => chave({ serie: '1500' })).toThrow(/serie "1500" nao cabe/);
  });

  test('a recusa diz quantos digitos cabem', () => {
    // "nao cabe" sozinho manda adivinhar o tamanho.
    expect(() => chave({ serie: '1500' })).toThrow(/sao 4 digitos e o campo tem 3/);
  });

  test('numero de 10 digitos recusa', () => {
    // ERP que ja passou de 999.999.999, ou que concatenou pedido + item.
    expect(() => chave({ nNF: '1234567890' })).toThrow(/numero da nota .* nao cabe/);
  });

  test('a recusa explica por que cortar seria pior', () => {
    expect(() => chave({ nNF: '1234567890' })).toThrow(/chave diferente do XML/);
  });
});

describe('letra e erro; pontuacao e formatacao', () => {
  test('serie com letra recusa em vez de virar 001', () => {
    // `"A1"` virava '001' na chave e continuava 'A1' no XML.
    expect(() => chave({ serie: 'A1' })).toThrow(/nao e digito/);
  });

  test('CNPJ formatado continua funcionando', () => {
    // Colar "11.222.333/0001-81" da tela do cliente sempre valeu, e quebrar isso
    // seria trocar um defeito por outro.
    expect(chave({ cnpj: '11.222.333/0001-81' }).chave)
      .toBe(chave({ cnpj: '11222333000181' }).chave);
  });
});

describe('o que sempre funcionou continua igual', () => {
  test('completa com zeros a esquerda', () => {
    const r = chave({ serie: '1', nNF: '123' });
    expect(r.chave).toHaveLength(44);
    expect(r.chave.slice(22, 25)).toBe('001');
    expect(r.chave.slice(25, 34)).toBe('000000123');
  });

  test('serie 0 e valida — e a serie unica', () => {
    expect(() => chave({ serie: '0' })).not.toThrow();
  });

  test('o maior valor de cada campo cabe', () => {
    expect(() => chave({ serie: '889', nNF: '999999999' })).not.toThrow();
  });
});
