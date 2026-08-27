/**
 * Persistência da webapp: numeração de notas + histórico de emissões.
 *
 * - NFE_DB_URL definida  → PgStorage (Postgres): numeração atômica (multi-usuário
 *   seguro) e histórico durável — obrigatório em serverless (Vercel).
 * - NFE_DB_URL vazia     → FileStorage (JSON em output/): uso local single-user.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Pool } from 'pg';
import type { NFe } from '../domain/models';

export interface NotaRecord {
  chaveAcesso: string;
  empresaCnpj: string;
  numero: string;
  serie: string;
  ambiente: string; // '1' | '2'
  destNome: string;
  destDoc: string;
  vNF: string;
  protocolo?: string;
  dhRecbto?: string;
  cStat?: string;
  status: string; // AUTORIZADA | CANCELADA
  nfeJson?: NFe;
  xml?: string;
  emitidaEm: string; // ISO
}

/** Ambiente SEFAZ: `1` produção, `2` homologação. */
export type Ambiente = '1' | '2';

/**
 * Retrato do que um cliente emitiu. Produção e homologação vêm separados de
 * propósito: somar teste no faturamento dá número errado a quem decide com ele.
 */
export interface ResumoEmpresa {
  producao: { autorizadas: number; canceladas: number; valorTotal: string };
  homologacao: { autorizadas: number; canceladas: number };
  /** Emitidas em produção nos últimos 30 dias — o ritmo atual do cliente. */
  ultimos30Dias: number;
  /** Emitidas em produção hoje. */
  hoje: number;
  primeiraEmissao?: string;
  ultimaEmissao?: string;
  /** Séries em uso na produção, com quanto já saiu em cada. */
  series: Array<{ serie: string; quantidade: number; ultimoNumero: string }>;
}

export interface WebappStorage {
  init(): Promise<void>;
  /**
   * Próximo número livre da série da empresa, no ambiente (sem reservar).
   *
   * A numeração é por ambiente porque uma nota de teste não pode consumir número
   * da série real: o buraco que ela deixaria em produção só se fecha com pedido
   * de inutilização à SEFAZ. É isso que permite ensaiar a nota em homologação
   * antes de emitir valendo.
   */
  peekNumber(empresaCnpj: string, serie: string, ambiente?: Ambiente): Promise<number>;
  /**
   * Reserva o proximo numero de forma ATOMICA e o devolve.
   *
   * `peekNumber` le e soma 1 — duas emissoes simultaneas leem o mesmo `ultimo`
   * e recebem o MESMO numero; a segunda volta da SEFAZ como duplicidade (539).
   * So aparece com dois operadores ao mesmo tempo ou com volume, e por isso
   * passa despercebido ate doer.
   */
  reservarNumero(empresaCnpj: string, serie: string, ambiente?: Ambiente): Promise<number>;
  /**
   * Devolve um numero reservado que nao virou nota.
   *
   * So volta se ainda for o ultimo: se outra emissao ja passou por cima, o
   * numero foi legitimamente consumido e mexer nele criaria a duplicidade que
   * a reserva existe para evitar.
   *
   * E o que preserva a promessa antiga de que rejeicao nao queima numeracao.
   */
  devolverNumero(empresaCnpj: string, serie: string, numero: number, ambiente?: Ambiente): Promise<void>;
  /** Registra que `numero` foi usado — sequência avança para max(atual, numero). */
  registerUsedNumber(empresaCnpj: string, serie: string, numero: number, ambiente?: Ambiente): Promise<void>;
  saveNota(nota: NotaRecord): Promise<void>;
  listNotas(empresaCnpj?: string, limit?: number): Promise<NotaRecord[]>;
  getNota(chaveAcesso: string): Promise<NotaRecord | null>;
  updateStatus(chaveAcesso: string, status: string, cStat?: string): Promise<void>;
  deleteHomologacao(empresaCnpj?: string): Promise<number>;
  /**
   * Apaga UMA nota pela chave, e devolve quantas saíram (0 ou 1).
   *
   * Quem decide se pode apagar é a rota, não o storage: aqui não há como saber
   * se a nota é de teste ou de produção sem ler de novo. O storage obedece.
   */
  deleteNota(chaveAcesso: string): Promise<number>;
  /** Quantas notas em produção (ambiente 1) a empresa tem na série. */
  contarNotasProducao(empresaCnpj: string, serie: string): Promise<number>;
  /**
   * Números do cliente para o painel de suporte: quanto emitiu, de quê, quando.
   *
   * Agregado no banco e não em memória porque quem dá suporte olha o total do
   * cliente, não as últimas cem notas — e trazer tudo para somar no servidor
   * ficaria mais caro a cada mês que o cliente usa.
   */
  resumoEmpresa(empresaCnpj: string): Promise<ResumoEmpresa>;
  /**
   * Zera o contador da série. Com `ambiente`, zera só o daquele lado — zerar
   * homologação é sempre seguro; produção só depois de conferir que a série não
   * tem nota emitida.
   */
  resetSequencia(empresaCnpj: string, serie: string, ambiente?: Ambiente): Promise<void>;
  kind(): string;
}

