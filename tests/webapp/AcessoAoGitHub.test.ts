import { classificarAcesso, escolherToken } from '../../src/webapp/kit-plataforma';
import { divergenciaDePlano } from '../../src/webapp/planos';

/**
 * "Nao publicou" tem cinco causas, e cada uma se conserta em outro lugar.
 *
 * Este teste existe por causa de uma tarde inteira gasta em cima do sintoma:
 * a variavel estava cadastrada na Vercel COM VALOR EM BRANCO, e depois o token
 * existia mas nascera com acesso a "Public repositories" e permissao nenhuma.
 * As duas situacoes produziam a mesma frase na tela, e por isso o conserto foi
 * tentado no lugar errado duas vezes.
 *
 * O que se garante aqui e que estados diferentes nunca colapsem na mesma
 * resposta — e que so um deles libere a publicacao.
 */
describe('o que o token alcanca', () => {
  it('separa variavel ausente de variavel vazia', () => {
    const ausente = classificarAcesso({ tipo: 'sem-variavel' });
    const vazia = classificarAcesso({ tipo: 'vazia' });

    expect(ausente.estado).toBe('sem-variavel');
    expect(vazia.estado).toBe('vazia');
    expect(ausente.mensagem).not.toBe(vazia.mensagem);
    // A instrucao tem de mudar junto: uma pede cadastrar, a outra pede colar o
    // valor. Dizer a mesma coisa nos dois casos e o que fez perder a tarde.
    expect(ausente.comoResolver).not.toBe(vazia.comoResolver);
  });

  it('so o acesso de escrita libera publicar', () => {
    const casos = [
      classificarAcesso({ tipo: 'sem-variavel' }),
      classificarAcesso({ tipo: 'vazia' }),
      classificarAcesso({ tipo: 'erro', status: 401 }),
      classificarAcesso({ tipo: 'erro', status: 404 }),
      classificarAcesso({ tipo: 'repositorio', podeEscrever: false }),
    ];
    for (const c of casos) expect(c.podePublicar).toBe(false);

    const ok = classificarAcesso({ tipo: 'repositorio', podeEscrever: true, branchPadrao: 'main' });
    expect(ok.podePublicar).toBe(true);
    expect(ok.estado).toBe('ok');
    expect(ok.branchPadrao).toBe('main');
  });

  it('credencial recusada nao vira "fora do escopo"', () => {
    // 401 e token invalido — trocar o escopo no GitHub nao resolve.
    expect(classificarAcesso({ tipo: 'erro', status: 401 }).estado).toBe('credencial-recusada');
  });

  it('404 e tratado como escopo, nao como repositorio inexistente', () => {
    // O GitHub devolve 404 para repositorio privado fora do escopo justamente
    // para nao revelar que ele existe. Ler isso como "nao existe" manda a pessoa
    // procurar erro de digitacao quando o problema esta na lista do token.
    const r = classificarAcesso({ tipo: 'erro', status: 404 });
    expect(r.estado).toBe('fora-do-escopo');
    expect(r.comoResolver).toContain('Only select repositories');
  });

  it('403 cai no mesmo conselho do 404', () => {
    expect(classificarAcesso({ tipo: 'erro', status: 403 }).estado).toBe('fora-do-escopo');
  });

  it('repositorio de OUTRA conta nao vira "somente leitura"', () => {
    // Este caso me enganou de verdade: o token lia o repositorio e a tela dizia
    // "so para leitura", entao o conselho mandava marcar Contents no token — o
    // que nunca resolveria. Token fine-grained nao atravessa conta, e a leitura
    // vinha de graca so porque o repositorio era PUBLICO.
    const r = classificarAcesso({
      tipo: 'repositorio',
      podeEscrever: false,
      donoDoRepositorio: 'outraconta',
      donoDoToken: 'minhaconta',
    });
    expect(r.estado).toBe('outra-conta');
    expect(r.podePublicar).toBe(false);
    expect(r.mensagem).toContain('outraconta');
    expect(r.mensagem).toContain('minhaconta');
    // O conselho tem de dizer que permissao NAO resolve.
    expect(r.comoResolver).toMatch(/nenhuma permissao resolve/i);
  });

  it('mesma conta sem escrita continua sendo questao de permissao', () => {
    const r = classificarAcesso({
      tipo: 'repositorio',
      podeEscrever: false,
      donoDoRepositorio: 'MinhaConta',
      donoDoToken: 'minhaconta',
    });
    // Maiuscula e minuscula sao a mesma conta no GitHub; tratar como contas
    // diferentes mandaria a pessoa recriar o repositorio a toa.
    expect(r.estado).toBe('somente-leitura');
  });

  it('sem saber de quem e o token, o conselho generico vale', () => {
    // A consulta de identidade pode falhar. Falhar ali nao pode virar um
    // diagnostico errado — cai no conselho que serve para o caso comum.
    expect(classificarAcesso({ tipo: 'repositorio', podeEscrever: false }).estado)
      .toBe('somente-leitura');
  });

  it('somente leitura aponta a permissao de conteudo', () => {
    const r = classificarAcesso({ tipo: 'repositorio', podeEscrever: false });
    expect(r.estado).toBe('somente-leitura');
    expect(r.comoResolver).toContain('Contents');
  });

  it('GitHub fora do ar nao vira erro de configuracao', () => {
    // Sem isto, uma queda do GitHub mandaria o operador mexer no token — e o
    // token estaria certo.
    const r = classificarAcesso({ tipo: 'erro', status: 502, mensagem: 'bad gateway' });
    expect(r.estado).toBe('indisponivel');
  });

  it('toda resposta que barra a publicacao diz o que fazer', () => {
    for (const status of [401, 404, 403]) {
      expect(classificarAcesso({ tipo: 'erro', status }).comoResolver).toBeTruthy();
    }
    expect(classificarAcesso({ tipo: 'sem-variavel' }).comoResolver).toBeTruthy();
    expect(classificarAcesso({ tipo: 'vazia' }).comoResolver).toBeTruthy();
    expect(classificarAcesso({ tipo: 'repositorio', podeEscrever: false }).comoResolver).toBeTruthy();
  });
});

