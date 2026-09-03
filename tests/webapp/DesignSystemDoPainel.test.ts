import * as fs from 'fs';
import * as path from 'path';

/**
 * O painel tem um sistema visual, e ele precisa continuar existindo.
 *
 * Estes testes nasceram comparando o painel com o console de clientes, quando
 * eram duas telas do mesmo produto com caras diferentes. O console saiu — o
 * painel foi refeito e tomou o lugar dele —, mas o que os testes prendem
 * continua valendo, e sozinho: cor que só sai de token, caixa alta que vem do
 * CSS (para o acento sobreviver), os três papéis de cada cor de sentido, e o
 * tema escuro fechando.
 *
 * Nenhum deles julga se está bonito — isso não se testa. Eles pegam o que
 * acontece de verdade: alguém escreve um hexadecimal solto no meio de uma
 * regra, e seis meses depois metade da tela não acompanha mais o tema.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');
describe('o painel tem um sistema visual', () => {
  test('a fonte vem declarada, e nao herdada do sistema', () => {
    expect(painel).toContain('fonts.googleapis.com/css2?family=Inter+Tight');
    expect(painel).toMatch(/font-family: 'Inter Tight'/);
  });

  test('a marca tem um valor so, e ele e token', () => {
    // Indigo 600. Uma cor de marca escrita em cinco lugares vira cinco cores
    // diferentes no primeiro ajuste.
    expect(painel).toContain('--marca: #4f46e5');
  });

  test('cada cor de sentido tem fundo, borda e tinta — nos dois temas', () => {
    // Esta e a regra que faz o tema escuro fechar. Um aviso nao e "amarelo": e
    // um fundo tingido, um contorno e uma cor de TEXTO que se le sobre aquele
    // fundo. Sem os tres papeis separados, inverter o tema poe texto escuro
    // sobre fundo escuro — que foi exatamente como a tela quebrou.
    for (const familia of ['sucesso', 'alerta', 'perigo', 'info']) {
      for (const papel of ['fundo', 'borda', 'tinta']) {
        expect(painel).toContain(`--${familia}-${papel}:`);
      }
    }
    // E os tres precisam ser REDEFINIDOS no escuro, nao herdados.
    const escuro = painel.slice(painel.indexOf('[data-tema="escuro"]'));
    for (const papel of ['--alerta-fundo', '--alerta-tinta', '--perigo-fundo', '--perigo-tinta']) {
      expect(escuro).toContain(papel);
    }
  });

  test('o painel tem tema escuro, como o console', () => {
    expect(painel).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  test('nao ha barra lateral, e nao ha cabecalho', () => {
    // Os dois foram tentados e os dois sairam a pedido: a barra lateral comia
    // largura de uma tela que e cheia de tabela larga, e o cabecalho gastava
    // uma faixa inteira para repetir o nome do sistema em que a pessoa acabou
    // de entrar. A navegacao e horizontal e o contexto mora ao lado dela.
    expect(painel).not.toContain('--largura-lateral');
    expect(painel).toMatch(/\.topbar \{ display: none/);
    expect(painel).toContain('<div class="appbar">');
  });

  test('o topo e um bloco so, e ele gruda ao rolar', () => {
    // Soltas, as tres faixas rolavam em tempos diferentes: bastavam 30px de
    // rolagem para a navegacao sair de cena e sobrar uma tira clara no alto —
    // lida, com razao, como "um cabecalho que sobrou". Grudando o bloco
    // inteiro, a tira some e a navegacao continua ao alcance.
    expect(painel).toContain('<div class="topo-fixo">');
    expect(painel).toMatch(/\.topo-fixo \{[^}]*position: sticky/);
    expect(painel).toMatch(/\.topo-fixo \{[^}]*top: 0/);
    // As tres faixas precisam estar DENTRO dele, nesta ordem.
    const topo = painel.slice(painel.indexOf('<div class="topo-fixo">'),
      painel.indexOf('</div><!-- /topo-fixo -->'));
    expect(topo.indexOf('id="mainTabBar"')).toBeGreaterThan(-1);
    expect(topo.indexOf('class="appbar"')).toBeGreaterThan(topo.indexOf('id="mainTabBar"'));
    expect(topo.indexOf('id="subTabBar"')).toBeGreaterThan(topo.indexOf('class="appbar"'));
  });

  test('ha um botao de tema, e ele lembra a escolha', () => {
    // Tres estados, nao dois: claro, escuro e "o que o sistema disser" — este
    // ultimo e o padrao. E a escolha sobrevive ao F5: um botao de tema que
    // esquece a cada visita irrita mais do que ajuda.
    expect(painel).toContain('id="btnTema"');
    expect(painel).toContain('function alternarTema()');
    expect(painel).toMatch(/localStorage\.setItem\('nfe_tema'/);
    expect(painel).toMatch(/:root\[data-tema="claro"\]/);
    expect(painel).toMatch(/:root:not\(\[data-tema="claro"\]\)/);
  });

  test('o rodape assina o sistema', () => {
    expect(painel).toMatch(/Desenvolvido por Wemerson &copy; 2026/);
  });

  test('o nome do sistema e Ponte SEFAZ', () => {
    expect(painel).toContain('<title>Ponte SEFAZ</title>');
    expect(painel).not.toContain('NF-e Engine');
  });

  test('o texto visivel tem acento — e so ele', () => {
    // O painel foi escrito sem acento nenhum, provavelmente para nao brigar com
    // codificacao: um problema real ha vinte anos, e nenhum hoje.
    //
    // O risco de corrigir nao era a gramatica: era trocar um NOME. `descricao`
    // e rotulo na tela E chave que vai e volta da API; `municipio` e rotulo e
    // campo do XML da NF-e. Por isso a correcao so tocou o que fica ENTRE as
    // tags e nos atributos que o usuario le.
    for (const palavra of ['Operação', 'Número', 'Destinatário', 'Município',
      'Série', 'Não', 'Serviço', 'Código', 'Endereço', 'Emissão']) {
      expect(painel).toContain(palavra);
    }

    // A outra metade da regra, e a que protege a emissao: nenhum `value=`
    // ganhou acento. O que o formulario ENVIA continua sendo o que sempre foi.
    const comAcento = painel.match(/value="[^"]*[çáéíóúãõâêôàü][^"]*"/gi) ?? [];
    expect(comAcento).toEqual([]);
  });

  test('a caixa alta e do CSS, nunca do texto', () => {
    // Esta é a regra que salva o acento. `text-transform` transforma "Visão
    // geral" em "VISÃO GERAL" com o til; escrever "VISAO GERAL" na mão perde o
    // acento para sempre, e ninguém volta atrás depois.
    expect(painel).toMatch(/\.tab-bar button[\s\S]{0,600}text-transform: uppercase/);
  });

  test('os nomes oficiais escapam da caixa alta', () => {
    // "NF-e" é o nome do documento; "NF-E" não é o nome de nada. Os dois lados
    // precisam da mesma saída, senão a regra geral estraga a norma.
    expect(painel).toContain('.sem-caixa-alta');
  });

  test('os cartoes de numero nao carregam mais cor escrita na mao', () => {
    // Nasceu de `cardMini`, que montava o cartão com `style="...color:#10b981"`
    // dentro do HTML: trocar a paleta obrigava a caçar cada hexadecimal, e o
    // modo escuro era impossível — fundo `#fff` fixo não escurece.
    //
    // `cardMini` saiu junto com os cinco contadores do topo da lista de
    // clientes. O que resta usando `.dash-card` é o Painel do Contador, escrito
    // direto no HTML — e a regra vale igual para ele.
    expect(painel).not.toContain('function cardMini(');
    const grade = painel.slice(painel.indexOf('id="dashCards"'));
    const corpo = grade.slice(0, grade.indexOf('\n    </div>'));
    expect(corpo).toContain('dash-card');
    expect(corpo).not.toMatch(/#[0-9a-f]{6}/i);
    expect(corpo).not.toContain('style=');
  });

  test('a barra de contexto e a navegacao sao coisas separadas', () => {
    // O seletor de empresa, o estado da SEFAZ e o ambiente descrevem em nome de
    // QUEM se opera — "como estou", não "onde estou". Misturados ao menu, as
    // duas perguntas viravam uma faixa só e nenhuma se lia bem.
    const contexto = painel.slice(painel.indexOf('<div class="appbar">'),
      painel.indexOf('id="subTabBar"'));
    for (const id of ['empresaSelWrap', 'sefazStatus', 'ambientePill', 'btnTema']) {
      expect(contexto).toContain(id);
    }
    const menu = painel.slice(painel.indexOf('id="mainTabBar"'),
      painel.indexOf('<div class="appbar">'));
    expect(menu).not.toContain('sefazStatus');
  });
});
