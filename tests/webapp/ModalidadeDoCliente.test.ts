import * as fs from 'fs';
import * as path from 'path';

/**
 * Modalidade e marca são duas perguntas, e por muito tempo foram uma coluna.
 *
 * `whiteLabelAtiva` responde "este cliente tem marca própria?" — uma pergunta
 * VISUAL. Ela vinha sendo usada para responder "este cliente recebe uma
 * plataforma?" — uma pergunta COMERCIAL. As duas coincidiam porque o mesmo
 * botão ligava as duas de uma vez.
 *
 * Divergiam em dois casos reais, e o segundo era um defeito de verdade:
 *
 * 1. O cliente de plataforma que prefere sair sob a NOSSA marca ficava
 *    arquivado como cliente de API.
 * 2. O cliente de API que pede a logo dele no DANFE virava cliente de
 *    plataforma **sozinho**: salvar a marca chamava `whiteLabelAtiva: true`,
 *    e a partir dali ele aparecia nas listas de plataforma, com senha de
 *    painel e botão de publicar um repositório que nunca existiu.
 *
 * Estes testes prendem a separação. Eles leem o código-fonte em vez de subir
 * um banco porque o que se quer garantir é estrutural: que a coluna exista,
 * que o cadastro a envie, que a tela filtre por ela — e que ninguém volte a
 * usar a marca como se fosse a modalidade.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8');

const store = ler('src', 'webapp', 'api-clients.ts');
const app = ler('src', 'webapp', 'app.ts');
const painel = ler('src', 'webapp', 'public', 'index.html');

describe('modalidade do cliente e coluna propria', () => {
  test('existe no tipo e no banco, com `api` como padrao', () => {
    // `api` é o padrão seguro: cria credencial e mais nada. Prometer
    // plataforma a quem não comprou custa trabalho de graça; deixar de
    // prometer a quem comprou aparece na hora, porque o cliente cobra.
    expect(store).toContain("export type ModalidadeCliente = 'api' | 'plataforma'");
    expect(store).toContain('modalidade: ModalidadeCliente;');
    expect(store).toMatch(/modalidade VARCHAR\(12\) NOT NULL DEFAULT 'api'/);
  });

  test('a instalacao que ja existe ganha a coluna e o preenchimento', () => {
    // Nenhuma instalação tem psql à mão: a migração roda no `init`.
    expect(store).toMatch(/ADD COLUMN IF NOT EXISTS modalidade/);
    // O preenchimento olha PROVA de plataforma — repositório, URL publicada,
    // projeto no construtor, template. Marca própria entra por ser o único
    // sinal que a versão antiga registrava, e por isso vem por último.
    const backfill = store.slice(store.indexOf("UPDATE webapp_api_clients SET modalidade = 'plataforma'"));
    for (const prova of ['repository_url', 'plataforma_url', 'lovable_project_url',
      'template_id', 'white_label_ativa']) {
      expect(backfill.slice(0, 600)).toContain(prova);
    }
    // E não desfaz classificação feita à mão depois.
    expect(backfill.slice(0, 600)).toContain("WHERE modalidade = 'api'");
  });

  test('cada modalidade tem a sua ABA, com o seu cadastro', () => {
    // Era um seletor "todas as modalidades" no topo de uma lista só. Um
    // seletor ainda deixa as duas no mesmo lugar, e elas não respondem às
    // mesmas perguntas: em plataforma se olha publicação e versão; em API,
    // chave e último uso.
    //
    // Separadas em abas, cada uma tem o SEU botão de cadastro — e some a
    // chance de cadastrar na modalidade errada por ter clicado no botão
    // errado, que era possível quando os dois botões dividiam a mesma tela.
    expect(store).toContain('modalidade?: ModalidadeCliente;');
    expect(store).toMatch(/conditions\.push\(`c\.modalidade = /);
    expect(app).toMatch(/modalidade: req\.query\.modalidade === 'plataforma'/);

    expect(painel).not.toContain('clienteApiModalidadeFilter');
    for (const mod of ['api', 'plataforma']) {
      expect(painel).toContain(`id="tab-clientesapi-${mod}"`);
      expect(painel).toContain(`id="clientesApiLista-${mod}"`);
      expect(painel).toContain(`showCadastroClienteApi('${mod}')`);
    }
    expect(painel).toContain("{ id: 'clientesapi-api', label: 'Por API' }");
    expect(painel).toContain("{ id: 'clientesapi-plataforma', label: 'Com plataforma' }");
    // A aba aberta É a modalidade — a busca vai sempre presa a ela.
    expect(painel).toMatch(/_modalidadeAtiva = 'api'/);
    expect(painel).toMatch(/_modalidadeAtiva = 'plataforma'/);
    expect(painel).toMatch(/qs = '\?limite=50&modalidade=' \+ _modalidadeAtiva/);
  });

  test('os contadores de cada aba sao DAQUELA modalidade', () => {
    // Dizer "2 ativos" na aba "Por API" quando um deles é de plataforma é uma
    // conta errada exibida com confiança. O servidor devolve o recorte por
    // modalidade justamente para isso.
    expect(store).toMatch(/COUNT\(\*\) FILTER \(WHERE modalidade = 'api'\)/);
    expect(store).toMatch(/COUNT\(\*\) FILTER \(WHERE modalidade = 'plataforma'\)/);
    expect(store).toContain('porModalidade');
    expect(store).toMatch(/GROUP BY modalidade/);
    const render = painel.slice(painel.indexOf('function renderClientesDashboard('));
    const corpo = render.slice(0, render.indexOf('\n}'));
    expect(corpo).toContain('d.porModalidade');
    expect(corpo).toContain('_modalidadeAtiva');
  });

  test('o cadastro grava a modalidade escolhida no botao', () => {
    // Os dois botões já existiam; o que a escolha deles produzia era só
    // `whiteLabelAtiva`. Agora ela viaja como ela mesma.
    expect(painel).toMatch(/modalidade: c\.modalidade === 'plataforma' \? 'plataforma' : 'api'/);
    expect(store).toContain('modalidade?: ModalidadeCliente;');
  });

  test('salvar a marca NAO muda mais a modalidade', () => {
    // Este era o defeito. A rota continua ligando a marca — que é o trabalho
    // dela — mas a modalidade virou coluna própria e ninguém a muda pelas
    // costas.
    // A rota inteira, e não até o primeiro `});` — esse fecha o objeto do
    // `store.salvar`, bem antes do que interessa.
    const rota = app.slice(app.indexOf("app.post('/api/admin/clients/:cnpj/whitelabel'"));
    const corpo = rota.slice(0, rota.indexOf("app.post('", 40));
    expect(corpo).toContain('whiteLabelAtiva: true');
    // A verificação é sobre o que a rota ESCREVE, não sobre o que ela comenta:
    // o comentário ali fala de modalidade justamente para explicar por que não
    // mexe nela.
    expect(corpo).not.toMatch(/atualizar\([^)]*modalidade/);
    expect(corpo).not.toMatch(/modalidade\s*:/);
  });

  test('a tela esconde plataforma de quem so tem API', () => {
    // Senha de um site que o cliente não tem, e botão de publicar um
    // repositório que nunca vai existir, não são só ruído: sugerem que ele
    // tem plataforma.
    expect(painel).toContain("var temPlataforma = c.modalidade === 'plataforma'");
    expect(painel).toMatch(/temPlataforma \?[\s\S]{0,400}Acesso ao painel do template/);
    expect(painel).toContain('function promoverParaPlataforma(');
    // A mudança é explícita e pergunta antes: a partir dali alguém precisa
    // publicar e manter um site.
    const promo = painel.slice(painel.indexOf('async function promoverParaPlataforma('));
    expect(promo.slice(0, 900)).toContain('confirm(');
    expect(promo.slice(0, 900)).toContain("modalidade: 'plataforma'");
  });

  test('a lista mostra os dois selos, e eles sao diferentes', () => {
    // Um cliente de API pode ter marca própria (a logo dele no DANFE) sem ter
    // plataforma nenhuma. Um selo só não conseguiria dizer isso.
    expect(painel).toContain('function seloModalidade(');
    const linha = painel.slice(painel.indexOf('seloModalidade(c.modalidade)'));
    expect(linha.slice(0, 400)).toContain('whiteLabelAtiva');
  });
});
