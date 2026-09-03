import * as fs from 'fs';
import * as path from 'path';
import { comPadrao, CAMPOS_DO_PADRAO, SEM_PADROES } from '../../src/webapp/padroes-plataforma';

/**
 * Suporte e paginas legais sao quase sempre OS MESMOS em todos os clientes.
 *
 * O atendimento e o seu, o site e o seu, os termos sao os seus. Sem um padrao,
 * cada cliente novo exigia redigitar seis campos — e quem esquecia um entregava
 * uma plataforma com a aba de Suporte pela metade.
 *
 * A regra que nao pode inverter: o padrao NUNCA sobrescreve o cliente. Um
 * cliente com suporte proprio existe (revenda dentro da revenda), e sobrepor o
 * dele mandaria o cliente FINAL ligar para a pessoa errada.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

/**
 * Sem os comentarios do codigo.
 *
 * Um teste que procura a AUSENCIA de um trecho acusa a propria documentacao do
 * conserto: o comentario cita o que saiu justamente para explicar por que saiu.
 * Aconteceu tres vezes hoje.
 */
const semComentarios = (t: string) => t.replace(/\/\/[^\n]*/g, '');

const padroes = {
  ...SEM_PADROES,
  suporteEmail: 'suporte@ponte.com', suporteTelefone: '3833334444',
  suporteWhatsapp: '38999998888', suporteSite: 'https://ponte.com',
  termosUrl: 'https://ponte.com/termos', privacidadeUrl: 'https://ponte.com/privacidade',
};

describe('padroes da plataforma', () => {
  test('o padrao preenche o que o cliente deixou vazio', () => {
    const r = comPadrao({ suporteEmail: '', suporteSite: '' }, padroes);
    expect(r.suporteEmail).toBe('suporte@ponte.com');
    expect(r.suporteSite).toBe('https://ponte.com');
  });

  test('o padrao NUNCA sobrescreve o que o cliente tem', () => {
    // Um cliente com suporte proprio existe. Sobrepor mandaria o cliente final
    // ligar para a pessoa errada — o pior erro possivel numa tela de suporte.
    const r = comPadrao({ suporteEmail: 'dele@cliente.com' }, padroes);
    expect(r.suporteEmail).toBe('dele@cliente.com');
  });

  test('campo com espaco conta como vazio', () => {
    // Para quem le a tela, um espaco e vazio. Sem `trim`, ele venceria o padrao
    // e entregaria um contato em branco que parece configurado.
    expect(comPadrao({ suporteEmail: '   ' }, padroes).suporteEmail).toBe('suporte@ponte.com');
  });

  test('campo fora da lista nao e tocado', () => {
    const r = comPadrao({ corPrimaria: '#000', suporteEmail: '' }, padroes);
    expect(r.corPrimaria).toBe('#000');
  });

  test('apagar um padrao REMOVE a chave, em vez de gravar vazio', () => {
    // String vazia gravada continuaria "existindo" e venceria o `||` de quem
    // le, entregando um padrao em branco com cara de configurado.
    const fonte = ler('src', 'webapp', 'padroes-plataforma.ts');
    const fn = fonte.slice(fonte.indexOf('export async function gravarPadroes('));
    expect(fn.slice(0, 900)).toContain('DELETE FROM webapp_config WHERE chave = $1');
  });

  test('a heranca acontece na GERACAO do manifest, nao na tela', () => {
    // Aplicar na tela gravaria o valor herdado no cadastro do cliente — e
    // trocar o padrao depois nao alcancaria mais ninguem.
    const app = ler('src', 'webapp', 'app.ts');
    const fn = app.slice(app.indexOf('async function montarManifestDoCliente('));
    expect(fn.slice(0, 3000)).toContain('comPadrao(');
    expect(fn.slice(0, 3000)).toContain('lerPadroes(');
  });

  test('a aba existe no painel, com os seis campos', () => {
    const painel = ler('src', 'webapp', 'public', 'index.html');
    expect(painel).toContain("{ id: 'clientesapi-padroes', label: 'Padrões' }");
    expect(painel).toContain('id="tab-clientesapi-padroes"');
    for (const id of ['padEmail', 'padWhats', 'padFone', 'padSite', 'padTermos', 'padPriv']) {
      expect(painel).toContain(`id="${id}"`);
    }
    // E salvar confere a resposta — a familia de defeito mais repetida aqui.
    const fn = painel.slice(painel.indexOf('async function salvarPadroes('));
    expect(fn.slice(0, 900)).toContain('if (!r.ok)');
  });

  test('as rotas existem e exigem admin', () => {
    const app = ler('src', 'webapp', 'app.ts');
    for (const verbo of ['get', 'post']) {
      const i = app.indexOf(`app.${verbo}('/api/admin/padroes-plataforma'`);
      expect(i).toBeGreaterThan(-1);
      expect(app.slice(i, i + 200)).toContain('requireAdmin');
    }
  });

  test('a lista de campos e a mesma dos dois lados', () => {
    expect([...CAMPOS_DO_PADRAO].sort()).toEqual(Object.keys(SEM_PADROES).sort());
  });
});