/**
 * De onde sai o token de cada publicacao.
 *
 * Token fine-grained nao atravessa conta: o `GITHUB_TOKEN` do servidor serve a
 * UMA conta, e publicar num repositorio de outra pessoa seria impossivel por
 * desenho. Por isso o token pode vir colado no pedido — de uso unico, sem ficar
 * guardado em lugar nenhum.
 */
describe('qual token usar', () => {
  it('sem nenhum, nao ha o que usar', () => {
    expect(escolherToken(undefined, undefined)).toBeNull();
    expect(escolherToken('', '')).toBeNull();
    // Espaco em branco nao e token. Campo "preenchido" com espaco enganaria a
    // checagem e o GitHub responderia 401 sem explicar.
    expect(escolherToken('   ', '   ')).toBeNull();
  });

  it('sem token colado, usa o do servidor', () => {
    expect(escolherToken(undefined, 'do-servidor')).toEqual({
      token: 'do-servidor', origem: 'servidor',
    });
  });

  it('token colado VENCE o do servidor', () => {
    // Quem se deu ao trabalho de colar um e porque o do servidor nao serve para
    // aquele destino — normalmente um repositorio de outra conta.
    expect(escolherToken('colado', 'do-servidor')).toEqual({
      token: 'colado', origem: 'corpo',
    });
  });

  it('apara espacos do que foi colado', () => {
    // Copiar do GitHub costuma trazer espaco ou quebra de linha junto.
    expect(escolherToken("  colado\n ", undefined)?.token).toBe('colado');
  });

  it('o que nao e texto e ignorado', () => {
    // Corpo JSON pode trazer qualquer coisa no campo; nada disso e token.
    expect(escolherToken(123, 'do-servidor')?.origem).toBe('servidor');
    expect(escolherToken({}, 'do-servidor')?.origem).toBe('servidor');
    expect(escolherToken(null, 'do-servidor')?.origem).toBe('servidor');
  });
});

