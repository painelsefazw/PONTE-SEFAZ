import { Pool } from 'pg';

/**
 * As NF-e que a empresa RECEBEU — a Distribuição DF-e, com memória.
 *
 * A rota `/api/consulta-dfe` já falava com a SEFAZ, mas sem guardar nada: quem
 * chamava tinha de mandar o `ultNSU` e ficar com o resultado na mão. Isso serve
 * ao painel interno, onde uma pessoa controla o que digita. Não serve a uma
 * tela de cliente, por dois motivos que não são de conforto:
 *
 * **1. A SEFAZ bloqueia o CNPJ.** Consultar a Distribuição DF-e de novo sem
 * avançar o NSU devolve `cStat 656 — consumo indevido`, e a empresa fica UMA
 * HORA sem conseguir consultar. Uma tela em que cada visita recomeça do zero
 * produz exatamente isso. O ponteiro precisa sobreviver entre as visitas, e é
 * por isso que ele mora aqui e não no navegador.
 *
 * **2. O resumo não é a nota.** A distribuição entrega quase tudo como
 * `resNFe` — emitente, valor, chave — e o XML completo (`procNFe`) só vem
 * depois da manifestação. Sem guardar o que já chegou, não há como saber o que
 * já foi manifestado nem o que ainda falta buscar.
 */

/** Um documento recebido: resumo (`resNFe`) ou nota inteira (`procNFe`). */
export interface NfeRecebida {
  chaveAcesso: string;
  /** Empresa que baixou o documento — a dona do certificado. */
  empresaCnpj: string;
  nsu: number;
  /** `resNFe` (resumo) ou `procNFe` (com XML). */
  schema: string;
  emitenteCnpj?: string;
  emitenteNome?: string;
  valorNota?: string;
  /** `1` saída do emitente (compra da empresa), `0` entrada. */
  tipoOperacao?: string;
  /** Situação da NF-e na SEFAZ: `1` autorizada, `2` denegada, `3` cancelada. */
  situacao?: string;
  emitidaEm?: string;
  /** Último evento de manifestação registrado — `210200`, `210210`… */
  manifestacao?: string;
  manifestadaEm?: string;
  xml?: string;
}

/** O estado da última varredura, para não bater na SEFAZ à toa. */
export interface PonteiroDfe {
  ultimoNsu: number;
  /** O maior NSU que a SEFAZ diz existir. Igual ao último = está em dia. */
  maxNsu: number;
  consultadoEm?: string;
  /** Ate quando a SEFAZ recusa nova consulta (rejeicao 656). */
  bloqueadoAte?: string;
}

function paraRecebida(row: any): NfeRecebida {
  return {
    chaveAcesso: row.chave_acesso,
    empresaCnpj: row.empresa_cnpj,
    nsu: Number(row.nsu),
    schema: row.schema,
    emitenteCnpj: row.emitente_cnpj ?? undefined,
    emitenteNome: row.emitente_nome ?? undefined,
    valorNota: row.valor_nota ?? undefined,
    tipoOperacao: row.tipo_operacao ?? undefined,
    situacao: row.situacao ?? undefined,
    emitidaEm: row.emitida_em ?? undefined,
    manifestacao: row.manifestacao ?? undefined,
    manifestadaEm: row.manifestada_em ?? undefined,
  };
}

export class NfeRecebidaStore {
  private pool: Pool;
  private initialized = false;

