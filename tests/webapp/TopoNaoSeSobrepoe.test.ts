import * as fs from 'fs';
import * as path from 'path';

/**
 * A navegacao e o contexto dividem a mesma faixa — e nao podem se sobrepor.
 *
 * O defeito aparecia so enquanto a tela carregava, e por um motivo bobo: o
 * texto do indicador da SEFAZ dizia "Verificando SEFAZ..." antes da resposta e
 * "SEFAZ Online" depois, uma diferenca de 32px numa linha que tinha 12px de
 * folga. Vinte pixels a mais, e o selo "Contador" era desenhado por cima da
 * aba "Auditoria".
 *
 * O que transformava 20px de excesso em texto por cima de texto e uma regra do
 * flexbox que quase ninguem lembra: quando um container `justify-content:
 * flex-end` transborda, o excedente sai pela ESQUERDA, nao pela direita. Ou
 * seja, a barra de contexto nao empurrava nada — ela subia por cima da
 * navegacao, calada.
 *
 * Estes testes prendem a estrutura que impede isso de voltar. Eles leem o
 * CSS-fonte porque o que se quer garantir e uma decisao de layout, e ela nao
 * depende de qual mensagem esta em cartaz.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

// Ancorado no inicio da linha: sem isso, `.appbar {` casa primeiro dentro de
// `.topo-fixo .appbar {`, que e outra regra — e o teste passa a conferir a
// declaracao errada.
const regra = (seletor: string) => {
  const i = painel.indexOf('\n' + seletor);
  expect(i).toBeGreaterThan(-1);
  return painel.slice(i, painel.indexOf('}', i) + 1);
};

describe('o topo nao se sobrepoe', () => {
  test('a navegacao nao encolhe, e o contexto pode ceder', () => {
    // `max-content` na navegacao: as abas nunca sao cortadas para caber.
    // `minmax(0, 1fr)` no contexto: ele absorve a sobra — o que o mantem
    // ancorado na direita — E pode ficar menor que o proprio conteudo, que e
    // de onde sai o espaco quando o texto de status cresce.
    expect(painel).toContain('grid-template-columns: max-content minmax(0, 1fr);');
    // Nao pode ser `1fr` na navegacao: assim ela fica gulosa, toma a sobra e
    // espreme o contexto ate com espaco de sobra na tela.
    expect(painel).not.toContain('grid-template-columns: minmax(max-content, 1fr)');
  });

  test('quem cede espaco e o texto de status, e so ele', () => {
    // Selos e botoes tem largura de conteudo: nao ha o que cortar neles, e
    // corta-los esconderia o ambiente (homologacao x producao), que e a
    // informacao mais cara da barra.
    expect(regra('.appbar .topbar-right {')).toContain('min-width: 0');
    expect(painel).toContain('.appbar .topbar-right > * { flex-shrink: 0; }');
    const status = regra('.appbar .sefaz-status {');
    expect(status).toContain('flex-shrink: 1');
    expect(status).toContain('text-overflow: ellipsis');
    expect(status).toContain('white-space: nowrap');
  });

  test('a barra de contexto pode encolher dentro da propria coluna', () => {
    // Sem `min-width: 0` o flex se recusa a encolher abaixo do conteudo, e a
    // coluna volta a transbordar por cima da navegacao.
    expect(regra('.appbar {')).toContain('min-width: 0');
    // Rede de seguranca: se ainda assim nao couber, os itens quebram linha em
    // vez de vazarem para a esquerda.
    expect(painel).toContain('.appbar, .appbar .topbar-right { flex-wrap: wrap; }');
  });

  test('a mensagem cortada continua inteira no title', () => {
    // Truncar sem guardar o texto integral esconderia justamente o aviso que
    // importa: "SEFAZ: aguardando senha de acesso" precisa de 255px numa fatia
    // de 99, e sem o `title` viraria "SEFAZ: aguarda..." para sempre.
    expect(painel).toContain('function sefazDiz(el, texto, classe)');
    const fn = painel.slice(painel.indexOf('function sefazDiz('));
    expect(fn.slice(0, 300)).toContain('el.title = texto');

    // E todo estado passa por ele: um `textContent` solto no meio do
    // `checkSefaz` seria um estado sem title, descoberto so quando fosse
    // cortado.
    const chk = painel.slice(painel.indexOf('async function checkSefaz()'));
    const corpo = chk.slice(0, chk.indexOf('\nasync function', 10));
    expect(corpo).not.toContain('el.textContent =');
    expect(corpo).not.toContain('definirClasses(el');
    // Seis estados: verificando, sem senha, online, revenda, offline, excecao.
    expect(corpo.match(/sefazDiz\(/g)).toHaveLength(6);
  });

  test('a navegacao rola dentro dela mesma, nunca para fora da pagina', () => {
    // Havia um `overflow: visible` acima de 721px, escrito quando a revenda
    // (quatro abas) era o caso em vista. Com as dez abas do contador ele fazia
    // a faixa transbordar para fora do documento, e a PAGINA inteira ganhava
    // rolagem lateral — a mesma que ja tinha sido reclamada uma vez.
    expect(painel).not.toMatch(/\.tab-bar \{ overflow: visible; \}/);
    expect(painel).toContain('overflow-x: auto');
  });

  test('abaixo de 1440 as duas faixas empilham, em vez de se espremerem', () => {
    // 1105px de abas mais 440 de contexto nao cabem em 1366 nem em 1280. O
    // corte antigo era 720px — largura de telefone —, e por isso nada
    // acontecia justamente nos notebooks onde o problema aparecia.
    expect(painel).toContain('@media (max-width: 1440px) {');
    const bloco = painel.slice(painel.indexOf('@media (max-width: 1440px) {'));
    expect(bloco.slice(0, 400)).toContain("grid-template-areas: 'nav' 'contexto' 'sub';");
  });
});
