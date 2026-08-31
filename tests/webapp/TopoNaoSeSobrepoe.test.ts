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
  test('a quebra e decidida pelo conteudo, nao por uma largura escolhida', () => {
    // A grade obrigava a cravar num numero em que largura as duas faixas param
    // de caber — e esse numero nao existe. Ele muda com o conteudo: com uma
    // empresa selecionada o contexto ganha um seletor de 240px que nao estava
    // la enquanto a tela carregava, e a mesma janela que cabia antes nao cabe
    // depois. O corte de 1440 errava por 5px justamente na tela de 1521.
    const topo = regra('.topo-fixo {');
    expect(topo).toContain('display: flex');
    expect(topo).toContain('flex-wrap: wrap');
    expect(painel).not.toMatch(/grid-template-areas: 'nav contexto'/);
    expect(painel).not.toContain('@media (max-width: 1440px)');

    // As duas dividem a linha enquanto couberem; o contexto, sozinho na linha
    // de baixo, ocupa a largura inteira — por isso ele tambem cresce.
    expect(painel).toContain('.topo-fixo .tab-bar { flex: 1 1 auto;');
    expect(painel).toContain('.topo-fixo .appbar { flex: 1 1 auto;');
    // A sub-navegacao sempre comeca uma linha nova.
    expect(painel).toContain('.topo-fixo .sub-tab-bar { flex: 1 0 100%;');
  });

  test('o contexto nunca quebra pela metade', () => {
    // Era isto que aparecia quando faltavam 5px: o botao "Sair" sozinho numa
    // segunda linha, com o resto da barra em cima. Pior que qualquer uma das
    // duas alternativas honestas — caber, ou descer inteiro.
    expect(painel).toContain('.appbar, .appbar .topbar-right { flex-wrap: nowrap; }');
    // No telefone nao ha o que dividir: ali quebrar por dentro e o certo.
    const mobile = painel.slice(painel.lastIndexOf('@media (max-width: 640px) {'));
    expect(mobile.slice(0, 300)).toContain('flex-wrap: wrap');
  });

  test('o seletor de empresa reserva o lugar dele desde o primeiro quadro', () => {
    // `display:none` nao ocupa espaco: o topo nascia com uma linha e ganhava a
    // segunda quando o seletor chegava, meio segundo depois — a pagina inteira
    // descia 43px sozinha. Com `visibility:hidden` a altura ja nasce final.
    expect(painel).toMatch(/id="empresaSelWrap"[^>]*style="visibility:hidden"/);
    expect(painel).toContain('wrap.style.visibility = \'visible\'');
    // Largura fixa, e nao `max-width`: o lugar reservado tem de ser do mesmo
    // tamanho do que vai ocupar depois, senao o salto volta.
    expect(regra('.appbar .topbar-empresa select {')).toContain('width: 240px');
    // E quando nao houver empresa nenhuma, o lugar guardado tem de ser
    // devolvido — senao fica um vazio permanente na barra.
    expect(painel).toContain('function esconderSeletorDeEmpresa()');
    const load = painel.slice(painel.indexOf('async function loadEmpresasSelector('));
    const corpo = load.slice(0, load.indexOf('\nfunction onEmpresaChange'));
    expect(corpo.match(/esconderSeletorDeEmpresa\(\)/g)).toHaveLength(3);
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

  test('a barra de contexto pode encolher dentro da propria faixa', () => {
    // Sem `min-width: 0` o flex se recusa a encolher abaixo do conteudo, e a
    // barra volta a transbordar por cima da navegacao.
    expect(regra('.appbar {')).toContain('min-width: 0');
    expect(painel).toContain('.topo-fixo .appbar { flex: 1 1 auto; min-width: 0;');
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

  test('as dez abas cabem com folga, e nao no limite', () => {
    // Dez abas multiplicam cada pixel de recuo por vinte. Com 16px a linha
    // fechava com 5px sobrando numa tela de 1521 — e 5px de folga nao e folga,
    // e sorte. Com 12px sao 80px devolvidos, sem mudar o tamanho do texto.
    // Sem o ajudante `regra` aqui de proposito: `.tab-bar` e `.tab-bar button`
    // tem DUAS declaracoes cada uma neste arquivo — a antiga e a do design
    // system, que veio depois e vence. Buscar pelo seletor acharia a primeira,
    // que nao e a que manda.
    expect(painel).toContain('padding: 13px 12px; font-size: 12.5px');
    // Navegacao e sub-navegacao recuam igual, senao as duas fileiras de abas
    // ficam desencontradas.
    expect(painel).toContain('  padding: 0 8px;\n  gap: 2px;');
    expect(painel).toContain('border-bottom: 1px solid var(--borda); padding: 0 8px;');
  });
});
