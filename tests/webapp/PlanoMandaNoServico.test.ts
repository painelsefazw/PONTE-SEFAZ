import * as fs from 'fs';
import * as path from 'path';

/**
 * O plano nao e so um teto de volume — ele decide QUAIS documentos o cliente
 * emite. E a tela de cadastro ignorava isso.
 *
 * O cartao do plano dizia "PRO — NF-e ou NFS-e", e logo abaixo a pergunta
 * "Quais notas ele vai emitir?" vinha com a legenda fixa "Pode marcar mais de
 * uma". As duas frases se contradiziam na mesma tela, e a segunda ganhava: dava
 * para contratar PRO e marcar NF-e E NFS-e. A chave saia prometendo dois
 * documentos que o plano cobre um.
 *
 * Havia um segundo defeito, mais silencioso: o cadastro nascia com o plano
 * `business`, um identificador APOSENTADO. O servidor ainda o traduz para MAX
 * por compatibilidade, mas ele nao existe no catalogo — entao nenhum cartao
 * nascia marcado, e qualquer regra que dependesse do plano simplesmente nao
 * valia para quem nao clicasse num deles.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

const painel = ler('src', 'webapp', 'public', 'index.html');
const planos = ler('src', 'webapp', 'planos.ts');

describe('o plano manda na escolha de documentos', () => {
  test('o cadastro nasce num plano que EXISTE no catalogo', () => {
    expect(painel).toContain("plano: 'pro', servicos: ['nfe']");
    expect(painel).not.toContain("plano: 'business'");
    // E `business` continua sendo traduzido, porque cliente antigo tem ele
    // gravado no banco — o que saiu foi so o uso como padrao de tela nova.
    expect(planos).toContain("business: 'max'");
  });

  test('a tela sabe o que cada plano cobre', () => {
    // Sem `documentos` e `escolheUm` chegando na tela, ela nao tem como
    // obedecer ao plano — era exatamente esse o buraco.
    expect(painel).toMatch(/documentos: \['nfe', 'nfse'\], escolheUm: true/);
    expect(painel).toContain('documentos: p.documentos || []');
    expect(painel).toContain('escolheUm: !!p.escolheUm');
    expect(painel).toContain('function wzPlanoAtual(');
  });

  test('documento fora do plano fica bloqueado, dizendo por que', () => {
    // Dois motivos MUITO diferentes de um documento nao estar disponivel, e
    // dizer qual e o que evita a ligacao para o suporte: a ponte ainda nao
    // emite (NFC-e, que depende do CSC), ou o plano nao cobre.
    expect(painel).toContain('function wzMotivoDeFora(');
    const fn = painel.slice(painel.indexOf('function wzMotivoDeFora('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain('s.indisponivel');
    expect(corpo).toContain("'Não incluso no ' + plano.nome");
    expect(painel).toContain("indisponivel: 'Indisponível — falta cadastro do CSC'");
  });

  test('no plano de um documento so, marcar troca em vez de somar', () => {
    const fn = painel.slice(painel.indexOf('function wzServico('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain('plano.escolheUm');
    // Substitui a marcacao, nao acumula.
    expect(corpo).toContain("wzCliente.servicos = wzCliente.servicos.indexOf(id) >= 0 ? [] : [id]");
  });

  test('a legenda muda com o plano, em vez de mentir', () => {
    const fn = painel.slice(painel.indexOf('function wzPasso2('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain('var comoEscolher = plano && plano.escolheUm');
    expect(corpo).toContain('cobre um documento por cliente');
    expect(corpo).toContain('Pode marcar mais de uma');
    // E o titulo do plano para de falar so de volume: ele decide os documentos.
    expect(corpo).toContain('Decide quais documentos ele pode emitir');
  });

  test('descer de plano limpa o que o novo nao cobre', () => {
    // A marcacao antiga sobrevivia escondida atras de um cartao desabilitado e
    // ia para o cadastro do jeito que estava.
    const fn = painel.slice(painel.indexOf('function wzPlano('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain('plano.documentos.indexOf(sv) >= 0');
    expect(corpo).toContain('plano.escolheUm && wzCliente.servicos.length > 1');
  });

  test('trocar de plano redesenha o passo inteiro', () => {
    // Muda o que esta disponivel, muda a legenda e pode limpar marcacao: tres
    // lugares diferentes da tela, e mexer em classe a classe deixava um deles
    // para tras.
    expect(painel).toContain('function wzRedesenhar(');
    expect(painel).toContain("document.getElementById('modalClienteApiContent')");
  });
});
