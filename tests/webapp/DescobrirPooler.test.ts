import {
  classificarSonda, hostDoPooler, referenciaValida, descobrirHostDoPooler, REGIOES,
} from '../../src/webapp/pooler';

/**
 * Achar em qual pooler do Supabase o projeto vive, sem usar a senha real.
 *
 * `aws-0-us-west-2` e `aws-1-us-west-2` sao balanceadores diferentes e um
 * projeto atende em um so. Apontar para o errado devolve `password
 * authentication failed` — que parece senha errada e leva a resetar a senha.
 * Numa instalacao real custou dois resets antes de alguem desconfiar do host.
 */
describe('classificar a recusa do pooler', () => {
  test('senha recusada e a resposta BOA: prova que o tenant existe ali', () => {
    // Para recusar a senha o Supavisor precisou achar o tenant.
    expect(classificarSonda('password authentication failed for user "postgres"'))
      .toBe('tenant-aqui');
  });

  test('tenant nao encontrado significa frota errada', () => {
    expect(classificarSonda('(ENOTFOUND) tenant/user postgres.abc not found'))
      .toBe('tenant-nao-esta-aqui');
  });

  test('tenant ausente vence o ENOTFOUND na mesma mensagem', () => {
    // O driver as vezes prefixa o codigo de DNS numa mensagem que e de tenant.
    // Classificar como "host nao existe" mandaria procurar erro de digitacao
    // num host que resolveu normalmente.
    expect(classificarSonda('(ENOTFOUND) tenant or user not found'))
      .toBe('tenant-nao-esta-aqui');
  });

  test('host inexistente e caso separado, e nao "frota errada"', () => {
    expect(classificarSonda('getaddrinfo ENOTFOUND aws-9-us-west-2.pooler.supabase.com'))
      .toBe('host-nao-existe');
  });

  test('o que nao se reconhece fica inconclusivo, em vez de virar palpite', () => {
    expect(classificarSonda('connect ETIMEDOUT 10.0.0.1:6543')).toBe('inconclusivo');
    expect(classificarSonda('')).toBe('inconclusivo');
  });
});

describe('montar o host', () => {
  test('monta no formato do Supabase', () => {
    expect(hostDoPooler(0, 'us-west-2')).toBe('aws-0-us-west-2.pooler.supabase.com');
    expect(hostDoPooler(1, 'sa-east-1')).toBe('aws-1-sa-east-1.pooler.supabase.com');
  });

  test('recusa regiao fora da lista', () => {
    // A rota que usa isto e publica: o host so pode ser montado a partir da
    // lista, senao ela vira um jeito de mandar o servidor conectar em qualquer
    // lugar.
    expect(() => hostDoPooler(0, 'terra-media-1')).toThrow(/Regiao desconhecida/);
    expect(() => hostDoPooler(0, 'us-west-2.evil.test')).toThrow(/Regiao desconhecida/);
  });

  test('Sao Paulo esta na lista', () => {
    // Toda instalacao brasileira nova deveria nascer aqui.
    expect(REGIOES).toContain('sa-east-1');
  });
});

describe('a referencia do projeto', () => {
  test('aceita a referencia real e recusa o que nao e', () => {
    expect(referenciaValida('rjmspbooiwvzjkyqmdre')).toBe(true);
    expect(referenciaValida('xoazozxgpfbqqmipxbod')).toBe(true);
    expect(referenciaValida('curta')).toBe(false);
    expect(referenciaValida('COM-MAIUSCULA-E-HIFEN')).toBe(false);
    expect(referenciaValida('')).toBe(false);
  });
});

describe('descobrir o host', () => {
  const sondaFake = (respostas: Record<string, string>) =>
    async (host: string) => respostas[host] ?? 'connect ETIMEDOUT';

  test('devolve o host que reconheceu o projeto', async () => {
    const r = await descobrirHostDoPooler(
      { referencia: 'rjmspbooiwvzjkyqmdre', regiao: 'us-west-2' },
      sondaFake({
        'aws-0-us-west-2.pooler.supabase.com': 'tenant or user not found',
        'aws-1-us-west-2.pooler.supabase.com': 'password authentication failed',
      }),
    );
    expect(r.host).toBe('aws-1-us-west-2.pooler.supabase.com');
    expect(r.tentativas).toHaveLength(2);
  });

  test('para na primeira frota que reconhece, sem sondar as outras', async () => {
    const vistos: string[] = [];
    const r = await descobrirHostDoPooler(
      { referencia: 'rjmspbooiwvzjkyqmdre', regiao: 'us-west-2' },
      async (host) => { vistos.push(host); return 'password authentication failed'; },
    );
    expect(r.host).toBe('aws-0-us-west-2.pooler.supabase.com');
    expect(vistos).toHaveLength(1);
  });

  test('todas negando sugere REGIAO errada, que e a causa provavel', async () => {
    // Se nenhuma frota da regiao conhece o projeto, o numero da frota nao e o
    // problema — a regiao e.
    const r = await descobrirHostDoPooler(
      { referencia: 'rjmspbooiwvzjkyqmdre', regiao: 'eu-west-1' },
      sondaFake({
        'aws-0-eu-west-1.pooler.supabase.com': 'tenant or user not found',
        'aws-1-eu-west-1.pooler.supabase.com': 'tenant or user not found',
      }),
    );
    expect(r.host).toBeNull();
    expect(r.explicacao).toMatch(/regiao esta errada/i);
  });

  test('sonda muda nao vira conclusao', async () => {
    // Timeout nao prova ausencia. Dizer "nao esta aqui" mandaria mudar de
    // regiao por causa de uma rede lenta.
    const r = await descobrirHostDoPooler(
      { referencia: 'rjmspbooiwvzjkyqmdre', regiao: 'us-west-2' },
      sondaFake({}),
    );
    expect(r.host).toBeNull();
    expect(r.explicacao).toMatch(/nao deu para decidir/i);
  });

  test('referencia invalida para antes de sondar qualquer coisa', async () => {
    await expect(descobrirHostDoPooler(
      { referencia: 'nao-e-uma-referencia', regiao: 'us-west-2' },
      async () => { throw new Error('nao devia ter sondado'); },
    )).rejects.toThrow(/Referencia invalida/);
  });
});