// ---------------------------------------------------------------------------
// FileStorage — JSON em output/ (uso local)
// ---------------------------------------------------------------------------

export class FileStorage implements WebappStorage {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? path.resolve('output');
  }

  kind(): string { return 'file'; }

  async init(): Promise<void> {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      // Filesystem somente leitura (serverless sem NFE_DB_URL): usa /tmp —
      // funcional, mas efêmero. Para persistência real, configure NFE_DB_URL.
      this.dir = path.join(os.tmpdir(), 'nfe-webapp');
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private seqPath(): string { return path.join(this.dir, 'sequence.json'); }
  private histPath(): string { return path.join(this.dir, 'historico.json'); }

  private readJson<T>(file: string, fallback: T): T {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
  }

  private writeJson(file: string, data: unknown): void {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* filesystem somente leitura (serverless sem DB) */ }
  }

  private seqKey(empresaCnpj: string, serie: string, ambiente: Ambiente): string {
    return `${empresaCnpj}_serie_${serie}_amb_${ambiente}`;
  }

  /**
   * Contador em vigor, considerando o formato antigo — antes desta versão os dois
   * ambientes dividiam a mesma chave. Esse valor herdado vira piso dos dois, para
   * que produção jamais reemita um número que já pode ter saído.
   */
  private seqAtual(seq: Record<string, number>, cnpj: string, serie: string, ambiente: Ambiente): number {
    return seq[this.seqKey(cnpj, serie, ambiente)] ?? seq[`${cnpj}_serie_${serie}`] ?? 0;
  }

  async peekNumber(empresaCnpj: string, serie: string, ambiente: Ambiente = '1'): Promise<number> {
    const seq = this.readJson<Record<string, number>>(this.seqPath(), {});
    return this.seqAtual(seq, empresaCnpj, serie, ambiente) + 1;
  }

  async reservarNumero(empresaCnpj: string, serie: string, ambiente: Ambiente = '1'): Promise<number> {
    // No arquivo nao ha concorrencia real (processo unico), mas a semantica
    // precisa ser a mesma dos dois lados.
    const seq = this.readJson<Record<string, number>>(this.seqPath(), {});
    const proximo = this.seqAtual(seq, empresaCnpj, serie, ambiente) + 1;
    seq[this.seqKey(empresaCnpj, serie, ambiente)] = proximo;
    this.writeJson(this.seqPath(), seq);
    return proximo;
  }

  async devolverNumero(empresaCnpj: string, serie: string, numero: number, ambiente: Ambiente = '1'): Promise<void> {
    const seq = this.readJson<Record<string, number>>(this.seqPath(), {});
    const chave = this.seqKey(empresaCnpj, serie, ambiente);
    if (this.seqAtual(seq, empresaCnpj, serie, ambiente) !== numero) return;
    seq[chave] = numero - 1;
    this.writeJson(this.seqPath(), seq);
  }

  async registerUsedNumber(empresaCnpj: string, serie: string, numero: number, ambiente: Ambiente = '1'): Promise<void> {
    const seq = this.readJson<Record<string, number>>(this.seqPath(), {});
    seq[this.seqKey(empresaCnpj, serie, ambiente)] =
      Math.max(this.seqAtual(seq, empresaCnpj, serie, ambiente), numero);
    this.writeJson(this.seqPath(), seq);
  }

  async saveNota(nota: NotaRecord): Promise<void> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    hist.unshift(nota);
    if (hist.length > 500) hist.length = 500;
    this.writeJson(this.histPath(), hist);
  }

  async listNotas(empresaCnpj?: string, limit = 100): Promise<NotaRecord[]> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    const filtered = empresaCnpj ? hist.filter(n => n.empresaCnpj === empresaCnpj) : hist;
    // Lista sem payloads pesados
    return filtered.slice(0, limit).map(({ nfeJson, xml, ...rest }) => rest as NotaRecord);
  }

  async getNota(chaveAcesso: string): Promise<NotaRecord | null> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    return hist.find(n => n.chaveAcesso === chaveAcesso) ?? null;
  }

  async updateStatus(chaveAcesso: string, status: string, cStat?: string): Promise<void> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    const nota = hist.find(n => n.chaveAcesso === chaveAcesso);
    if (nota) {
      nota.status = status;
      if (cStat) nota.cStat = cStat;
      this.writeJson(this.histPath(), hist);
    }
  }

  async deleteHomologacao(empresaCnpj?: string): Promise<number> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    const before = hist.length;
    const kept = hist.filter(n => {
      if (n.ambiente !== '2') return true;
      if (empresaCnpj && n.empresaCnpj !== empresaCnpj) return true;
      return false;
    });
    this.writeJson(this.histPath(), kept);
    return before - kept.length;
  }

  async deleteNota(chaveAcesso: string): Promise<number> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    const kept = hist.filter(n => n.chaveAcesso !== chaveAcesso);
    this.writeJson(this.histPath(), kept);
    return hist.length - kept.length;
  }

  async contarNotasProducao(empresaCnpj: string, serie: string): Promise<number> {
    const hist = this.readJson<NotaRecord[]>(this.histPath(), []);
    return hist.filter(n =>
      n.empresaCnpj === empresaCnpj && n.serie === serie && n.ambiente === '1',
    ).length;
  }

  async resumoEmpresa(empresaCnpj: string): Promise<ResumoEmpresa> {
    const daEmpresa = this.readJson<NotaRecord[]>(this.histPath(), [])
      .filter(n => n.empresaCnpj === empresaCnpj);
    return resumirNotas(daEmpresa);
  }

  async resetSequencia(empresaCnpj: string, serie: string, ambiente?: Ambiente): Promise<void> {
    const seq = this.readJson<Record<string, number>>(this.seqPath(), {});
    if (ambiente) {
      delete seq[this.seqKey(empresaCnpj, serie, ambiente)];
      // O contador antigo é compartilhado: zerar um ambiente só não pode apagá-lo,
      // senão o outro voltaria junto. Ele é rebaixado a valor do ambiente oposto.
      const legado = seq[`${empresaCnpj}_serie_${serie}`];
      if (legado != null) {
        const oposto: Ambiente = ambiente === '1' ? '2' : '1';
        const chaveOposta = this.seqKey(empresaCnpj, serie, oposto);
        seq[chaveOposta] = Math.max(seq[chaveOposta] ?? 0, legado);
        delete seq[`${empresaCnpj}_serie_${serie}`];
      }
    } else {
      delete seq[`${empresaCnpj}_serie_${serie}`];
      delete seq[this.seqKey(empresaCnpj, serie, '1')];
      delete seq[this.seqKey(empresaCnpj, serie, '2')];
    }
    this.writeJson(this.seqPath(), seq);
  }
}