/**
 * O nome do NOSSO produto nao pode aparecer na plataforma do cliente.
 *
 * O cadastro de marca nascia com `nomePlataforma: 'Emissor Fiscal'`, e esse
 * valor virava o `brandName` do manifest. Resultado: a barra lateral, o titulo
 * da aba e a tela de configuracoes do cliente mostravam o nome de um produto
 * generico no lugar do nome dele — inclusive "Nome fantasia: Emissor Fiscal",
 * que nao e nome de empresa nenhuma.
 *
 * E o tema `auto` saiu junto: ele seguia a preferencia do SISTEMA de quem
 * visita, e a plataforma do cliente mudava de cara conforme o aparelho do
 * visitante. Identidade se escolhe; nao se herda do celular alheio.
 */
describe('a plataforma fala o nome da empresa, e o tema e escolhido', () => {
  const wl = ler('src', 'webapp', 'white-label.ts');
  const painel = ler('src', 'webapp', 'public', 'index.html');

  test('o cadastro de marca nasce SEM nome de produto', () => {
    expect(wl).toContain("nomePlataforma: ''");
    expect(wl).toContain("nome_plataforma TEXT NOT NULL DEFAULT ''");
  });

  test('cadastro antigo com o nome do produto e corrigido no init', () => {
    // Sem a migracao, quem ja salvou continuaria carregando "Emissor Fiscal"
    // como se fosse o nome dele — e a correcao so valeria para cliente novo.
    expect(wl).toMatch(/UPDATE webapp_white_label SET nome_plataforma = ''\s*WHERE nome_plataforma = 'Emissor Fiscal'/);
  });

  test('o gerador cai na fantasia e depois na razao social', () => {
    const tpl = ler('src', 'webapp', 'platform-templates.ts');
    expect(tpl).toContain('data.branding.nomePlataforma || data.empresa.fantasia || data.empresa.razaoSocial');
  });

  test('so existem dois temas, e `auto` some do seletor', () => {
    expect(painel).toContain("var temas = [['light', 'Claro'], ['dark', 'Escuro']]");
    expect(painel).not.toContain("['auto', 'Automatico']");
    expect(wl).toContain("tema: 'light' | 'dark';");
  });

  test('cadastro antigo em `auto` vira claro, em vez de quebrar', () => {
    expect(wl).toMatch(/UPDATE webapp_white_label SET tema = 'light' WHERE tema = 'auto'/);
  });
});

/**
 * O que vale para TODAS as empresas mora em Padroes.
 *
 * A maioria dos clientes nao tem identidade visual definida — e quando nao tem,
 * o que deve aparecer e o padrao de quem vende, nao o cinza do modelo. Cor,
 * tema e rodape entraram por isso; atendimento e paginas legais ja estavam la.
 *
 * O que e de CADA empresa — logo, favicon, nome da plataforma, dominio —
 * continua no cadastro dela, porque nao ha padrao possivel para eles.
 */
