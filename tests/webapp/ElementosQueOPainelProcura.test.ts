import * as fs from 'fs';
import * as path from 'path';

/**
 * Todo `getElementById` do painel precisa achar alguem.
 *
 * O painel e uma pagina so, e quando um bloco de HTML some ninguem avisa:
 * `getElementById` devolve `null`, a linha seguinte tenta `.innerHTML` nesse
 * `null`, a funcao morre ali e o clique simplesmente nao faz nada. Sem erro na
 * tela, sem log no servidor, sem teste vermelho.
 *
 * Foi exatamente o que aconteceu com o `modalClienteApi`: ao dividir a lista de
 * clientes em duas abas, o texto novo da aba "por plataforma" foi escrito por
 * cima do bloco do modal — ele ficava logo abaixo, e a substituicao pegou os
 * dois. O modal e usado por TREZE funcoes (cadastro, certificado, marca, chave,
 * logs, template, cadastro fiscal), entao meia dezena de botoes do painel parou
 * de abrir de uma vez. Passou por 1187 testes e foi para producao.
 *
 * Este teste e a rede que faltava, e ele e barato: le o arquivo, junta os IDs
 * que o codigo PROCURA e os IDs que a pagina OFERECE, e cobra que o primeiro
 * conjunto caiba no segundo.
 */

// Normalizado: no Windows o arquivo volta com CRLF depois de um `checkout`, e
// uma busca por quebra de linha crua nao acha nada no CRLF — o teste passaria
// por nao encontrar, que e o pior jeito de passar.
const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

/**
 * IDs que nascem de um ajudante, com o nome vindo por parametro — o `id="..."`
 * literal nao existe no arquivo, mas o elemento existe na tela. Cada entrada
 * diz quem o cria; se um dia o ajudante sumir, o nome dele sumindo daqui
 * denuncia.
 */
const CRIADOS_POR_AJUDANTE: Record<string, string> = {
  fIe: "fiscalCampo('fIe', ...)",
  wlPri: "wlCor('wlPri', ...)",
  wlSec: "wlCor('wlSec', ...)",
  wlAcc: "wlCor('wlAcc', ...)",
  wlBg: "wlCor('wlBg', ...)",
  wlSrf: "wlCor('wlSrf', ...)",
  wlTxt: "wlCor('wlTxt', ...)",
};

const procurados = new Set(
  [...painel.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)].map((m) => m[1]));
const oferecidos = new Set(
  [...painel.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));

// So o trecho de script: declaracoes de funcao nao existem na marcacao.
const js = painel.slice(painel.indexOf('<script>'));
const declaradas = new Set([
  ...[...js.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
  ...[...js.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)]
    .map((m) => m[1]),
  ...[...js.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
]);

describe('elementos que o painel procura', () => {
  test('todo getElementById literal encontra um id que existe', () => {
    const orfaos = [...procurados]
      .filter((id) => !oferecidos.has(id) && !(id in CRIADOS_POR_AJUDANTE))
      .sort();
    expect(orfaos).toEqual([]);
  });

  test('os ajudantes que geram id continuam existindo', () => {
    // A lista de excecoes so vale enquanto a chamada que ela descreve existir.
    for (const [id, chamada] of Object.entries(CRIADOS_POR_AJUDANTE)) {
      const ajudante = chamada.slice(0, chamada.indexOf('('));
      expect(`${id} vem de ${ajudante}: ${painel.includes(`${ajudante}('${id}'`)}`)
        .toBe(`${id} vem de ${ajudante}: true`);
    }
  });

  test('o modal do cliente existe, com as tres partes que o codigo usa', () => {
    // Nomeado porque e o mais caro de perder: treze funcoes escrevem nele, e o
    // sintoma e sempre o mesmo — o botao nao faz nada.
    for (const id of ['modalClienteApi', 'modalClienteTitulo', 'modalClienteApiContent']) {
      expect(painel).toContain(`id="${id}"`);
    }
    // Fora das abas: as abas sao trocadas por `display`, e um modal dentro de
    // uma aba escondida nao abre.
    const modal = painel.indexOf('<div id="modalClienteApi"');
    const abaAntes = painel.lastIndexOf('<div class="tab-content', modal);
    const fechaAntes = painel.lastIndexOf('\n</div>\n', modal);
    expect(fechaAntes).toBeGreaterThan(abaAntes);
  });

  test('todo botao chama uma funcao que existe', () => {
    // O mesmo defeito do modal, um andar acima: o botao "XML" da NFC-e chamava
    // `downloadXml`, que nunca existiu neste arquivo. Clicar nao fazia nada, e
    // nao havia como descobrir isso pela tela.
    const chamados = new Set<string>();
    for (const m of painel.matchAll(
      /on(?:click|change|input|submit|keydown|keyup|blur|focus)="([^"]*)"/g)) {
      for (const f of m[1].matchAll(/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        chamados.add(f[1]);
      }
    }
    const NATIVAS = new Set(['alert', 'confirm', 'prompt', 'parseInt', 'parseFloat',
      'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
      'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'if', 'return']);
    const orfas = [...chamados]
      .filter((f) => !NATIVAS.has(f) && !declaradas.has(f))
      .sort();
    expect(orfas).toEqual([]);
  });

  test('nenhuma funcao e declarada duas vezes', () => {
    // Duas funcoes com o mesmo nome nao dao erro: a ultima apaga a primeira.
    // Aconteceu com `selo` — a versao de quatro argumentos dos cartoes de
    // cliente apagou a de um argumento das sugestoes de NCM, e a lista passou a
    // mostrar "[object Object]" em cada linha, em producao.
    const nomes = [...js.matchAll(/\n(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((m) => m[1]);
    const repetidas = nomes.filter((n, i) => nomes.indexOf(n) !== i);
    expect([...new Set(repetidas)]).toEqual([]);
  });

  test('o selo do NCM tem nome proprio, e e ele que a lista usa', () => {
    expect(painel).toContain('function seloNcmJaUsado(n)');
    // As duas listas de sugestao — a do item da nota e a do cadastro de
    // produto — chamam a mesma funcao.
    expect(painel.match(/\+ seloNcmJaUsado\(n\) \+/g)).toHaveLength(2);
    expect(painel).not.toMatch(/\+ selo\(n\) \+/);
  });

  test('a NFC-e entrega os arquivos que vieram na resposta', () => {
    // A rota devolve `xml` e `danfePdf` na propria emissao. Baixar de novo pelo
    // servidor seria uma segunda ida a rede no caixa, que e onde ela falta.
    const bloco = painel.slice(painel.indexOf("'<h3>NFC-e Autorizada!</h3>"));
    const corpo = bloco.slice(0, bloco.indexOf('} else {'));
    expect(corpo).toContain('data.xml');
    expect(corpo).toContain('data.danfePdf');
    expect(corpo).toContain('linkDeArquivo(');
    expect(painel).toContain('function linkDeArquivo(');
    expect(painel).toContain('function bytesDeBase64(');
  });
});
