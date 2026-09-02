import * as fs from 'fs';
import * as path from 'path';

/**
 * Banco fora do ar nao pode parecer "voce nao tem nada cadastrado".
 *
 * `fetch` so rejeita em falha de REDE. Um 500 do servidor chega na tela como
 * resposta normal, e o padrao do painel — `const d = await r.json()` seguido de
 * `d.clients || []` — transforma o erro em ausencia: total 0, lista vazia,
 * "Nenhum cliente cadastrado". Sao 71 leituras assim no arquivo, e nenhuma
 * mente por conta propria: todas contam fielmente o que receberam.
 *
 * Foi o que aconteceu de verdade. O projeto do Supabase sumiu, e o painel
 * respondeu com um cadastro vazio e cinco zeros — a leitura natural sendo
 * "perdi meus clientes", quando o certo era "nao consegui perguntar".
 *
 * Consertar as 71 uma a uma trocaria um numero errado por 71 mensagens
 * diferentes. A faixa resolve o que importa numa linha so: enquanto o banco
 * estiver fora, o painel inteiro para de merecer credito — e diz isso.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('banco fora do ar aparece na tela', () => {
  test('a faixa existe e nasce escondida', () => {
    expect(painel).toContain('<div id="bancoFora" class="banco-fora" style="display:none" role="alert">');
    // Fora das abas: o aviso vale para o painel inteiro, e uma aba escondida
    // nao mostraria nada.
    const faixa = painel.indexOf('<div id="bancoFora"');
    expect(painel.lastIndexOf('<div class="tab-content', faixa))
      .toBeLessThan(painel.lastIndexOf('\n</div>', faixa));
  });

  test('a checagem roda antes do login', () => {
    // A rota de diagnostico e publica de proposito — quem precisa dela e
    // justamente quem ainda nao configurou. E e antes do login que o aviso
    // vale mais: sem ele, a primeira coisa que se ve e um painel de zeros que
    // parecem dados.
    expect(painel).toContain('async function conferirBanco()');
    expect(painel).toContain("fetch('/api/diagnostico/banco')");
    const boot = painel.slice(painel.indexOf("window.addEventListener('DOMContentLoaded'"));
    expect(boot.slice(0, 200)).toContain('conferirBanco();');
  });

  test('sem conexao e gravando em arquivo sao avisos DIFERENTES', () => {
    // Confundir os dois custa caro: sem conexao a tela mostra vazio; em
    // arquivo ela mostra o que voce acabou de gravar e perde na requisicao
    // seguinte — pior, porque parece que funcionou.
    const fn = painel.slice(painel.indexOf('async function conferirBanco()'));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain("d.storage === 'file'");
    expect(corpo).toContain('gravando em arquivo, não em banco');
    expect(corpo).toContain('Sem conexão com o banco de dados');
    // O detalhe tecnico vem junto, escapado, com a causa provavel quando existe.
    expect(corpo).toContain('escapeHtml(d.erro || d.alerta');
    expect(corpo).toContain('d.provavelCausa');
  });

  test('a lista de clientes confere a resposta antes de dizer que esta vazia', () => {
    const fn = painel.slice(painel.indexOf('async function loadClientesApi('));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain('if (!dashR.ok || !listR.ok)');
    // E diz a frase que desfaz a leitura errada, em vez de so mostrar o erro.
    expect(corpo).toContain('não</b> quer dizer que você não tem clientes');
    // A guarda vem ANTES de desenhar qualquer numero.
    expect(corpo.indexOf('if (!dashR.ok || !listR.ok)'))
      .toBeLessThan(corpo.indexOf('renderClientesDashboard(dash)'));
  });
});