  constructor(poolOrUrl: Pool | string) {
    if (typeof poolOrUrl === 'string') {
      const isLocal = /localhost|127\.0\.0\.1/.test(poolOrUrl);
      this.pool = new Pool({
        connectionString: poolOrUrl,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        max: 3,
      });
    } else {
      this.pool = poolOrUrl;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_nfe_recebidas (
        chave_acesso VARCHAR(44) PRIMARY KEY,
        empresa_cnpj VARCHAR(14) NOT NULL,
        nsu BIGINT NOT NULL,
        schema TEXT NOT NULL DEFAULT 'resNFe',
        emitente_cnpj TEXT,
        emitente_nome TEXT,
        valor_nota NUMERIC(15,2),
        tipo_operacao VARCHAR(1),
        situacao VARCHAR(1),
        emitida_em TIMESTAMPTZ,
        manifestacao VARCHAR(6),
        manifestada_em TIMESTAMPTZ,
        xml TEXT,
        capturada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_nfe_recebidas_empresa
         ON webapp_nfe_recebidas (empresa_cnpj, emitida_em DESC);`,
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_nfe_dfe_nsu (
        cnpj VARCHAR(14) NOT NULL,
        ambiente VARCHAR(1) NOT NULL DEFAULT '1',
        ultimo_nsu BIGINT NOT NULL DEFAULT 0,
        max_nsu BIGINT NOT NULL DEFAULT 0,
        consultado_em TIMESTAMPTZ,
        PRIMARY KEY (cnpj, ambiente)
      );
    `);
    // Quando a SEFAZ devolve 656 ela bloqueia por uma hora — e cada nova
    // tentativa dentro da janela REINICIA o relogio. Sem guardar isso, o botao
    // "Buscar novas" vira uma armadilha: quem aperta de novo para ver se ja
    // liberou garante que nao liberou. Guardado, a ponte recusa localmente e
    // ninguem mais renova o proprio castigo.
    await this.pool.query(
      'ALTER TABLE webapp_nfe_dfe_nsu ADD COLUMN IF NOT EXISTS bloqueado_ate TIMESTAMPTZ');
    this.initialized = true;
  }

  async ponteiro(empresaCnpj: string, ambiente = '1'): Promise<PonteiroDfe> {
    const r = await this.pool.query(
      'SELECT ultimo_nsu, max_nsu, consultado_em, bloqueado_ate FROM webapp_nfe_dfe_nsu WHERE cnpj = $1 AND ambiente = $2',
      [empresaCnpj, ambiente],
    );
    const row = r.rows[0];
    return {
      ultimoNsu: Number(row?.ultimo_nsu ?? 0),
      maxNsu: Number(row?.max_nsu ?? 0),
      consultadoEm: row?.consultado_em ?? undefined,
      bloqueadoAte: row?.bloqueado_ate ?? undefined,
    };
  }

  /**
   * Avança o ponteiro. Nunca retrocede — releitura em corrida não pode fazer a
   * varredura seguinte reprocessar o que já entrou.
   */
  async registrarPonteiro(
    empresaCnpj: string,
    dados: { ultimoNsu: number; maxNsu: number },
    ambiente = '1',
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_nfe_dfe_nsu (cnpj, ambiente, ultimo_nsu, max_nsu, consultado_em)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (cnpj, ambiente) DO UPDATE
         SET ultimo_nsu = GREATEST(webapp_nfe_dfe_nsu.ultimo_nsu, EXCLUDED.ultimo_nsu),
             max_nsu = GREATEST(webapp_nfe_dfe_nsu.max_nsu, EXCLUDED.max_nsu),
             consultado_em = NOW()`,
      [empresaCnpj, ambiente, Math.floor(dados.ultimoNsu), Math.floor(dados.maxNsu)],
    );
  }

  /** Recomeça a varredura do zero, sem apagar o que já foi capturado. */
  /**
   * Marca o bloqueio de uma hora que a SEFAZ acabou de aplicar.
   *
   * A hora e contada a partir de AGORA porque e assim que a SEFAZ conta: a
   * janela reinicia a cada tentativa. Guardar o instante do 656 e o que
   * permite recusar as proximas sem gasta-las.
   */
  async marcarBloqueio(empresaCnpj: string, ambiente: string, minutos = 60): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_nfe_dfe_nsu (cnpj, ambiente, ultimo_nsu, max_nsu, bloqueado_ate)
       VALUES ($1, $2, 0, 0, NOW() + ($3 || ' minutes')::interval)
       ON CONFLICT (cnpj, ambiente)
       DO UPDATE SET bloqueado_ate = NOW() + ($3 || ' minutes')::interval`,
      [empresaCnpj, ambiente, String(minutos)],
    );
  }

  async zerarPonteiro(empresaCnpj: string, ambiente = '1'): Promise<void> {
    await this.pool.query(
      `INSERT INTO webapp_nfe_dfe_nsu (cnpj, ambiente, ultimo_nsu, max_nsu, consultado_em)
       VALUES ($1,$2,0,0,NOW())
       ON CONFLICT (cnpj, ambiente) DO UPDATE SET ultimo_nsu = 0, consultado_em = NOW()`,
      [empresaCnpj, ambiente],
    );
  }

