import { amarrarConsoleNaPonte } from '../../src/webapp/kit-instancia';

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