/**
 * Plano contratado x servicos ativados.
 *
 * O caso real: LIDERA no PREMIUM com apenas NF-e e NFS-e ativados. As abas da
 * plataforma nascem dos servicos ATIVADOS, entao ela receberia um sistema sem o
 * balcao — pagando por ele — e ninguem notaria ate o cliente reclamar.
 */
describe('plano e servicos batem?', () => {
  /**
   * Este bloco ja acusou divergencia entre o plano e os servicos ativados — o
   * caso real: a LIDERA no PREMIUM, descrito como "tudo com NFC-e", com apenas
   * NF-e e NFS-e ativados.
   *
   * A pergunta deixou de existir junto com o acoplamento. O plano agora e so
   * VOLUME: ele nao promete documento nenhum, entao nao ha o que divergir. O
   * que o cliente emite e exatamente o que ele contratou.
   */
  it('nao ha mais divergencia possivel: o plano nao promete documento', () => {
    expect(divergenciaDePlano('premium', ['nfe', 'nfse'])).toBeNull();
    expect(divergenciaDePlano('max', ['nfe', 'nfce', 'nfse'])).toBeNull();
    expect(divergenciaDePlano('beta', [])).toBeNull();
  });
});


/**
 * O "Testar" mentia, e a mentira era pior que o silencio.
 *
 * Ele lia `permissions.push` do repositorio, que descreve o que a CONTA
 * autenticada pode fazer ali — nao o que o TOKEN pode. Para o dono do
 * repositorio isso vem `true` mesmo com um token somente-leitura.
 *
 * Aconteceu de verdade: o teste respondeu "Token cadastrado, com acesso de
 * escrita a este repositorio" e o Publicar em seguida devolveu `Resource not
 * accessible by personal access token`. Quem confia no teste vai procurar o
 * defeito em qualquer lugar menos na permissao que o teste acabou de aprovar.
 */
describe('o teste de escrita nao pode aprovar token somente-leitura', () => {
  test('sem escrita continua sendo somente-leitura', () => {
    const v = classificarAcesso({
      tipo: 'repositorio', podeEscrever: false, escritaTestavel: true,
      donoDoRepositorio: 'dono', donoDoToken: 'dono',
    });
    expect(v.estado).toBe('somente-leitura');
    expect(v.podePublicar).toBe(false);
  });

  test('repositorio vazio nao vira "somente-leitura" por falta de sonda', () => {
    // Em repositorio vazio nao existe banco Git onde criar o blob de sonda.
    // Isso e ausencia de MEDIDA, nao ausencia de permissao — e um botao
    // chamado "Testar" nao pode escrever de verdade so para descobrir.
    const v = classificarAcesso({
      tipo: 'repositorio', podeEscrever: false, escritaTestavel: false,
      donoDoRepositorio: 'dono', donoDoToken: 'dono',
    });
    expect(v.estado).toBe('escrita-nao-testavel');
    expect(v.podePublicar).toBe(false);
    expect(v.mensagem).toMatch(/VAZIO/);
  });

  test('o conselho do repositorio vazio diz qual erro esperar', () => {
    // Sem isso, quem publica e falha nao liga uma coisa a outra.
    const v = classificarAcesso({
      tipo: 'repositorio', podeEscrever: false, escritaTestavel: false,
    });
    expect(v.comoResolver).toMatch(/Resource not accessible/);
  });

  test('escrita sondada com sucesso continua liberando a publicacao', () => {
    const v = classificarAcesso({
      tipo: 'repositorio', podeEscrever: true, escritaTestavel: true,
      donoDoRepositorio: 'dono', donoDoToken: 'dono',
    });
    expect(v.podePublicar).toBe(true);
  });

  test('conta diferente vence o caso do repositorio vazio', () => {
    // Token fine-grained nao atravessa conta: mandar publicar para descobrir
    // faria perder a viagem, e o conselho certo e outro.
    const v = classificarAcesso({
      tipo: 'repositorio', podeEscrever: false, escritaTestavel: false,
      donoDoRepositorio: 'painelsefazw', donoDoToken: 'outra',
    });
    expect(v.estado).toBe('outra-conta');
  });
});
