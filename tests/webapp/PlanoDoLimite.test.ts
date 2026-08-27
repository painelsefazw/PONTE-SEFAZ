import { PLAN_LIMITS, createRateLimiter } from '../../src/webapp/middleware/rate-limiter';
import { planoDe } from '../../src/webapp/planos';

/**
 * O limite de requisições é o do plano contratado.
 *
 * O middleware sempre leu `req.clientPlano` e nada nunca preencheu esse campo:
 * todo cliente caía em `free`, 10 requisições por minuto, pagasse o que
 * pagasse. Uma listagem mais dois downloads já estouravam, e o operador via
 * "limite excedido" sem ter feito nada demais.
 *
 * Estes testes fixam o contrato entre quem escreve o campo e quem o lê.
 *
 * Eles próprios já quebraram uma vez: nasceram contra a tabela antiga (free,
 * starter, business, pro, enterprise) e continuaram cravando aqueles nomes e
 * aqueles números depois que os planos viraram PRO/MAX/PREMIUM. `PLAN_LIMITS`
 * passou a não ter mais a chave `free`, e o teste morria em `undefined` — a
 * suíte acusava a mudança, não um defeito. Por isso agora tudo o que é número
 * sai de `planoDe`, e o que se afirma é a REGRA, não o valor: plano antigo
 * continua valendo, desconhecido cai no mais restrito, cada cliente conta
 * sozinho. Números mudam quando o negócio muda; regra, não.
 */

/** O piso: é onde cai quem não tem plano legível. Hoje é o PRO. */
const MAIS_RESTRITO = planoDe(undefined);

function reqFalso(over: Record<string, unknown> = {}): any {
  return { ip: '1.2.3.4', tenantCnpj: '66509026000178', isAdmin: false, ...over };
}

function resFalso(): any {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    corpo: null as any,
    req: { requestId: 'teste' },
    setHeader(k: string, v: string) { headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.corpo = b; return this; },
  };
}

/**
 * Dispara N chamadas seguidas e devolve quantas passaram.
 *
 * `await` em cada chamada, e nao um laco solto: o limitador passou a consultar
 * o contador compartilhado e virou assincrono. Sem esperar, o teste lia o
 * resultado antes de qualquer chamada terminar e via zero.
 *
 * Uma de cada vez tambem e o que faz sentido medir: em paralelo o que se estaria
 * testando e a atomicidade do contador, nao o limite do plano.
 */
async function rodar(vezes: number, plano?: string, cnpj = String(Math.random())): Promise<number> {
  // Sem pool: aqui o que se testa e a REGRA do plano, e a contagem em memoria
  // basta. A atomicidade e do Postgres e tem teste proprio.
  const limiter = createRateLimiter();
  let passaram = 0;
  for (let i = 0; i < vezes; i++) {
    const res = resFalso();
    await limiter(reqFalso({ tenantCnpj: cnpj, clientPlano: plano }), res, () => { passaram++; });
  }
  return passaram;
}

describe('o limite segue o plano contratado', () => {
  it('sem plano informado, cai no mais restrito — o lado seguro', async () => {
    expect(await rodar(MAIS_RESTRITO.requestsPerMinute + 5, undefined))
      .toBe(MAIS_RESTRITO.requestsPerMinute);
  });

  it('business libera o que business paga, e nao o piso', async () => {
    // `business` é o plano com que a Aliança está cadastrada. Ele saiu da tabela
    // quando os planos viraram PRO/MAX/PREMIUM, e é justamente por isso que este
    // caso existe: nome antigo tem de continuar chegando no limite certo.
    const business = planoDe('business');
    expect(business.id).toBe('max');
    const passaram = await rodar(business.requestsPerMinute + 5, 'business');
    expect(passaram).toBe(business.requestsPerMinute);
    expect(passaram).toBeGreaterThan(MAIS_RESTRITO.requestsPerMinute);
  });

  // Cada plano atual entrega exatamente o que a tabela promete. A lista sai de
  // PLAN_LIMITS para que um plano novo entre aqui sozinho, sem editar o teste.
  it.each(Object.keys(PLAN_LIMITS))('%s libera o que a tabela diz', async (plano) => {
    const esperado = PLAN_LIMITS[plano]!.requestsPerMinute;
    expect(await rodar(esperado + 5, plano)).toBe(esperado);
  });

  // Nome antigo não pode virar rebaixamento silencioso: o cliente segue pagando
  // o mesmo e o sistema tem de continuar entregando o mesmo.
  it.each([
    ['free', 'pro'], ['gratuito', 'pro'], ['starter', 'pro'], ['basico', 'pro'],
    ['business', 'max'], ['profissional', 'max'],
    ['enterprise', 'premium'], ['ilimitado', 'premium'],
  ])('o plano antigo %s continua valendo como %s', async (antigo, atual) => {
    expect(planoDe(antigo).id).toBe(atual);
    const esperado = PLAN_LIMITS[atual]!.requestsPerMinute;
    expect(await rodar(esperado + 5, antigo)).toBe(esperado);
  });

  it('plano desconhecido nao vira acesso livre', async () => {
    expect(await rodar(MAIS_RESTRITO.requestsPerMinute + 5, 'plano-que-nao-existe'))
      .toBe(MAIS_RESTRITO.requestsPerMinute);
  });

  it('cada cliente tem a sua contagem — um nao consome a do outro', async () => {
    const limite = planoDe('business').requestsPerMinute;
    expect(await rodar(limite, 'business', 'cnpj-a')).toBe(limite);
    expect(await rodar(limite, 'business', 'cnpj-b')).toBe(limite);
  });
});

describe('a recusa diz o que fazer', () => {
  it('informa o limite, o plano e em quantos segundos tentar de novo', async () => {
    const limiter = createRateLimiter();
    const cnpj = 'cnpj-mensagem';
    const plano = planoDe('free');
    let ultima: any = null;
    for (let i = 0; i < plano.requestsPerMinute + 5; i++) {
      const res = resFalso();
      await limiter(reqFalso({ tenantCnpj: cnpj, clientPlano: 'free' }), res, () => {});
      if (res.statusCode === 429) ultima = res;
    }
    expect(ultima).not.toBeNull();
    const msg = String(ultima.corpo?.erro ?? '');
    // O limite e o NOME do plano — quem lê tem de saber o que contratou, não só
    // que bateu num teto. E o nome mostrado é o atual (PRO), não o apelido antigo.
    expect(msg).toContain(String(plano.requestsPerMinute));
    expect(msg).toContain(plano.nome);
    expect(msg).toMatch(/\d+s/);
    // `Retry-After` é o que um integrador automatiza; a frase é para a pessoa.
    expect(ultima.headers['Retry-After']).toBeDefined();
  });
});
