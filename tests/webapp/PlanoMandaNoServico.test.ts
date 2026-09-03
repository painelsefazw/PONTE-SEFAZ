import * as fs from 'fs';
import * as path from 'path';

/**
 * O plano e VOLUME. Quais documentos o cliente emite e o que ele contratou.
 *
 * Este arquivo guardava a regra oposta — "o plano decide quais documentos" — e
 * ela existiu de verdade: o cartao dizia "PRO — NF-e ou NFS-e" e a legenda
 * abaixo dizia "pode marcar mais de uma", as duas na mesma tela.
 *
 * A regra caiu quando os planos viraram BETA/PRO/MAX por volume, e o codigo que
 * a aplicava ficou: `wzMotivoDeFora` continuava perguntando por
 * `plano.documentos`, um campo que o catalogo nao manda mais. A condicao nunca
 * era verdadeira, entao nada bloqueava — e "nunca bloqueia" se parece com "esta
 * tudo liberado". So aparece quando alguem le o codigo procurando outra coisa.
 *
 * O que ficou de pe, e continua testado aqui: o cadastro nasce num plano que
 * existe, NFC-e continua bloqueada pelo motivo REAL (falta o CSC), e trocar de
 * plano redesenha o passo.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

const painel = ler('src', 'webapp', 'public', 'index.html');
const planos = ler('src', 'webapp', 'planos.ts');

/** So o codigo: comentario que explica uma remocao cita o que foi removido. */
const semComentarios = (js: string) =>
  js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function corpo(nome: string): string {
  const i = painel.indexOf('function ' + nome + '(');
  if (i < 0) return '';
  const fim = painel.indexOf('\n}\n', i);
  return painel.slice(i, fim < 0 ? i + 2500 : fim + 3);
}

describe('o plano e volume, e nao lista de documentos', () => {
  test('o cadastro nasce num plano que EXISTE no catalogo', () => {
    expect(painel).toContain("plano: 'pro', servicos: ['nfe']");
    expect(painel).not.toContain("plano: 'business'");
    // E `business` continua sendo traduzido, porque cliente antigo tem ele
    // gravado no banco — o que saiu foi so o uso como padrao de tela nova.
    expect(planos).toContain("business: 'max'");
  });

  test('o catalogo nao promete documento nenhum', () => {
    // Enquanto prometia, o selo do plano e as etiquetas de servico podiam
    // discordar na mesma ficha, e o cliente recebia um sistema sem a aba que
    // pagou. Hoje a unica coisa que o plano diz e quantas por mes.
    expect(planos).toContain('limitePorServico');
    expect(planos).not.toMatch(/^\s*documentos:/m);
    expect(planos).not.toMatch(/^\s*escolheUm:/m);
    expect(semComentarios(painel)).not.toContain('plano.documentos');
    expect(semComentarios(painel)).not.toContain('plano.escolheUm');
  });

  test('a tela diz o teto de cada plano, e nao "sem teto" para todos', () => {
    // `desc` era montado a partir de `limiteNotas`, que saiu do catalogo: os
    // TRES planos passaram a exibir " — sem teto", inclusive o BETA, que para
    // em 25.
    const fn = corpo('descricaoDoPlano');
    expect(fn).toContain('limitePorServico');
    expect(fn).toContain('emissões por mês de cada serviço');
    expect(fn).toContain('Emissões sem limite');
  });

  test('NFC-e continua bloqueada pelo motivo real: falta o CSC', () => {
    // Este era o SEGUNDO motivo de um documento ficar de fora, e e o unico que
    // sobrou. Ele nao tem nada a ver com plano: a ponte ainda nao guarda o
    // token do estado, entao a nota nao sai para ninguem.
    const fn = corpo('wzMotivoDeFora');
    expect(fn).toContain('s.indisponivel');
    expect(painel).toContain("indisponivel: 'Indisponível — falta cadastro do CSC'");
  });

  test('trocar de plano nao desmarca servico contratado', () => {
    // Descer de plano limpava a marcacao. Hoje isso seria tirar do cliente algo
    // que ele contratou por causa de uma faixa de preco.
    const fn = semComentarios(corpo('wzPlano'));
    expect(fn).toContain('wzCliente.plano = id');
    expect(fn).not.toContain('wzCliente.servicos');
  });

  test('marcar servico soma, e nunca substitui', () => {
    const fn = semComentarios(corpo('wzServico'));
    expect(fn).not.toContain('escolheUm');
    expect(fn).toContain('wzCliente.servicos.indexOf(id)');
  });

  test('trocar de plano redesenha o passo inteiro', () => {
    // Muda a legenda e o cartao marcado: dois lugares da tela, e mexer em
    // classe a classe deixava um deles para tras.
    expect(painel).toContain('function wzRedesenhar(');
    expect(painel).toContain("document.getElementById('modalClienteApiContent')");
  });
});