/**
 * Resume uma lista de notas. Serve ao FileStorage, que não tem SQL — o Postgres
 * faz a mesma conta no banco, para não trazer o histórico inteiro só para somar.
 */
function resumirNotas(notas: NotaRecord[]): ResumoEmpresa {
  const agora = Date.now();
  const trintaDias = agora - 30 * 86_400_000;
  const hoje = new Date().toISOString().slice(0, 10);

  const prod = notas.filter(n => n.ambiente === '1');
  const hom = notas.filter(n => n.ambiente === '2');
  const autorizadas = prod.filter(n => n.status === 'AUTORIZADA');

  const porSerie = new Map<string, { quantidade: number; ultimoNumero: number }>();
  for (const n of prod) {
    const atual = porSerie.get(n.serie) ?? { quantidade: 0, ultimoNumero: 0 };
    atual.quantidade += 1;
    atual.ultimoNumero = Math.max(atual.ultimoNumero, Number(n.numero) || 0);
    porSerie.set(n.serie, atual);
  }

  const datas = prod.map(n => n.emitidaEm).filter(Boolean).sort();

  return {
    producao: {
      autorizadas: autorizadas.length,
      canceladas: prod.filter(n => n.status === 'CANCELADA').length,
      valorTotal: autorizadas
        .reduce((s, n) => s + (Number(n.vNF) || 0), 0)
        .toFixed(2),
    },
    homologacao: {
      autorizadas: hom.filter(n => n.status === 'AUTORIZADA').length,
      canceladas: hom.filter(n => n.status === 'CANCELADA').length,
    },
    ultimos30Dias: prod.filter(n => new Date(n.emitidaEm).getTime() >= trintaDias).length,
    hoje: prod.filter(n => String(n.emitidaEm).slice(0, 10) === hoje).length,
    primeiraEmissao: datas[0],
    ultimaEmissao: datas[datas.length - 1],
    series: [...porSerie.entries()]
      .map(([serie, v]) => ({ serie, quantidade: v.quantidade, ultimoNumero: String(v.ultimoNumero) }))
      .sort((a, b) => b.quantidade - a.quantidade),
  };
}

