import { amarrarConsoleNaPonte } from '../../src/webapp/kit-instancia';
import { lerModeloDaPasta } from '../../src/webapp/kit-plataforma';

/**
 * O console sai sabendo de qual ponte ele e.
 *
 * Sem isso ele nasce generico e quem instala digita o endereco a mao — e
 * digitar endereco a mao foi, nesta semana, a etapa que mais quebrou
 * instalacao: um espaco perdido virou `ENOTFOUND` de um host que ninguem
 * escreveu. Aqui nao ha desculpa para pedir, porque a ponte SABE o proprio
 * endereco: ele chega em cada requisicao.
 */
describe('console amarrado na ponte que o gerou', () => {
  const comExemplo = (texto: string) =>
    new Map([['.env.example', Buffer.from(texto, 'utf8')]]);
  const ler = (m: Map<string, Buffer>) => m.get('.env.example')!.toString('utf8');

  test('preenche o endereco da ponte', () => {
    const m = amarrarConsoleNaPonte(
      comExemplo('EMISSOR_API_URL=\nEMISSOR_ADMIN_KEY=\n'), 'https://ponte-sefaz.vercel.app');
    expect(ler(m)).toContain('EMISSOR_API_URL=https://ponte-sefaz.vercel.app');
  });

  test('NAO preenche os segredos', () => {
    // Endereco e publico por definicao — e para onde os clientes apontam. Chave
    // de administrador e senha do console nao podem viajar num pacote que vai
    // para um repositorio.
    const m = amarrarConsoleNaPonte(
      comExemplo('EMISSOR_API_URL=\nEMISSOR_ADMIN_KEY=\nAPP_ACCESS_PASSWORD=\n'),
      'https://ponte-sefaz.vercel.app');
    expect(ler(m)).toContain('EMISSOR_ADMIN_KEY=\n');
    expect(ler(m)).toContain('APP_ACCESS_PASSWORD=');
    expect(ler(m)).not.toMatch(/EMISSOR_ADMIN_KEY=.+/);
  });

  test('barra no fim do endereco nao vira barra dupla nas chamadas', () => {
    const m = amarrarConsoleNaPonte(
      comExemplo('EMISSOR_API_URL=\n'), 'https://ponte-sefaz.vercel.app///');
    expect(ler(m)).toContain('EMISSOR_API_URL=https://ponte-sefaz.vercel.app\n');
  });

  test('preserva as outras linhas, inclusive comentarios', () => {
    // O `.env.example` do console explica por que cada variavel existe. Perder
    // isso deixaria quem instala sem saber o que preencher.
    const original = '# Endereco da ponte\nEMISSOR_API_URL=\n\n# A senha de admin\nEMISSOR_ADMIN_KEY=\n';
    const m = amarrarConsoleNaPonte(comExemplo(original), 'https://p.test');
    expect(ler(m)).toContain('# Endereco da ponte');
    expect(ler(m)).toContain('# A senha de admin');
  });

  test('endereco vazio deixa o arquivo intacto, em vez de gravar lixo', () => {
    const original = 'EMISSOR_API_URL=\n';
    for (const ruim of ['', '   ']) {
      const m = amarrarConsoleNaPonte(comExemplo(original), ruim);
      expect(ler(m)).toBe(original);
    }
  });

  test('pacote sem .env.example nao quebra a geracao', () => {
    // O console e lido do disco: se o exemplo faltar por qualquer motivo, o
    // resto do pacote continua valendo. Falhar aqui derrubaria a geracao
    // inteira por causa de um arquivo de documentacao.
    const m = new Map([['package.json', Buffer.from('{}', 'utf8')]]);
    expect(() => amarrarConsoleNaPonte(m, 'https://p.test')).not.toThrow();
    expect(m.has('package.json')).toBe(true);
  });

  test('nao confunde uma variavel ja preenchida', () => {
    // Regravar apagaria uma escolha de quem editou o modelo a mao.
    const m = amarrarConsoleNaPonte(
      comExemplo('EMISSOR_API_URL=https://outra.test\n'), 'https://p.test');
    expect(ler(m)).toContain('EMISSOR_API_URL=https://outra.test');
  });
});

/**
 * O que o console leva quando e publicado.
 *
 * A rota `/api/admin/console/publicar` nao empacota uma copia congelada: ela le
 * a pasta `admin-template/` do DISCO a cada chamada. E o que faz o console
 * publicado ser sempre a versao de agora — mas tambem o que faz um arquivo
 * esquecido virar um console quebrado no cliente, sem aviso.
 *
 * Estes testes leem pela mesma funcao que a rota usa, entao o que passa aqui e
 * literalmente o que sai no `.zip` e no commit.
 */
describe('o console publicado leva o front de agora', () => {
  const pacote = () => lerModeloDaPasta('admin-template', 'src/lib/admin.functions.ts');

  test('leva o padrao tipografico, que e o que unifica as duas telas', async () => {
    const arquivos = await pacote();
    const tipografia = arquivos.get('src/lib/tipografia.ts');
    expect(tipografia).toBeDefined();
    expect(tipografia!.toString('utf8')).toContain('uppercase');
  });

  test('leva a folha com a marca unificada', async () => {
    const arquivos = await pacote();
    const folha = arquivos.get('src/styles.css');
    expect(folha).toBeDefined();
    // Indigo 600 — a mesma cor que o painel da ponte usa em `--marca`.
    expect(folha!.toString('utf8')).toContain('--primary: oklch(0.511 0.262 276.9)');
  });

  test('leva as telas todas, e nao so as que alguem lembrou', async () => {
    const arquivos = await pacote();
    for (const tela of [
      'src/routes/index.tsx',
      'src/routes/_painel.dashboard.tsx',
      'src/routes/_painel.clientes.index.tsx',
      'src/routes/_painel.clientes.novo.tsx',
      'src/routes/_painel.clientes.$cnpj.tsx',
      'src/routes/_painel.configuracoes.tsx',
      'src/routes/_painel.suporte.tsx',
    ]) {
      expect(arquivos.has(tela)).toBe(true);
    }
  });

  test('NAO leva node_modules, build nem .env — o cliente instala do package.json', async () => {
    // O `.env` merece nome proprio nesta lista: ele nasce na pasta assim que
    // alguem roda o console para conferir alguma coisa, e levaria a chave de
    // administrador da ponte para dentro do repositorio do cliente.
    const arquivos = await pacote();
    const caminhos = [...arquivos.keys()];
    expect(caminhos.some((c) => c.startsWith('node_modules/'))).toBe(false);
    expect(caminhos.some((c) => c.startsWith('.output/'))).toBe(false);
    expect(caminhos.some((c) => c === '.env' || c.startsWith('.env.') && c !== '.env.example')).toBe(false);
    expect(arquivos.has('package.json')).toBe(true);
    expect(arquivos.has('.env.example')).toBe(true);
  });

  test('o pacote ja sai apontando para a ponte que o gerou', async () => {
    // Junta as duas metades: ler do disco e amarrar no endereco. E assim que a
    // rota monta o que vai para o repositorio do cliente.
    const arquivos = amarrarConsoleNaPonte(await pacote(), 'https://ponte-sefaz.vercel.app');
    const env = arquivos.get('.env.example')!.toString('utf8');
    expect(env).toContain('EMISSOR_API_URL=https://ponte-sefaz.vercel.app');
    expect(env).not.toMatch(/EMISSOR_ADMIN_KEY=.+/);
  });
});
