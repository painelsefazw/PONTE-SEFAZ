import * as fs from 'fs';
import * as path from 'path';
import { dicaDaRejeicao, rejeicoesComDica } from '../../src/webapp/rejeicoes';

/**
 * A SEFAZ diz o SINTOMA. Quem opera precisa da acao.
 *
 * O caso que originou isto: a Alianca, CREDENCIADA e com IE ativa, recebeu em
 * homologacao
 *
 *     178 — CNPJ [...] do emitente nao cadastrado na Receita Federal
 *
 * Lido ao pe da letra, manda conferir a Receita Federal, onde nao ha nada
 * errado. A causa real e que a base de homologacao da SEFAZ e sintetica. Sem a
 * dica, esse cliente liga — e quem atende comeca por adivinhacao.
 *
 * As duas regras que a lista nao pode quebrar sao o assunto da metade destes
 * testes: a dica ACOMPANHA o texto oficial, e codigo desconhecido nao ganha
 * causa inventada.
 */

const app = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('rejeicao explicada', () => {
  test('o 178 aponta a base de homologacao, e nao a Receita', () => {
    const d = dicaDaRejeicao('178')!;
    expect(d).toBeTruthy();
    expect(d.causa).toMatch(/homologa/i);
    // E manda para a consulta que da a resposta definitiva, em vez de deixar
    // adivinhando.
    expect(d.comoResolver).toContain('credenciamento');
  });

  test('codigo desconhecido devolve null, em vez de inventar', () => {
    // Causa provavel errada e pior que nenhuma: manda procurar no lugar errado
    // com confianca. Foi exatamente o que o proprio xMotivo do 178 fez.
    expect(dicaDaRejeicao('99999')).toBeNull();
    expect(dicaDaRejeicao(undefined)).toBeNull();
    expect(dicaDaRejeicao('')).toBeNull();
  });

  test('toda dica diz uma acao, nao so um diagnostico', () => {
    for (const codigo of rejeicoesComDica()) {
      const d = dicaDaRejeicao(codigo)!;
      expect(d.causa.length).toBeGreaterThan(30);
      expect(d.comoResolver.length).toBeGreaterThan(30);
    }
  });

  test('a dica ACOMPANHA o xMotivo — nunca o substitui', () => {
    // A SEFAZ e a fonte. Uma dica desatualizada nao pode esconder o texto
    // oficial, entao os dois viajam juntos na mesma resposta.
    const bloco = app.slice(app.indexOf('erro: xMotivo ? `SEFAZ ${cStat}'));
    expect(bloco.slice(0, 700)).toContain('dicaDaRejeicao(cStat)');
    expect(bloco.slice(0, 700)).toContain('comoResolver');
    // O campo so aparece quando ha dica: chave vazia no JSON e ruido que o
    // integrador tem de tratar.
    expect(bloco.slice(0, 700)).toMatch(/\.\.\.\(dicaDaRejeicao\(cStat\) \?/);
  });

  test('o 656 diz a regra que ninguem descobre sozinho', () => {
    // Que cada tentativa REINICIA a hora nao esta em lugar nenhum da mensagem
    // da SEFAZ — e e a unica informacao que muda o comportamento de quem opera.
    const d = dicaDaRejeicao('656')!;
    expect(d.comoResolver).toMatch(/reinicia/i);
  });
});

describe('a ponte para de reiniciar o proprio bloqueio', () => {
  const rota = app.slice(app.indexOf("app.post('/api/nfe/distribuicao'"));
  const corpo = rota.slice(0, rota.indexOf("\napp.get('/api/nfe/distribuicao'"));

  test('o 656 fica GRAVADO, com hora de fim', () => {
    expect(corpo).toContain('store.marcarBloqueio(emp.cnpj, ambiente)');
  });

  test('dentro da janela, a ponte recusa sem chamar a SEFAZ', () => {
    // Este e o ponto: a chamada que nao acontece e o que deixa a janela correr
    // ate o fim. Antes, apertar de novo garantia que nunca liberava.
    expect(corpo).toContain('p.bloqueadoAte');
    expect(corpo).toContain('minutosRestantes');
    // A guarda vem ANTES do laco que varre a SEFAZ.
    expect(corpo.indexOf('p.bloqueadoAte')).toBeLessThan(corpo.indexOf('varrerDistribuicaoDFe'));
  });

  test('a coluna nasce sozinha nas instalacoes que ja existem', () => {
    const store = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'webapp', 'nfe-recebidas.ts'), 'utf8');
    // Nenhuma instalacao tem psql a mao: a migracao roda no `init`.
    expect(store).toContain('ADD COLUMN IF NOT EXISTS bloqueado_ate');
    expect(store).toContain('async marcarBloqueio(');
  });
});
