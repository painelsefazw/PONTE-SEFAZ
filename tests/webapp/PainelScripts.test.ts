import * as fs from 'fs';
import * as path from 'path';

/**
 * O JavaScript do painel e compilado por ninguem.
 *
 * `src/webapp/public/index.html` tem milhares de linhas de script inline. O
 * TypeScript nao olha para elas, o Jest nao as importa e o bundler nao existe:
 * um erro de sintaxe ali chega intacto em producao e derruba o painel INTEIRO —
 * o navegador aborta o bloco no primeiro token invalido, entao um typo numa
 * funcao de webhook apaga tambem o cadastro de empresas e a emissao.
 *
 * Este teste ja teria pego pelo menos um caso real: uma insercao de codigo em
 * que `\n` dentro de uma string virou quebra de linha de verdade, partindo a
 * string ao meio. `new Function` compila sem executar — e o suficiente para
 * saber que o arquivo carrega.
 */

const HTML = path.resolve(__dirname, '../../src/webapp/public/index.html');

function blocosDeScript(html: string): string[] {
  return (html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? [])
    // Script com `src` nao tem corpo para conferir.
    .filter(b => !/<script[^>]+src=/.test(b))
    .map(b => b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
}

describe('o JavaScript do painel compila', () => {
  const html = fs.readFileSync(HTML, 'utf-8');
  const blocos = blocosDeScript(html);

  test('ha script para conferir', () => {
    // Se a extracao parar de achar os blocos, o teste passaria vazio e daria
    // uma garantia falsa — pior do que nao existir.
    expect(blocos.length).toBeGreaterThan(0);
    expect(blocos.join('').length).toBeGreaterThan(10_000);
  });

  test.each(blocos.map((b, i) => [i, b] as const))('bloco %i nao tem erro de sintaxe', (_i, bloco) => {
    // `new Function` compila e nao executa: nada de DOM, nada de rede.
    //
    // Quando falha, a mensagem do V8 nao diz a linha. Num arquivo deste tamanho
    // isso e a diferenca entre corrigir em um minuto e procurar por meia hora,
    // entao aqui a busca e feita por bisseccao: acrescenta linha a linha ate
    // parar de compilar. A primeira que quebra e a culpada — ou o comeco do
    // trecho culpado, que ja basta para achar.
    try {
      new Function(bloco);
    } catch (erro) {
      const linhas = bloco.split('\n');
      let culpada = linhas.length;
      for (let i = 1; i <= linhas.length; i++) {
        try {
          // Envolve em bloco para que funcao inacabada nao conte como erro.
          new Function(`{${linhas.slice(0, i).join('\n')}\n}`);
        } catch {
          // Linha que quebra sozinha e suspeita; funcao pela metade nao e.
          try { new Function(linhas[i - 1]!); } catch { culpada = i; break; }
        }
      }
      throw new Error(
        `Erro de sintaxe no script do painel, perto da linha ${culpada} do bloco:\n` +
        `  ${(linhas[culpada - 1] ?? '').trim().slice(0, 120)}\n` +
        `Mensagem do motor: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  });
});