describe('padroes cobrem a cara do sistema', () => {
  const painel = ler('src', 'webapp', 'public', 'index.html');

  test('cor, tema e rodape sao padrao', () => {
    for (const campo of ['corPrimaria', 'corSecundaria', 'corDestaque', 'corBackground',
      'corSurface', 'corTexto', 'corMuted', 'tema', 'rodape']) {
      expect(CAMPOS_DO_PADRAO).toContain(campo);
    }
  });

  test('a tela tem um campo para cada um', () => {
    for (const id of ['padCorPri', 'padCorSec', 'padCorAcc', 'padCorBg',
      'padCorSrf', 'padCorTxt', 'padCorMut', 'padTema', 'padRodape']) {
      expect(painel).toContain(`id="${id}"`);
    }
  });

  test('o seletor de tema tambem so tem claro e escuro', () => {
    const i = painel.indexOf('id="padTema"');
    const bloco = painel.slice(i, i + 240);
    expect(bloco).toContain('value="light"');
    expect(bloco).toContain('value="dark"');
    expect(bloco).not.toContain('value="auto"');
  });

  test('o cliente continua vencendo o padrao, inclusive nas cores', () => {
    const r = comPadrao({ corPrimaria: '#0f766e' }, { ...padroes, corPrimaria: '#6366f1' });
    expect(r.corPrimaria).toBe('#0f766e');
  });

  test('a auditoria virou sub-aba de Clientes', () => {
    // Ela so fala de cliente. Como aba de topo, obrigava a SAIR de Clientes
    // para ver o historico do cliente que estava aberto.
    expect(painel).toContain("{ id: 'clientesapi-audit', label: 'Auditoria' }");
    expect(painel).not.toContain("showGroup('auditoria')");
    expect(painel).not.toContain("auditoria: [{ id: 'clientesapi-audit'");
  });
});

/**
 * A marca do cliente entra no CADASTRO, nao numa tela separada.
 *
 * Sem nome e logo, o template publicado nasce generico — e quem cadastrou so
 * descobre isso ao abrir o site do cliente, depois de ja ter publicado. Abrir
 * Marca propria era um passo extra que ninguem lembrava de dar.
 *
 * O resto da identidade nao entra aqui de proposito: cores, suporte e rodape
 * vem dos Padroes, e digita-los por cliente e o trabalho que os Padroes
 * existem para evitar.
 */
describe('a marca entra no cadastro do cliente', () => {
  const painel = ler('src', 'webapp', 'public', 'index.html');
  const salvar = (() => {
    const i = painel.indexOf('async function wzSalvar(');
    return painel.slice(i, painel.indexOf('\n}\n', i));
  })();

  test('o assistente pede nome e logo', () => {
    expect(painel).toContain('id="wzMarcaNome"');
    expect(painel).toContain('id="wzLogoFile"');
    expect(painel).toContain('async function wzLerLogo(');
  });

  test('a logo passa pelo mesmo preparo do DANFE', () => {
    // O servico que desenha o DANFE nao tem `gd` e recusa PNG calado.
    // Reaproveitar o preparo garante que a imagem serve nos dois lugares.
    const fn = painel.slice(painel.indexOf('async function wzLerLogo('));
    expect(fn.slice(0, 700)).toContain('achatarAteCaber(arquivo)');
  });

  test('criar o cliente ja grava a marca', () => {
    expect(salvar).toContain("'/whitelabel'");
    expect(salvar).toContain('nomePlataforma: nomeMarca');
    // Sem nome digitado, cai na fantasia e depois na razao social — nunca no
    // nome do nosso produto.
    expect(salvar).toContain('c.nomePlataforma || c.fantasia || c.razaoSocial');
  });

  test('a mesma logo vai para o DANFE', () => {
    // Sao dois cadastros separados, e cadastrar duas vezes era o passo que todo
    // mundo esquecia: a nota saia sem logo e o motivo nunca aparecia.
    expect(salvar).toContain("'/api/danfe/marca'");
  });

  test('marca que falha AVISA, em vez de sumir', () => {
    expect(salvar).toContain('a marca nao foi salva');
  });
});

