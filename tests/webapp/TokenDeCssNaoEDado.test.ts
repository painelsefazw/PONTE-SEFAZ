import * as fs from 'fs';
import * as path from 'path';

/**
 * Token de CSS nao pode virar dado.
 *
 * A varredura que trocou cores cravadas por token do design system pegou uma
 * linha que NAO era CSS:
 *
 *     corMuted: 'var(--suave-texto)'
 *
 * dentro do corpo enviado para gravar a marca do cliente. A coluna e
 * `cor_muted VARCHAR(9)`; o token tem 18 caracteres. O Postgres recusava a
 * linha INTEIRA com "value too long", e a marca nunca era gravada.
 *
 * E ninguem via, porque a tela nao conferia a resposta: `fetch` so rejeita em
 * falha de rede, entao o 500 passava batido, o modal fechava e a ficha
 * reabria. A tela dizia que salvou. O banco tinha recusado.
 *
 * E a mesma armadilha do `ctx.fillStyle = 'var(--cartao)'` que ja foi pega no
 * canvas — a diferenca e que aquela tinha teste e esta nao tinha.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

/**
 * Os corpos de requisicao, delimitados por CHAVES BALANCEADAS.
 *
 * A primeira versao cortava no proximo `};` de dois espacos, e num corpo de
 * uma linha so isso avancava para dentro do codigo seguinte — acusando `var(--`
 * de linhas que sao `style`, legitimas. Contar chave e o unico jeito de saber
 * onde o objeto termina.
 *
 * Comentario tambem sai: a explicacao de por que NAO se usa `var(--` ali cita o
 * token, e o teste acusava justamente a linha que documenta o conserto.
 */
function corposDeRequisicao(): Array<{ inicio: number; texto: string }> {
  const achados: Array<{ inicio: number; texto: string }> = [];
  const re = /var body = \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(painel))) {
    let i = painel.indexOf('{', m.index);
    let nivel = 0;
    for (; i < painel.length; i++) {
      if (painel[i] === '{') nivel++;
      else if (painel[i] === '}') { nivel--; if (nivel === 0) break; }
    }
    const bruto = painel.slice(m.index, i + 1);
    achados.push({ inicio: m.index, texto: bruto.replace(/\/\/[^\n]*/g, '') });
  }
  return achados;
}

describe('token de CSS nao e dado', () => {
  test('nenhum corpo de requisicao carrega `var(--`', () => {
    const sujos = corposDeRequisicao()
      .filter((b) => b.texto.includes('var(--'))
      .map((b) => painel.slice(0, b.inicio).split('\n').length);
    // A linha do arquivo, para achar em um segundo se voltar a acontecer.
    expect(sujos).toEqual([]);
  });

  test('a cor secundaria da marca voltou a ser hexadecimal', () => {
    const fn = painel.slice(painel.indexOf('async function salvarWhiteLabel('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain("corMuted: '#6b7280'");
    expect(corpo).not.toContain("corMuted: 'var(");
  });

  test('salvar a marca CONFERE a resposta antes de dizer que salvou', () => {
    // Sem isto, o defeito acima ficaria invisivel de novo — e qualquer outro
    // que o banco recuse tambem.
    const fn = painel.slice(painel.indexOf('async function salvarWhiteLabel('));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain('if (!r.ok)');
    expect(corpo).toContain('A marca NAO foi salva');
    // E o `return` impede que o modal feche como se tivesse dado certo.
    expect(corpo.slice(corpo.indexOf('if (!r.ok)'), corpo.indexOf('if (!r.ok)') + 400))
      .toContain('return;');
  });

  test('o valor cabe na coluna que o recebe', () => {
    // `cor_muted VARCHAR(9)` aceita `#rrggbbaa` e nada maior. A conta e
    // trivial e foi ela que faltou.
    const store = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'webapp', 'white-label.ts'), 'utf8');
    expect(store).toContain('cor_muted VARCHAR(9)');
    expect('#6b7280'.length).toBeLessThanOrEqual(9);
    expect('var(--suave-texto)'.length).toBeGreaterThan(9);
  });
});
