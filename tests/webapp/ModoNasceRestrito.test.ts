import * as fs from 'fs';
import * as path from 'path';

/**
 * O painel nasce restrito, e so ABRE quando o servidor confirma.
 *
 * O modo (revenda ou completo) vem de `/api/ping`, o que custa uma ida e volta
 * — numa funcao serverless fria, bem mais que um piscar. O `<body>` nascia sem
 * classe nenhuma e `#tab-emissao` ja vinha com `active` na marcacao, entao essa
 * espera inteira era passada mostrando as DEZ abas e o formulario de emissao:
 * telas que uma ponte de revenda nao tem.
 *
 * O efeito para quem usa: recarregava a pagina, via o sistema completo, e ele
 * encolhia sozinho um instante depois. Parecia defeito de deploy — foi
 * reportado tres vezes como "as paginas continuam aparecendo".
 *
 * A correcao inverte o erro possivel. Comecando restrito, no maximo aparece de
 * MENOS por um instante, e o servidor abre o resto quando confirma que existe.
 * O contrario — prometer e retirar — e o unico que nao se pode fazer.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('o modo do painel nasce restrito', () => {
  test('o corpo ja nasce em revenda, e esperando', () => {
    expect(painel).toContain('<body class="modo-revenda aguardando-modo">');
    // O padrao do JS acompanha o do HTML: dois padroes diferentes voltariam a
    // abrir a janela em que as abas aparecem.
    expect(painel).toContain("window.modoDoPainel = 'revenda';");
  });

  test('nenhum conteudo e pintado antes de saber o modo', () => {
    expect(painel).toContain('body.aguardando-modo .tab-content { display: none !important; }');
    // E a marcacao para de eleger uma aba: o HTML nao sabe o modo, entao nao
    // pode escolher onde entrar.
    expect(painel).not.toContain('class="tab-content active"');
    expect(painel).not.toMatch(/class="active escondido-na-revenda"/);
  });

  test('quem escolhe a aba de entrada e o modo, nos DOIS casos', () => {
    const fn = painel.slice(painel.indexOf('function aplicarModoDoPainel('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain("classList.remove('aguardando-modo')");
    expect(corpo).toContain("showGroup(window.modoDoPainel === 'revenda' ? 'clientesapi' : 'emissao')");
    // Sem `return` no meio: a instalacao completa tambem precisa ser levada
    // para a aba dela, senao ficaria na de revenda.
    expect(corpo).not.toContain("if (window.modoDoPainel !== 'revenda') return;");
  });

  test('ping que falha nao deixa a tela vazia', () => {
    // Sem `try`, um `/api/ping` que falha derrubava o bloco inteiro — e com ele
    // o login. Antes isso dava uma tela parada; agora daria uma tela VAZIA,
    // porque o conteudo espera o modo.
    const boot = painel.slice(painel.indexOf("window.addEventListener('DOMContentLoaded'"));
    const corpo = boot.slice(0, boot.indexOf('\n});'));
    expect(corpo).toContain("var ping = { modo: 'revenda', autenticacao: true };");
    expect(corpo).toMatch(/try \{[\s\S]{0,200}fetch\('\/api\/ping'\)/);
    expect(corpo).toContain('catch (e)');
  });
});