  /**
   * Guarda um documento capturado.
   *
   * Devolve `true` quando é novidade. No conflito, atualiza APENAS o XML e o
   * schema, e só para melhor: o resumo chega primeiro e a nota inteira depois
   * da manifestação, então a segunda passagem tem de poder completar a
   * primeira — mas nunca apagar um XML já guardado com um resumo que voltou.
   */
  async salvar(n: NfeRecebida): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO webapp_nfe_recebidas
        (chave_acesso, empresa_cnpj, nsu, schema, emitente_cnpj, emitente_nome,
         valor_nota, tipo_operacao, situacao, emitida_em, xml)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (chave_acesso) DO UPDATE
         SET xml = COALESCE(EXCLUDED.xml, webapp_nfe_recebidas.xml),
             schema = CASE WHEN EXCLUDED.xml IS NOT NULL THEN EXCLUDED.schema ELSE webapp_nfe_recebidas.schema END,
             situacao = COALESCE(EXCLUDED.situacao, webapp_nfe_recebidas.situacao)
       RETURNING (xmax = 0) AS inserido`,
      [
        n.chaveAcesso, n.empresaCnpj, n.nsu, n.schema,
        n.emitenteCnpj ?? null, n.emitenteNome ?? null, n.valorNota ?? null,
        n.tipoOperacao ?? null, n.situacao ?? null, n.emitidaEm ?? null, n.xml ?? null,
      ],
    );
    return r.rows[0]?.inserido === true;
  }

  async listar(empresaCnpj: string, limite = 100): Promise<NfeRecebida[]> {
    const r = await this.pool.query(
      `SELECT chave_acesso, empresa_cnpj, nsu, schema, emitente_cnpj, emitente_nome,
              valor_nota, tipo_operacao, situacao, emitida_em, manifestacao, manifestada_em
         FROM webapp_nfe_recebidas WHERE empresa_cnpj = $1
         ORDER BY emitida_em DESC NULLS LAST, nsu DESC LIMIT $2`,
      [empresaCnpj, limite],
    );
    return r.rows.map(paraRecebida);
  }

  async obter(chaveAcesso: string): Promise<NfeRecebida | null> {
    const r = await this.pool.query(
      'SELECT * FROM webapp_nfe_recebidas WHERE chave_acesso = $1',
      [chaveAcesso],
    );
    if (!r.rows[0]) return null;
    const n = paraRecebida(r.rows[0]);
    n.xml = r.rows[0].xml ?? undefined;
    return n;
  }

  /**
   * Anota qual manifestação foi aceita pela SEFAZ.
   *
   * Só depois do retorno positivo: registrar antes deixaria a tela dizendo
   * "confirmada" para uma nota que a SEFAZ recusou.
   */
  async registrarManifestacao(chaveAcesso: string, tipoEvento: string): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_nfe_recebidas
          SET manifestacao = $2, manifestada_em = NOW()
        WHERE chave_acesso = $1`,
      [chaveAcesso, tipoEvento],
    );
  }
}

/**
 * Continuar varrendo, ou parar?
 *
 * Isolado do laco porque e a regra que impede o bloqueio de uma hora, e regra
 * assim precisa de teste. Sao tres motivos de parada e cada um por uma razao
 * diferente:
 *
 * - `consumo-indevido`: a SEFAZ ja avisou (656). Insistir e o que transforma o
 *   aviso em bloqueio efetivo do CNPJ.
 * - `sem-avanco`: o ponteiro nao mexeu, entao a proxima chamada seria
 *   identica a esta — e consulta repetida com o mesmo NSU e exatamente o que
 *   produz o 656.
 * - `em-dia`: alcancou o fim da fila. Nao ha o que buscar.
 */
export type PassoDaVarredura = 'continuar' | 'consumo-indevido' | 'sem-avanco' | 'em-dia';

export function proximoPasso(estado: {
  cStat: string;
  nsuAntes: number;
  nsuDepois: number;
  maxNsu: number;
}): PassoDaVarredura {
  if (estado.cStat === '656') return 'consumo-indevido';
  if (estado.nsuDepois <= estado.nsuAntes) return 'sem-avanco';
  if (estado.maxNsu > 0 && estado.nsuDepois >= estado.maxNsu) return 'em-dia';
  return 'continuar';
}
