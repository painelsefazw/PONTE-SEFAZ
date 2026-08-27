import { Pool } from 'pg';

/**
 * Contador de janela compartilhado entre instancias.
 *
 * O limitador contava em memoria, e em serverless cada instancia tem a sua: o
 * teto efetivo era o do plano MULTIPLICADO pelo numero de instancias vivas, e
 * variava com o trafego. Um cliente em pico furava o limite justamente quando o
 * limite existe para proteger.
 *
 * Contar no Postgres custa uma ida ao banco por requisicao (~20 ms). Num caminho
 * que espera SEGUNDOS pela SEFAZ isso e ruido — e o preco de o limite ser real.
 *
 * **Falha para a memoria, nunca para o bloqueio.** Se o banco cair, o contador
 * volta a ser por instancia: o limite fica frouxo por alguns minutos, o que e
 * muito melhor que a alternativa (ninguem emite porque o contador esta fora do
 * ar). Contador e protecao, nao e o produto.
 */

export interface Janela {
  contador: number;
  resetEm: number;
  compartilhado: boolean;
}

const memoria = new Map<string, { contador: number; resetEm: number }>();

export function contarNaMemoria(chave: string, janelaMs: number): Janela {
  const agora = Date.now();
  const atual = memoria.get(chave);
  if (!atual || agora >= atual.resetEm) {
    const nova = { contador: 1, resetEm: agora + janelaMs };
    memoria.set(chave, nova);
    return { ...nova, compartilhado: false };
  }
  atual.contador++;
  return { ...atual, compartilhado: false };
}

/** Só para os testes: a memória sobrevive entre casos dentro do mesmo processo. */
export function limparMemoria(): void {
  memoria.clear();
}

/**
 * Quais pools já têm a tabela criada.
 *
 * Por POOL, e não uma flag global: pool diferente pode ser banco diferente, e
 * uma flag única faria o segundo pular a criação e falhar em toda consulta. O
 * `WeakSet` ainda deixa o pool ser coletado quando ninguém mais o usa.
 */
const preparados = new WeakSet<Pool>();

export async function prepararTabela(pool: Pool): Promise<void> {
  if (preparados.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webapp_rate_limit (
      chave TEXT PRIMARY KEY,
      contador INTEGER NOT NULL,
      reset_em TIMESTAMPTZ NOT NULL
    )
  `);
  // A tabela cresce com chaves que ninguem vai consultar de novo (IP avulso,
  // cliente que sumiu). Sem indice a limpeza vira varredura completa.
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON webapp_rate_limit (reset_em)',
  );
  preparados.add(pool);
}

/**
 * Incrementa e devolve a contagem da janela, de forma atomica.
 *
 * Um comando so: o `ON CONFLICT DO UPDATE` trava a linha, e o `CASE` decide
 * dentro do banco se a janela venceu — ler primeiro e decidir fora daria a duas
 * requisicoes simultaneas a mesma leitura, que e o defeito que este contador
 * existe para evitar.
 */
export async function contar(pool: Pool, chave: string, janelaMs: number): Promise<Janela> {
  try {
    await prepararTabela(pool);
    const r = await pool.query(
      `INSERT INTO webapp_rate_limit (chave, contador, reset_em)
       VALUES ($1, 1, NOW() + ($2 || ' milliseconds')::interval)
       ON CONFLICT (chave) DO UPDATE SET
         contador = CASE WHEN webapp_rate_limit.reset_em <= NOW() THEN 1
                         ELSE webapp_rate_limit.contador + 1 END,
         reset_em = CASE WHEN webapp_rate_limit.reset_em <= NOW()
                         THEN NOW() + ($2 || ' milliseconds')::interval
                         ELSE webapp_rate_limit.reset_em END
       RETURNING contador, reset_em`,
      [chave, String(janelaMs)],
    );
    return {
      contador: Number(r.rows[0].contador),
      resetEm: new Date(r.rows[0].reset_em).getTime(),
      compartilhado: true,
    };
  } catch {
    return contarNaMemoria(chave, janelaMs);
  }
}

/**
 * Apaga janelas vencidas.
 *
 * Chamado pelo cron, junto do reprocessamento de webhooks — nao por
 * `setInterval`, que em serverless morre com a invocacao e, sem `unref`, ainda
 * segura o processo vivo.
 */
export async function limparVencidas(pool: Pool): Promise<number> {
  try {
    await prepararTabela(pool);
    const r = await pool.query('DELETE FROM webapp_rate_limit WHERE reset_em <= NOW()');
    return r.rowCount ?? 0;
  } catch {
    return 0;
  }
}
