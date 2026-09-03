import * as fs from 'fs';
import * as path from 'path';

/**
 * Nenhuma gravacao do painel pode falhar calada.
 *
 * `fetch` so rejeita em falha de REDE. Um 400 ou 500 do servidor chega na tela
 * como resposta normal — e uma funcao que so tem `try/catch` segue em frente
 * como se tivesse dado certo: fecha o modal, recarrega a ficha, e o operador ve
 * o valor ANTIGO.
 *
 * Ja custou caro duas vezes hoje. A marca do cliente nunca gravou porque um
 * token de CSS estourava a coluna, e ninguem viu por meses. E o botao de status
 * podia "suspender" um cliente que continuava ativo — a leitura natural sendo
 * que o clique nao pegou, levando a clicar de novo.
 *
 * Este teste varre TODAS as funcoes que gravam e cobra que cada uma trate
 * falha: pelo `.ok` da resposta, ou lendo o `erro` do corpo (o envelope que a
 * API usa). Nao exige um formato — exige que a falha nao passe batida.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

/** O corpo de uma funcao, ate a proxima declaracao. */
function corpo(nome: string): string {
  for (const chave of [`async function ${nome}(`, `function ${nome}(`]) {
    const i = painel.indexOf(chave);
    if (i < 0) continue;
    const m = /\n(async )?function /.exec(painel.slice(i + 25));
    return painel.slice(i, i + 25 + (m ? m.index : 2500));
  }
  return '';
}

/** Quem grava: manda POST, PUT, PATCH ou DELETE. */
function funcoesQueGravam(): string[] {
  const nomes = new Set<string>();
  const re = /(?:async )?function (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(painel))) {
    const c = corpo(m[1]!);
    if (/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(c) && c.includes('apiFetch(')) {
      nomes.add(m[1]!);
    }
  }
  return [...nomes].sort();
}

/** Trata falha de algum jeito reconhecivel. */
function trataFalha(c: string): boolean {
  return /\b\w+\.ok\b/.test(c)          // confere a resposta
    || /\.status\s*===/.test(c)          // confere o codigo
    || /\b\w*\.?erro\b/.test(c);         // le o envelope de erro da API
}

describe('gravacao nao falha calada', () => {
  const gravam = funcoesQueGravam();

  test('existem funcoes de gravacao para auditar', () => {
    // Se a varredura parar de achar nada, o teste vira decoracao — e passaria
    // para sempre sem olhar coisa nenhuma.
    expect(gravam.length).toBeGreaterThan(10);
  });

  test('toda gravacao trata a falha do servidor', () => {
    const caladas = gravam.filter((f) => !trataFalha(corpo(f)));
    expect(caladas).toEqual([]);
  });

  test('o botao de status diz quando NAO alterou', () => {
    // Este era um dos dois que so tinham `catch`. Suspender um cliente que
    // continua ativo e o pior caso da familia inteira.
    const c = corpo('alterarStatusCliente');
    expect(c).toContain('if (!r.ok)');
    expect(c).toContain('O status NAO foi alterado');
    // E nao reabre a ficha como se tivesse dado certo.
    expect(c.slice(c.indexOf('if (!r.ok)'), c.indexOf('if (!r.ok)') + 300)).toContain('return;');
  });
});