// ---------------------------------------------------------------------------
// PgStorage — Postgres (produção/serverless, multi-usuário)
// ---------------------------------------------------------------------------

export class PgStorage implements WebappStorage {
  private pool: Pool;
  private initialized = false;

  constructor(poolOrUrl: Pool | string) {
    if (typeof poolOrUrl === 'string') {
      const isLocal = /localhost|127\.0\.0\.1/.test(poolOrUrl);
      this.pool = new Pool({
        connectionString: poolOrUrl,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        max: 3, // serverless: poucas conexões por instância
      });
    } else {
      this.pool = poolOrUrl;
    }
  }

  kind(): string { return 'postgres'; }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_sequencia2 (
        cnpj VARCHAR(14) NOT NULL,
        serie TEXT NOT NULL,
        ultimo INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (cnpj, serie)
      );
    `);
    // Numeração separada por ambiente. A coluna entra com DEFAULT '1', então todo
    // contador que já existia passa a ser o de produção — o lado onde repetir um
    // número seria caro.
    await this.pool.query(
      `ALTER TABLE webapp_sequencia2 ADD COLUMN IF NOT EXISTS ambiente VARCHAR(1) NOT NULL DEFAULT '1';`,
    );
    await this.pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webapp_sequencia2_pk_amb') THEN
          ALTER TABLE webapp_sequencia2 DROP CONSTRAINT IF EXISTS webapp_sequencia2_pkey;
          ALTER TABLE webapp_sequencia2
            ADD CONSTRAINT webapp_sequencia2_pk_amb PRIMARY KEY (cnpj, serie, ambiente);
          -- O contador herdado valia para os dois ambientes juntos. Copiado para
          -- homologacao, nenhum dos lados reaproveita numero que ja pode ter saido.
          INSERT INTO webapp_sequencia2 (cnpj, serie, ultimo, ambiente)
            SELECT cnpj, serie, ultimo, '2' FROM webapp_sequencia2 WHERE ambiente = '1'
            ON CONFLICT DO NOTHING;
        END IF;
      END $$;
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_notas (
        chave_acesso VARCHAR(44) PRIMARY KEY,
        numero TEXT NOT NULL,
        serie TEXT NOT NULL,
        ambiente VARCHAR(1) NOT NULL,
        dest_nome TEXT NOT NULL DEFAULT '',
        dest_doc TEXT NOT NULL DEFAULT '',
        v_nf TEXT NOT NULL DEFAULT '0.00',
        protocolo TEXT,
        dh_recbto TEXT,
        cstat TEXT,
        status TEXT NOT NULL DEFAULT 'AUTORIZADA',
        nfe_json JSONB,
        xml TEXT,
        emitida_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(
      `ALTER TABLE webapp_notas ADD COLUMN IF NOT EXISTS empresa_cnpj VARCHAR(14) NOT NULL DEFAULT '';`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webapp_notas_emitida ON webapp_notas (emitida_em DESC);`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webapp_notas_empresa ON webapp_notas (empresa_cnpj);`,
    );
    this.initialized = true;
  }

  async peekNumber(empresaCnpj: string, serie: string, ambiente: Ambiente = '1'): Promise<number> {
    const r = await this.pool.query(
      'SELECT ultimo FROM webapp_sequencia2 WHERE cnpj = $1 AND serie = $2 AND ambiente = $3',
      [empresaCnpj, serie, ambiente],
    );
    return (r.rows[0]?.ultimo ?? 0) + 1;
  }

  async reservarNumero(empresaCnpj: string, serie: string, ambiente: Ambiente = '1'): Promise<number> {
    // Um comando so: o INSERT ... ON CONFLICT DO UPDATE trava a linha e o
    // RETURNING devolve o valor ja incrementado. Duas requisicoes simultaneas
    // saem com numeros diferentes porque a segunda espera a primeira.
    const r = await this.pool.query(
      `INSERT INTO webapp_sequencia2 (cnpj, serie, ambiente, ultimo) VALUES ($1, $2, $3, 1)
       ON CONFLICT (cnpj, serie, ambiente)
       DO UPDATE SET ultimo = webapp_sequencia2.ultimo + 1
       RETURNING ultimo`,
      [empresaCnpj, serie, ambiente],
    );
    return Number(r.rows[0].ultimo);
  }

  async devolverNumero(empresaCnpj: string, serie: string, numero: number, ambiente: Ambiente = '1'): Promise<void> {
    // A condicao `ultimo = $4` e o que torna isto seguro: se outra emissao ja
    // avancou, nada acontece — aquele numero foi consumido de verdade.
    await this.pool.query(
      `UPDATE webapp_sequencia2 SET ultimo = ultimo - 1
        WHERE cnpj = $1 AND serie = $2 AND ambiente = $3 AND ultimo = $4`,
      [empresaCnpj, serie, ambiente, numero],
    ).catch(() => { /* devolver e otimizacao, nao pode derrubar a resposta */ });
  }

  async registerUsedNumber(empresaCnpj: string, serie: string, numero: number, ambiente: Ambiente = '1'): Promise<void> {
    // Atômico: avança para max(atual, numero) — seguro com usuários simultâneos
    await this.pool.query(
      `INSERT INTO webapp_sequencia2 (cnpj, serie, ambiente, ultimo) VALUES ($1, $2, $3, $4)
       ON CONFLICT (cnpj, serie, ambiente)
       DO UPDATE SET ultimo = GREATEST(webapp_sequencia2.ultimo, EXCLUDED.ultimo)`,
      [empresaCnpj, serie, ambiente, numero],
    );
  }

  async saveNota(n: NotaRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_notas
        (chave_acesso, empresa_cnpj, numero, serie, ambiente, dest_nome, dest_doc, v_nf,
         protocolo, dh_recbto, cstat, status, nfe_json, xml, emitida_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (chave_acesso) DO NOTHING`,
      [
        n.chaveAcesso, n.empresaCnpj, n.numero, n.serie, n.ambiente, n.destNome, n.destDoc, n.vNF,
        n.protocolo ?? null, n.dhRecbto ?? null, n.cStat ?? null, n.status,
        n.nfeJson ? JSON.stringify(n.nfeJson) : null, n.xml ?? null, n.emitidaEm,
      ],
    );
  }

  async listNotas(empresaCnpj?: string, limit = 100): Promise<NotaRecord[]> {
    const base = `SELECT chave_acesso, empresa_cnpj, numero, serie, ambiente, dest_nome, dest_doc, v_nf,
              protocolo, dh_recbto, cstat, status, emitida_em
       FROM webapp_notas`;
    const r = empresaCnpj
      ? await this.pool.query(`${base} WHERE empresa_cnpj = $2 ORDER BY emitida_em DESC LIMIT $1`, [limit, empresaCnpj])
      : await this.pool.query(`${base} ORDER BY emitida_em DESC LIMIT $1`, [limit]);
    return r.rows.map(this.mapRow);
  }

  async getNota(chaveAcesso: string): Promise<NotaRecord | null> {
    const r = await this.pool.query(
      'SELECT * FROM webapp_notas WHERE chave_acesso = $1',
      [chaveAcesso],
    );
    if (!r.rows[0]) return null;
    const nota = this.mapRow(r.rows[0]);
    nota.nfeJson = r.rows[0].nfe_json ?? undefined;
    nota.xml = r.rows[0].xml ?? undefined;
    return nota;
  }

  async updateStatus(chaveAcesso: string, status: string, cStat?: string): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_notas SET status = $2, cstat = COALESCE($3, cstat) WHERE chave_acesso = $1`,
      [chaveAcesso, status, cStat ?? null],
    );
  }

  async deleteHomologacao(empresaCnpj?: string): Promise<number> {
    let r;
    if (empresaCnpj) {
      r = await this.pool.query(
        `DELETE FROM webapp_notas WHERE ambiente = '2' AND empresa_cnpj = $1`,
        [empresaCnpj],
      );
    } else {
      r = await this.pool.query(`DELETE FROM webapp_notas WHERE ambiente = '2'`);
    }
    return r.rowCount ?? 0;
  }

  async deleteNota(chaveAcesso: string): Promise<number> {
    const r = await this.pool.query(
      `DELETE FROM webapp_notas WHERE chave_acesso = $1`,
      [chaveAcesso],
    );
    return r.rowCount ?? 0;
  }

  async contarNotasProducao(empresaCnpj: string, serie: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM webapp_notas
       WHERE empresa_cnpj = $1 AND serie = $2 AND ambiente = '1'`,
      [empresaCnpj, serie],
    );
    return r.rows[0]?.n ?? 0;
  }

  async resumoEmpresa(empresaCnpj: string): Promise<ResumoEmpresa> {
    const totais = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ambiente = '1' AND status = 'AUTORIZADA')::int AS prod_ok,
         COUNT(*) FILTER (WHERE ambiente = '1' AND status = 'CANCELADA')::int  AS prod_canc,
         COUNT(*) FILTER (WHERE ambiente = '2' AND status = 'AUTORIZADA')::int AS hom_ok,
         COUNT(*) FILTER (WHERE ambiente = '2' AND status = 'CANCELADA')::int  AS hom_canc,
         COUNT(*) FILTER (WHERE ambiente = '1' AND emitida_em >= NOW() - INTERVAL '30 days')::int AS d30,
         COUNT(*) FILTER (WHERE ambiente = '1' AND emitida_em::date = CURRENT_DATE)::int AS hoje,
         -- v_nf é texto no leiaute; o cast falha em linha suja e derrubaria o
         -- painel inteiro por causa de uma nota. NULLIF + regex descarta o que
         -- não for número em vez de estourar.
         COALESCE(SUM(
           CASE WHEN ambiente = '1' AND status = 'AUTORIZADA'
                     AND v_nf ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN v_nf::numeric ELSE 0 END
         ), 0)::text AS valor_total,
         MIN(emitida_em) FILTER (WHERE ambiente = '1') AS primeira,
         MAX(emitida_em) FILTER (WHERE ambiente = '1') AS ultima
       FROM webapp_notas WHERE empresa_cnpj = $1`,
      [empresaCnpj],
    );

    const series = await this.pool.query(
      `SELECT serie, COUNT(*)::int AS quantidade,
              MAX(NULLIF(regexp_replace(numero, '\\D', '', 'g'), '')::bigint) AS ultimo
       FROM webapp_notas
       WHERE empresa_cnpj = $1 AND ambiente = '1'
       GROUP BY serie ORDER BY quantidade DESC`,
      [empresaCnpj],
    );

    const t = totais.rows[0] ?? {};
    return {
      producao: {
        autorizadas: t.prod_ok ?? 0,
        canceladas: t.prod_canc ?? 0,
        valorTotal: Number(t.valor_total ?? 0).toFixed(2),
      },
      homologacao: { autorizadas: t.hom_ok ?? 0, canceladas: t.hom_canc ?? 0 },
      ultimos30Dias: t.d30 ?? 0,
      hoje: t.hoje ?? 0,
      primeiraEmissao: t.primeira ? new Date(t.primeira).toISOString() : undefined,
      ultimaEmissao: t.ultima ? new Date(t.ultima).toISOString() : undefined,
      series: series.rows.map(r => ({
        serie: r.serie,
        quantidade: r.quantidade,
        ultimoNumero: String(r.ultimo ?? 0),
      })),
    };
  }

  async resetSequencia(empresaCnpj: string, serie: string, ambiente?: Ambiente): Promise<void> {
    await this.pool.query(
      ambiente
        ? `UPDATE webapp_sequencia2 SET ultimo = 0 WHERE cnpj = $1 AND serie = $2 AND ambiente = $3`
        : `UPDATE webapp_sequencia2 SET ultimo = 0 WHERE cnpj = $1 AND serie = $2`,
      ambiente ? [empresaCnpj, serie, ambiente] : [empresaCnpj, serie],
    );
  }

  private mapRow(row: any): NotaRecord {
    return {
      chaveAcesso: row.chave_acesso,
      empresaCnpj: row.empresa_cnpj ?? '',
      numero: row.numero,
      serie: row.serie,
      ambiente: row.ambiente,
      destNome: row.dest_nome,
      destDoc: row.dest_doc,
      vNF: row.v_nf,
      protocolo: row.protocolo ?? undefined,
      dhRecbto: row.dh_recbto ?? undefined,
      cStat: row.cstat ?? undefined,
      status: row.status,
      emitidaEm: row.emitida_em instanceof Date ? row.emitida_em.toISOString() : row.emitida_em,
    };
  }
}

export function createStorage(dbUrl: string): WebappStorage {
  return dbUrl ? new PgStorage(dbUrl) : new FileStorage();
}
