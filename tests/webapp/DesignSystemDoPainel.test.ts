import * as fs from 'fs';
import * as path from 'path';

/**
 * O painel da ponte e o console de clientes precisam ter a MESMA cara.
 *
 * São duas telas do mesmo produto feitas em tecnologias diferentes — o painel é
 * HTML servido direto, o console é React com Tailwind — e foi exatamente por
 * isso que elas divergiram: cada uma recebeu o visual da sua própria época. O
 * cliente não vê duas tecnologias, vê dois sistemas.
 *
 * Estes testes prendem o que faz as duas se parecerem: a mesma fonte, a mesma
 * paleta em oklch, a mesma caixa alta com acento. Nenhum deles julga se está
 * bonito — isso não se testa. Eles pegam o que acontece de verdade: alguém
 * mexe numa cor, escreve um hexadecimal solto, e seis meses depois as duas
 * telas voltaram a ser diferentes sem que ninguém tenha decidido isso.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');
const folhaDoConsole = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'admin-template', 'src', 'styles.css'), 'utf8');
const tipografia = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'admin-template', 'src', 'lib', 'tipografia.ts'), 'utf8');

describe('o painel usa o design system do console', () => {
  test('a mesma fonte, carregada da mesma origem', () => {
    expect(painel).toContain('fonts.googleapis.com/css2?family=Inter+Tight');
    expect(painel).toMatch(/font-family: 'Inter Tight'/);
    expect(folhaDoConsole).toContain('Inter Tight');
  });

  test('a paleta e a mesma, e vem em oklch', () => {
    // Não é semelhança de olho: são os mesmos valores. `--lateral` do painel é
    // o `--sidebar` do console, e a barra lateral escura é o traço que mais
    // identifica as duas telas como o mesmo produto.
    for (const cor of ['oklch(0.21 0.034 264.7)', 'oklch(0.696 0.17 162.5)']) {
      expect(painel).toContain(cor);
      expect(folhaDoConsole).toContain(cor);
    }
  });

  test('o painel tem tema escuro, como o console', () => {
    expect(painel).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  test('a barra lateral so existe onde ha largura para ela', () => {
    // Abaixo de 1024px a barra vira de novo a faixa horizontal original: 248px
    // fixos num celular comeriam metade da tela. O console faz o mesmo — lá a
    // barra vira gaveta.
    expect(painel).toMatch(/@media \(min-width: 1024px\)[\s\S]{0,900}position: fixed/);
    expect(painel).toMatch(/--largura-lateral: 248px/);
  });

  test('a caixa alta e do CSS, nunca do texto', () => {
    // Esta é a regra que salva o acento. `text-transform` transforma "Visão
    // geral" em "VISÃO GERAL" com o til; escrever "VISAO GERAL" na mão perde o
    // acento para sempre, e ninguém volta atrás depois.
    expect(painel).toMatch(/\.tab-bar button[\s\S]{0,600}text-transform: uppercase/);
    expect(tipografia).toContain('text-transform');
    expect(tipografia).toContain('uppercase');
  });

  test('os nomes oficiais escapam da caixa alta', () => {
    // "NF-e" é o nome do documento; "NF-E" não é o nome de nada. Os dois lados
    // precisam da mesma saída, senão a regra geral estraga a norma.
    expect(painel).toContain('.sem-caixa-alta');
    expect(tipografia).toContain('SEM_CAPS');
    expect(tipografia).toContain('normal-case');
  });

  test('os cartoes de numero nao carregam mais cor escrita na mao', () => {
    // `cardMini` montava o cartão com `style="...color:#10b981"` dentro do
    // HTML. Trocar a paleta obrigava a caçar cada hexadecimal, e o modo escuro
    // era impossível — fundo `#fff` fixo não escurece.
    const fn = painel.slice(painel.indexOf('function cardMini('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain('dash-card');
    expect(corpo).not.toMatch(/#[0-9a-f]{6}/i);
    expect(corpo).not.toContain('background:#fff');
  });

  test('a barra de contexto e a navegacao sao coisas separadas', () => {
    // O seletor de empresa, o estado da SEFAZ e o ambiente descrevem em nome de
    // QUEM se opera. Enfiados na coluna de navegação, não cabiam; e misturados
    // ao menu, confundiam "onde estou" com "como estou".
    const lateral = painel.slice(painel.indexOf('<div class="topbar">'),
      painel.indexOf('</div>', painel.indexOf('<div class="topbar">')));
    expect(lateral).not.toContain('empresaSelWrap');
    expect(lateral).not.toContain('sefazStatus');
    expect(painel).toContain('<div class="appbar">');
  });
});