/**
 * Tres ajustes de tela que vieram de uso real.
 */
describe('ajustes da tela', () => {
  const painel = ler('src', 'webapp', 'public', 'index.html');

  test('o tema do painel tem DOIS estados, nao tres', () => {
    // "Acompanha o sistema" era um terceiro clique que devolvia ao lugar de
    // onde se saiu. Quem aperta o botao quer trocar de tema.
    expect(painel).toContain("var TEMAS = ['claro', 'escuro'];");
    expect(painel).not.toContain("'sistema', 'claro', 'escuro'");
    // E o atributo e sempre escrito: sem ele o CSS cai na media query do
    // sistema, que e justamente o modo que saiu.
    const fn = painel.slice(painel.indexOf('function aplicarTema('));
    expect(fn.slice(0, 700)).toContain("raiz.setAttribute('data-tema', escolhido)");
    expect(fn.slice(0, 700)).not.toContain('removeAttribute');
  });

  test('quem tinha o tema do sistema guardado cai no claro', () => {
    // O valor antigo continua no navegador de quem ja usava. Sem tratar, ele
    // nao casa com nenhum tema e a rotacao comeca do lugar errado.
    const fn = painel.slice(painel.indexOf('function temaGuardado('));
    expect(fn.slice(0, 400)).toContain("'claro'");
  });

  test('cada cor tem o codigo digitavel ao lado', () => {
    // Cor de marca chega por escrito ("o verde da empresa e #0F766E"), nao
    // apontada num quadrado.
    for (const id of ['padCorPri', 'padCorSec', 'padCorAcc', 'padCorBg',
      'padCorSrf', 'padCorTxt', 'padCorMut']) {
      expect(painel).toContain(`id="${id}Hex"`);
    }
    expect(painel).toContain('function corEscolhida(');
    expect(painel).toContain('function corDigitada(');
  });

  test('o quadrado so acompanha quando o codigo esta completo', () => {
    // Empurrar "#0F7" para um `input[type=color]` faz o navegador virar preto
    // em silencio — e o meio da digitacao viraria a cor gravada.
    const fn = painel.slice(painel.indexOf('function corDigitada('));
    expect(fn.slice(0, 700)).toContain('/^#[0-9a-fA-F]{6}$/');
  });

  test('o cabecalho da lista some quando uma ficha abre', () => {
    // Contadores e busca respondiam a uma pergunta que ninguem estava fazendo,
    // e empurravam a ficha para baixo da dobra.
    expect(painel).toContain('function mostrarCabecalhoDaLista(');
    // Por CLASSE, e nao por `style.display`: os blocos tem `display:flex` no
    // atributo `style`, e devolver '' apagava esse flex — os cinco cartoes
    // viravam cinco linhas empilhadas da largura da tela.
    const fn = painel.slice(painel.indexOf('function mostrarCabecalhoDaLista('));
    expect(fn.slice(0, 900)).toContain("classList.toggle('oculto-no-detalhe'");
    // Sem os comentarios: o comentario da funcao CITA `style.display` para
    // explicar por que ele saiu, e o teste acusaria a propria documentacao.
    expect(semComentarios(fn.slice(0, 900))).not.toContain('style.display');
    expect(painel).toContain('.oculto-no-detalhe { display: none !important; }');
    const abrir = painel.slice(painel.indexOf('async function abrirDetalheCliente('));
    expect(abrir.slice(0, 300)).toContain('mostrarCabecalhoDaLista(false)');
    const lista = painel.slice(painel.indexOf('async function loadClientesApi('));
    expect(lista.slice(0, 500)).toContain('mostrarCabecalhoDaLista(true)');
  });
});
