import { contar, contarNaMemoria, limparMemoria, limparVencidas } from '../../src/webapp/middleware/contador-compartilhado';

/**
 * Contador de janela do rate limit.
 *
 * Contar em memoria dava a cada instancia serverless o seu proprio contador: o
 * teto efetivo era o do plano MULTIPLICADO pelo numero de instancias vivas, e
 * variava com o trafego. O cliente furava o limite justamente no pico, que e
 * quando o limite existe para proteger.
 *
 * A garantia real de atomicidade e do Postgres (INSERT ... ON CONFLICT DO UPDATE
 * ... RETURNING, que trava a linha). Aqui se prova o CONTRATO e, sobretudo, o
 * comportamento quando o banco NAO responde — que e onde uma decisao errada
 * derruba o produto inteiro.
 */

beforeEach(() => limparMemoria());

/** Pool que sempre falha, para exercitar a queda para memoria. */
const poolMorto = { query: () => Promise.reject(new Error('sem banco')) } as any;

describe('contagem em memoria', () => {
  test('conta dentro da janela', () => {
    expect(contarNaMemoria('a', 60_000).contador).toBe(1);
    expect(contarNaMemoria('a', 60_000).contador).toBe(2);
    expect(contarNaMemoria('a', 60_000).contador).toBe(3);
  });

  test('chaves diferentes nao se misturam', () => {
    // Um cliente consumindo a cota do outro seria pior que nao ter limite.
    contarNaMemoria('cliente-a', 60_000);
    contarNaMemoria('cliente-a', 60_000);
    expect(contarNaMemoria('cliente-b', 60_000).contador).toBe(1);
  });

  test('janela vencida recomeca do 1', () => {
    contarNaMemoria('b', 1);
    const antes = Date.now();
    while (Date.now() === antes) { /* espera o relogio virar */ }
    expect(contarNaMemoria('b', 1).contador).toBe(1);
  });

  test('devolve quando a janela reseta', () => {
    const j = contarNaMemoria('c', 60_000);
    expect(j.resetEm).toBeGreaterThan(Date.now());
  });

  test('se declara NAO compartilhada', () => {
    // Quem le precisa saber que este numero vale so para esta instancia.
    expect(contarNaMemoria('d', 60_000).compartilhado).toBe(false);
  });
});

describe('banco fora do ar', () => {
  test('cai para a memoria em vez de bloquear', () => {
    // A decisao que importa: contador e PROTECAO, nao e o produto. Bloquear
    // porque o contador esta fora do ar seria trocar "limite frouxo por alguns
    // minutos" por "ninguem emite".
    return (async () => {
      const j = await contar(poolMorto, 'sem-banco', 60_000);
      expect(j.contador).toBe(1);
      expect(j.compartilhado).toBe(false);
    })();
  });

  test('e continua contando enquanto o banco nao volta', () => {
    return (async () => {
      await contar(poolMorto, 'sem-banco-2', 60_000);
      const j = await contar(poolMorto, 'sem-banco-2', 60_000);
      expect(j.contador).toBe(2);
    })();
  });

  test('a limpeza nao estoura quando o banco esta fora', () => {
    // Ela roda dentro do cron, junto do reprocessamento de webhooks: uma
    // excecao aqui derrubaria o reenvio das entregas junto.
    return (async () => {
      expect(await limparVencidas(poolMorto)).toBe(0);
    })();
  });
});

describe('a consulta ao Postgres', () => {
  /** Pool falso que registra o SQL, sem banco de verdade. */
  function poolEspiao(linha: { contador: number; reset_em: Date }) {
    const sqls: string[] = [];
    return {
      sqls,
      pool: {
        query: (sql: string) => {
          sqls.push(sql);
          return Promise.resolve(
            /INSERT INTO webapp_rate_limit/.test(sql) ? { rows: [linha] } : { rows: [], rowCount: 0 },
          );
        },
      } as any,
    };
  }

  test('incrementa e le num comando so', () => {
    return (async () => {
      // Ler primeiro e decidir fora do banco daria a duas requisicoes
      // simultaneas a MESMA leitura — que e o defeito que este contador existe
      // para evitar.
      const { pool, sqls } = poolEspiao({ contador: 7, reset_em: new Date(Date.now() + 30_000) });
      const j = await contar(pool, 'x', 60_000);
      expect(j.contador).toBe(7);
      expect(j.compartilhado).toBe(true);

      const insert = sqls.find(s => s.includes('INSERT INTO webapp_rate_limit'))!;
      expect(insert).toMatch(/ON CONFLICT \(chave\) DO UPDATE/);
      expect(insert).toMatch(/RETURNING contador, reset_em/);
      expect(sqls.filter(s => /^\s*SELECT/i.test(s.trim()))).toEqual([]);
    })();
  });

  test('a janela vencida e decidida DENTRO do banco', () => {
    return (async () => {
      // Comparar o relogio da aplicacao com o do banco erra quando eles
      // divergem — e em serverless divergem.
      const { pool, sqls } = poolEspiao({ contador: 1, reset_em: new Date() });
      await contar(pool, 'y', 60_000);
      const insert = sqls.find(s => s.includes('INSERT INTO webapp_rate_limit'))!;
      expect(insert).toMatch(/CASE WHEN webapp_rate_limit\.reset_em <= NOW\(\)/);
    })();
  });

  test('a tabela e o indice sao criados sozinhos', () => {
    return (async () => {
      const { pool, sqls } = poolEspiao({ contador: 1, reset_em: new Date() });
      await contar(pool, 'z', 60_000);
      expect(sqls.some(s => s.includes('CREATE TABLE IF NOT EXISTS webapp_rate_limit'))).toBe(true);
      expect(sqls.some(s => s.includes('idx_rate_limit_reset'))).toBe(true);
    })();
  });
});
