import * as fs from 'fs';
import * as path from 'path';

/**
 * Listas e cartões se leem em COLUNA, não em fila.
 *
 * Tudo era `display:flex` com `justify-content:space-between`. Numa linha só
 * isso funciona; empilhado, cada linha termina onde o texto dela acabou —
 * nome curto empurra o selo para um lugar, nome longo para outro, e a lista
 * inteira fica torta. Os selos ainda encolhiam com o próprio texto, então nem
 * dois selos vizinhos tinham a mesma largura.
 *
 * A correção é estrutural, e é a mesma nos três lugares: grade de colunas com
 * largura fixa, e selo com largura mínima. Aí a coluna da direita vira uma
 * coluna de verdade — dá para varrer status ou certificado de cima a baixo sem
 * ler o resto da linha.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');

const bloco = (marca: string, fim = '\n}') => {
  const i = painel.indexOf(marca);
  expect(i).toBeGreaterThan(-1);
  const resto = painel.slice(i);
  return resto.slice(0, resto.indexOf(fim));
};

describe('alinhamento em colunas', () => {
  test('a linha da lista de clientes e uma grade, nao um space-between', () => {
    const fn = bloco('function renderClientesLista(');
    expect(fn).toContain('display:grid');
    // Cinco colunas: logo | nome (elastico) | modalidade | marca | situacao.
    expect(fn).toMatch(/grid-template-columns:\d+px minmax\(0,1fr\) \d+px \d+px \d+px/);
    expect(fn).not.toContain('justify-content:space-between');
    // O nome corta com reticencias em vez de empurrar as colunas.
    expect(fn).toContain('text-overflow:ellipsis');
  });

  test('a logo do cliente abre a linha, e as iniciais cobrem quem nao tem', () => {
    // Numa lista de trinta linhas de texto o olho nao acha ninguem: todas sao
    // "RAZAO SOCIAL LTDA" com um CNPJ embaixo. A logo e o que faz reconhecer o
    // cliente antes de ler o nome — e e a MESMA que sai no DANFE, nao uma
    // segunda imagem para manter.
    const fn = bloco('function renderClientesLista(');
    expect(fn).toContain("'<div id=\"logoCli-' + c.empresaCnpj");
    expect(fn).toContain('iniciaisDaEmpresa(');

    // Ela chega DEPOIS da lista: base64 de trinta logos no mesmo JSON
    // transformaria a abertura da tela numa transferencia de megabytes.
    expect(painel).toContain('function carregarLogosDosClientes(');
    expect(painel).toContain('_logosDeClientes');

    // As iniciais ignoram o tipo societario — "LTDA" e "ME" aparecem em
    // metade dos cadastros e nao distinguem ninguem.
    const ini = bloco('function iniciaisDaEmpresa(');
    expect(ini).toContain("'LTDA'");
    expect(ini).toContain("'EIRELI'");
  });

  test('o estado se le pela COR do cartao, e nao por um filtro', () => {
    // Filtro esconde. Para saber quantos estavam suspensos era preciso
    // filtrar, contar e voltar — e enquanto se olhava um estado, os outros
    // nao existiam. Com a cor no proprio cartao, a lista inteira responde de
    // uma vez, e a comparacao entre estados fica gratis.
    expect(painel).not.toContain('clienteApiStatusFilter');
    const fn = bloco('function renderClientesLista(');
    expect(fn).toContain('border-left:4px solid');
    expect(fn).toContain('linear-gradient(90deg');
    expect(fn).toContain('tingir(statusColor)');

    // A cor NAO substitui o selo escrito: ela sozinha exclui quem nao
    // distingue verde de vermelho, e "Inadimplente" e "Suspenso" partilham o
    // mesmo vermelho. Ela adianta a leitura; o selo confirma.
    expect(fn).toContain('selo(statusLabel');

    // E a lista tem de vir inteira, senao a cor mostra so um pedaco.
    expect(painel).toMatch(/qs = '\?limite=200&modalidade='/);
  });

  test('a coluna vazia continua existindo', () => {
    // Quando a lista nao mistura modalidades, a coluna do selo fica vazia — e
    // fica, em vez de sumir. Sumindo, tudo o que vem depois desliza e as
    // linhas param de bater entre si.
    const fn = bloco('function renderClientesLista(');
    expect(fn).toMatch(/'<div>' \+ \(c\.modalidade && c\.modalidade !== _modalidadeAtiva/);
  });

  test('selo tem largura minima — dois textos, uma caixa', () => {
    // Ancora com a assinatura inteira: `function selo(` tambem casa com
    // `seloPlano` e `seloModalidade`, que vem antes no arquivo.
    const fn = bloco('function selo(texto, fundo, cor, titulo) {');
    expect(fn).toContain('min-width:92px');
    expect(fn).toContain('text-align:center');
    expect(fn).toContain('white-space:nowrap');
  });

  test('o cartao de empresa alinha ambiente e certificado', () => {
    const fn = bloco('function cartaoDaEmpresa(');
    expect(fn).toMatch(/grid-template-columns:minmax\(0,1fr\) \d+px \d+px/);
    // Os quatro numeros tambem: colunas iguais, e nao `flex` com `gap`.
    expect(fn).toContain('grid-template-columns:repeat(4, minmax(0, 1fr))');
    // As pilulas ocupam a coluna inteira, senao "PRODUÇÃO" e "8 DIAS" voltam a
    // ter larguras diferentes.
    const pill = fn.slice(fn.indexOf('var pill ='));
    expect(pill.slice(0, 500)).toContain('width:100%');
  });

  test('as acoes do cliente sao uma grade de larguras iguais', () => {
    // Eram doze botoes soltos num `flex-wrap`, cada um com uma cor propria. A
    // largura seguia o texto e as linhas quebravam em lugares diferentes.
    expect(painel).toContain('function acaoDoCliente(');
    const acoes = bloco("'<div style=\"margin-top:24px;padding-top:16px;border-top:1px solid var(--borda)\">'");
    expect(acoes).toContain('grid-template-columns:repeat(auto-fill, minmax(160px, 1fr))');
    // E agrupadas: mudar situacao e uma coisa, cadastro e entrega e outra.
    expect(acoes).toContain('Situação');
    expect(acoes).toContain('Cadastro e entrega');
    // Cor so onde ela informa. Com tudo colorido, o unico botao que precisa
    // gritar gritava junto com os outros onze.
    const fn = bloco('function acaoDoCliente(');
    expect(fn).toContain("tipo === 'principal'");
    expect(fn).toContain('border:1px solid var(--borda)');
    // Botao de status ocupa a coluna, senao "Ambiente de testes" fica o dobro
    // de "Ativar".
    expect(bloco('function statusBtn(')).toContain('width:100%');
  });

  test('o fundo tingido do selo voltou a existir', () => {
    // Regressao da troca de cores por token: cinco lugares faziam `cor + '15'`,
    // o truque de colar dois digitos de alfa no fim de um hexadecimal. Com
    // token, `var(--sucesso)15` e CSS invalido — o navegador descarta a regra e
    // o selo perde o fundo, virando texto colorido solto na linha.
    expect(painel).toContain('function tingir(');
    expect(painel).toContain('color-mix(in srgb, ');
    expect(painel).not.toMatch(/\+ '15;color:/);
    expect(painel).not.toMatch(/Color \+ '15'/);
  });
});
