import { proximoPasso } from '../../src/webapp/nfe-recebidas';

/**
 * A regra que decide se a varredura continua.
 *
 * Ela existe por um motivo caro: consultar a Distribuicao DF-e de novo sem
 * avancar o NSU devolve `cStat 656 — consumo indevido`, e a SEFAZ tira o CNPJ
 * do ar por UMA HORA. Nao e um limite por tela nem por chave: e por empresa.
 *
 * Um laco ingenuo produz isso sozinho — busca, nao vem nada, busca de novo com
 * o mesmo NSU, e na terceira o CNPJ esta bloqueado. Por isso a decisao saiu de
 * dentro do laco e virou funcao: e a parte que precisa estar certa.
 */
describe('quando parar de varrer a Distribuicao DF-e', () => {
  it('para na hora que a SEFAZ avisa de consumo indevido', () => {
    // 656 e o AVISO. Insistir depois dele e o que vira bloqueio.
    expect(proximoPasso({ cStat: '656', nsuAntes: 10, nsuDepois: 90, maxNsu: 900 }))
      .toBe('consumo-indevido');
  });

  it('para quando o ponteiro nao andou', () => {
    // A proxima chamada seria identica a esta — e consulta repetida com o mesmo
    // NSU e exatamente a receita do 656.
    expect(proximoPasso({ cStat: '138', nsuAntes: 50, nsuDepois: 50, maxNsu: 900 }))
      .toBe('sem-avanco');
  });

  it('trata ponteiro que retrocede como falta de avanco', () => {
    // Nao deveria acontecer, mas se acontecer o perigo e o mesmo: repetir.
    expect(proximoPasso({ cStat: '138', nsuAntes: 50, nsuDepois: 20, maxNsu: 900 }))
      .toBe('sem-avanco');
  });

  it('para ao alcancar o fim da fila', () => {
    expect(proximoPasso({ cStat: '138', nsuAntes: 800, nsuDepois: 900, maxNsu: 900 }))
      .toBe('em-dia');
    // Passar do maximo tambem e fim de fila, nao motivo para continuar.
    expect(proximoPasso({ cStat: '138', nsuAntes: 800, nsuDepois: 901, maxNsu: 900 }))
      .toBe('em-dia');
  });

  it('continua enquanto ha fila e o ponteiro anda', () => {
    expect(proximoPasso({ cStat: '138', nsuAntes: 0, nsuDepois: 50, maxNsu: 900 }))
      .toBe('continuar');
  });

  it('maxNSU zero nao e lido como "ja acabou"', () => {
    // A SEFAZ nem sempre devolve maxNSU. Interpretar a ausencia como fim de
    // fila faria a captura parar na primeira volta e nunca baixar o historico.
    expect(proximoPasso({ cStat: '138', nsuAntes: 0, nsuDepois: 50, maxNsu: 0 }))
      .toBe('continuar');
  });

  it('o 656 vence qualquer outra condicao', () => {
    // Mesmo com fila cheia e ponteiro andando: se a SEFAZ avisou, para.
    expect(proximoPasso({ cStat: '656', nsuAntes: 0, nsuDepois: 50, maxNsu: 9000 }))
      .toBe('consumo-indevido');
  });

  it('137 (nenhum documento) nao e erro, e fim de leitura', () => {
    // 137 vem com o ponteiro parado — cai em "sem-avanco", que e o certo:
    // parar sem alarme. Tratar 137 como falha assustaria por nada.
    expect(proximoPasso({ cStat: '137', nsuAntes: 900, nsuDepois: 900, maxNsu: 900 }))
      .toBe('sem-avanco');
  });
});
