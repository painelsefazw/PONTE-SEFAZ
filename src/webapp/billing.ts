/**
 * Contagem de uso mensal.
 *
 * Só isso: quantas notas a empresa emitiu no mês corrente. O plano que vale vem
 * do cadastro do cliente (`planos.ts` + `api_clients`), não daqui — enquanto as
 * duas fontes existiram em paralelo elas discordaram, e a que estava errada era
 * justamente a que barrava a emissão.
 *
 * Não há cobrança automática: plano se negocia caso a caso e quem o muda é o
 * admin, pela aba de clientes.
 */
import { PLANOS as CATALOGO, planoDe } from './planos';
import { Pool } from 'pg';

export interface Plano {
  id: string;
  nome: string;
  limiteNotas: number; // 0 = ilimitado
  descricao: string;
}

/**
 * Derivado de `planos.ts`. Esta lista existia em paralelo com a do rate limiter
 * e as duas discordavam: um cliente `business` nao existia aqui, caia no
 * fallback do gratuito e recebia limite de 10 notas por mes — emitia ate a
 * decima e parava, sem ninguem entender por que.
 *
 * Preco nao aparece em campo nenhum: e negociado caso a caso e nao pertence ao
 * codigo.
 */
export const PLANOS: Plano[] = CATALOGO.map(p => ({
  id: p.id,
  nome: p.nome,
  limiteNotas: p.limiteNotas,
  descricao: p.perfil,
}));

export class BillingStore {
  private pool: Pool;
  private initialized = false;

  constructor(poolOrUrl: Pool | string) {
    if (typeof poolOrUrl === 'string') {
      const isLocal = /localhost|127\.0\.0\.1/.test(poolOrUrl);
      this.pool = new Pool({
        connectionString: poolOrUrl,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        max: 2,
      });
    } else {
      this.pool = poolOrUrl;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_billing (
        cnpj VARCHAR(14) PRIMARY KEY,
        plano VARCHAR(20) NOT NULL DEFAULT 'free',
        notas_mes INTEGER NOT NULL DEFAULT 0,
        mes_referencia VARCHAR(7) NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    this.initialized = true;
  }

  async obterOuCriar(cnpj: string): Promise<{
    plano: string; notasMes: number; mesReferencia: string;
  }> {
    const clean = cnpj.replace(/\D/g, '');
    const mesAtual = new Date().toISOString().slice(0, 7);

    // Upsert: cria se não existir
    await this.pool.query(
      `INSERT INTO webapp_billing (cnpj, mes_referencia) VALUES ($1, $2)
       ON CONFLICT (cnpj) DO NOTHING`,
      [clean, mesAtual],
    );

    const r = await this.pool.query('SELECT * FROM webapp_billing WHERE cnpj = $1', [clean]);
    const row = r.rows[0];

    // Reset mensal: se mudou o mês, zera contador
    if (row.mes_referencia !== mesAtual) {
      await this.pool.query(
        `UPDATE webapp_billing SET notas_mes = 0, mes_referencia = $2, atualizado_em = NOW() WHERE cnpj = $1`,
        [clean, mesAtual],
      );
      row.notas_mes = 0;
      row.mes_referencia = mesAtual;
    }

    return {
      plano: row.plano,
      notasMes: row.notas_mes,
      mesReferencia: row.mes_referencia,
    };
  }

  /**
   * @param planoContratado plano vindo do cadastro do cliente. É a fonte da
   *   verdade sobre o que foi VENDIDO; `webapp_billing.plano` é resquício do
   *   checkout automático que saiu, e nasce 'free' — que resolve para PRO, 300
   *   notas/mês.
   *
   *   Enquanto esta função lia o próprio banco, todo cliente MAX ou PREMIUM
   *   parava de emitir em produção na nota 301, com 402, enquanto o painel
   *   mostrava "sem teto". Duas fontes para o mesmo fato, discordando — a mesma
   *   forma do defeito que já obrigou a consolidar os planos em `planos.ts`.
   *   Aqui a tabela de billing volta a fazer só o que sabe: contar uso.
   */
  async incrementarUso(
    cnpj: string,
    planoContratado?: string,
  ): Promise<{ permitido: boolean; usado: number; limite: number }> {
    const billing = await this.obterOuCriar(cnpj);
    // `planoDe` entende os identificadores antigos: sem isso, todo cliente ja
    // cadastrado cairia no fallback ao renomearmos os planos.
    const plano = planoDe(planoContratado ?? billing.plano);

    if (plano.limiteNotas > 0 && billing.notasMes >= plano.limiteNotas) {
      return { permitido: false, usado: billing.notasMes, limite: plano.limiteNotas };
    }

    await this.pool.query(
      `UPDATE webapp_billing SET notas_mes = notas_mes + 1, atualizado_em = NOW() WHERE cnpj = $1`,
      [cnpj.replace(/\D/g, '')],
    );

    return { permitido: true, usado: billing.notasMes + 1, limite: plano.limiteNotas };
  }

}
