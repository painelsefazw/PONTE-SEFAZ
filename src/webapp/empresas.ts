/**
 * Cadastro de empresas emissoras (multi-tenant).
 *
 * Certificado .pfx e senha do certificado ficam CRIPTOGRAFADOS (AES-256-GCM,
 * chave-mestra fora do banco). Senha de acesso por empresa fica como hash scrypt.
 */
import { Pool } from 'pg';
import { encryptSecret, decryptSecret, hashSenha } from './crypto';

export interface EmpresaEndereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  nomeMunicipio: string;
  cep: string;
  fone?: string;
}

export interface EmpresaInput {
  cnpj: string;
  razaoSocial: string;
  fantasia?: string;
  ie: string;
  /**
   * Inscrição Municipal — emitida pela prefeitura, obrigatória na NFS-e.
   * Não tem relação com a Inscrição Estadual e nem toda empresa possui:
   * só quem presta serviço sujeito a ISS.
   */
  im?: string;
  crt: string;
  uf: string;
  ambiente: string; // '1' | '2'
  endereco: EmpresaEndereco;
  pfxBase64: string;      // certificado .pfx em base64 (vem do upload)
  pfxPassword: string;    // senha do certificado
  senhaAcesso?: string;   // senha de acesso da empresa (operadores)
}

export interface EmpresaPublic {
  cnpj: string;
  razaoSocial: string;
  fantasia?: string;
  ie: string;
  im?: string;
  crt: string;
  uf: string;
  ambiente: string;
  municipio: string;
  ativa: boolean;
}

/** Contexto pronto para emissão: config + certificado decriptado. */
export interface EmpresaContext {
  cnpj: string;
  razaoSocial: string;
  fantasia?: string;
  ie: string;
  /** Inscrição Municipal — usada na NFS-e, ausente na NF-e. */
  im?: string;
  crt: string;
  uf: string;
  ambiente: string;
  endereco: EmpresaEndereco;
  pfxBuffer: Buffer;
  pfxPassword: string;
  cscId?: string;
  cscToken?: string;
}

export class EmpresaStore {
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
      CREATE TABLE IF NOT EXISTS webapp_empresas (
        cnpj VARCHAR(14) PRIMARY KEY,
        razao_social TEXT NOT NULL,
        fantasia TEXT,
        ie TEXT NOT NULL,
        crt VARCHAR(1) NOT NULL,
        uf VARCHAR(2) NOT NULL,
        ambiente VARCHAR(1) NOT NULL DEFAULT '2',
        logradouro TEXT NOT NULL,
        numero TEXT NOT NULL,
        complemento TEXT,
        bairro TEXT NOT NULL,
        cod_municipio TEXT NOT NULL,
        nome_municipio TEXT NOT NULL,
        cep TEXT NOT NULL,
        fone TEXT,
        pfx_encrypted TEXT NOT NULL,
        pfx_password_encrypted TEXT NOT NULL,
        senha_acesso_hash TEXT,
        ativa BOOLEAN NOT NULL DEFAULT TRUE,
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // NFC-e: CSC (Código de Segurança do Contribuinte)
    await this.pool.query(`ALTER TABLE webapp_empresas ADD COLUMN IF NOT EXISTS csc_id TEXT`);
    await this.pool.query(`ALTER TABLE webapp_empresas ADD COLUMN IF NOT EXISTS csc_token TEXT`);
    // NFS-e: Inscrição Municipal, emitida pela prefeitura. Só quem presta
    // serviço sujeito a ISS possui — por isso é opcional.
    await this.pool.query(`ALTER TABLE webapp_empresas ADD COLUMN IF NOT EXISTS im TEXT`);
    this.initialized = true;
  }

  /**
   * Corrige a Inscrição Estadual sem exigir o reenvio do certificado.
   *
   * IE errada no cadastro derruba **toda** emissão da empresa com cStat 231
   * ("IE do emitente não vinculada ao CNPJ"), e o caminho normal de atualização
   * exige subir o PFX de novo só para trocar um número.
   */
  async atualizarIe(cnpj: string, ie: string): Promise<void> {
    await this.pool.query(
      'UPDATE webapp_empresas SET ie = $2 WHERE cnpj = $1',
      [cnpj.replace(/\D/g, ''), ie.replace(/\D/g, '')],
    );
  }

  /**
   * Corrige o código IBGE do município sem exigir o reenvio do certificado.
   *
   * Município inválido no cadastro derruba **toda** emissão da empresa com cStat
   * 270 ("Código Município do Fato Gerador de ICMS inexistente"), e o caminho
   * normal de atualização exige subir o PFX de novo só para trocar o código.
   */
  async atualizarMunicipio(cnpj: string, codigoMunicipio: string, nomeMunicipio: string): Promise<void> {
    await this.pool.query(
      'UPDATE webapp_empresas SET cod_municipio = $2, nome_municipio = $3 WHERE cnpj = $1',
      [cnpj.replace(/\D/g, ''), codigoMunicipio.replace(/\D/g, ''), nomeMunicipio],
    );
  }

  /**
   * Corrige o Código de Regime Tributário (CRT) sem reenviar o certificado.
   *
   * A NT 2026.007 (regra 12C21-20, produção 03/11/2026) passa a rejeitar a NF-e
   * quando o CRT informado diverge do regime do CNPJ na Receita (LCC-RFB):
   * 1=Simples, 2=Simples excesso, 3=Normal, 4=MEI. CRT errado no cadastro
   * derruba toda emissão da empresa na virada.
   */
  async atualizarCrt(cnpj: string, crt: string): Promise<void> {
    await this.pool.query(
      'UPDATE webapp_empresas SET crt = $2 WHERE cnpj = $1',
      [cnpj.replace(/\D/g, ''), crt],
    );
  }

  async salvarCsc(cnpj: string, cscId: string, cscToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE webapp_empresas SET csc_id = $2, csc_token = $3 WHERE cnpj = $1`,
      [cnpj.replace(/\D/g, ''), cscId, encryptSecret(cscToken)],
    );
  }

  /** Cadastra ou atualiza (upsert por CNPJ). */
  async salvar(input: EmpresaInput): Promise<void> {
    const pfxBuffer = Buffer.from(input.pfxBase64, 'base64');
    if (pfxBuffer.length < 100) {
      throw new Error('Certificado .pfx invalido (arquivo muito pequeno)');
    }
    const e = input.endereco;
    await this.pool.query(
      `INSERT INTO webapp_empresas
        (cnpj, razao_social, fantasia, ie, im, crt, uf, ambiente,
         logradouro, numero, complemento, bairro, cod_municipio, nome_municipio, cep, fone,
         pfx_encrypted, pfx_password_encrypted, senha_acesso_hash, ativa)
       VALUES ($1,$2,$3,$4,$19,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,TRUE)
       ON CONFLICT (cnpj) DO UPDATE SET
         razao_social=$2, fantasia=$3, ie=$4, im=$19, crt=$5, uf=$6, ambiente=$7,
         logradouro=$8, numero=$9, complemento=$10, bairro=$11, cod_municipio=$12,
         nome_municipio=$13, cep=$14, fone=$15,
         pfx_encrypted=$16, pfx_password_encrypted=$17,
         senha_acesso_hash=COALESCE($18, webapp_empresas.senha_acesso_hash),
         ativa=TRUE`,
      [
        input.cnpj.replace(/\D/g, ''), input.razaoSocial, input.fantasia ?? null,
        // IE, CEP e telefone vão para o XML da NF-e apenas com dígitos (exigência do XSD):
        // formatação (pontos, traços) ou entrada suja causariam rejeição na validação.
        input.ie.replace(/\D/g, ''), input.crt, input.uf, input.ambiente,
        e.logradouro, e.numero, e.complemento ?? null, e.bairro,
        e.codigoMunicipio, e.nomeMunicipio, e.cep.replace(/\D/g, ''),
        e.fone ? e.fone.replace(/\D/g, '') : null,
        encryptSecret(pfxBuffer),
        encryptSecret(input.pfxPassword),
        input.senhaAcesso ? hashSenha(input.senhaAcesso) : null,
        // Inscrição Municipal: alguns municípios usam letras ou ponto, então
        // guarda como veio, só sem espaços nas pontas.
        input.im?.trim() || null,
      ],
    );
  }

  async listar(): Promise<EmpresaPublic[]> {
    const r = await this.pool.query(
      `SELECT cnpj, razao_social, fantasia, ie, im, crt, uf, ambiente, nome_municipio, ativa
       FROM webapp_empresas WHERE ativa = TRUE ORDER BY razao_social`,
    );
    return r.rows.map((row: any) => ({
      cnpj: row.cnpj,
      razaoSocial: row.razao_social,
      fantasia: row.fantasia ?? undefined,
      ie: row.ie,
      im: row.im ?? undefined,
      crt: row.crt,
      uf: row.uf,
      ambiente: row.ambiente,
      municipio: row.nome_municipio,
      ativa: row.ativa,
    }));
  }

  /** Linha completa (uso interno — segredos ainda criptografados). */
  async obterRaw(cnpj: string): Promise<any | null> {
    const r = await this.pool.query(
      'SELECT * FROM webapp_empresas WHERE cnpj = $1',
      [cnpj.replace(/\D/g, '')],
    );
    return r.rows[0] ?? null;
  }

  /** Contexto de emissão com certificado decriptado. */
  async obterContexto(cnpj: string): Promise<EmpresaContext | null> {
    const row = await this.obterRaw(cnpj);
    if (!row || !row.ativa) return null;
    return {
      cnpj: row.cnpj,
      razaoSocial: row.razao_social,
      fantasia: row.fantasia ?? undefined,
      ie: row.ie,
      im: row.im ?? undefined,
      crt: row.crt,
      uf: row.uf,
      ambiente: row.ambiente,
      endereco: {
        logradouro: row.logradouro,
        numero: row.numero,
        complemento: row.complemento ?? undefined,
        bairro: row.bairro,
        codigoMunicipio: row.cod_municipio,
        nomeMunicipio: row.nome_municipio,
        cep: row.cep,
        fone: row.fone ?? undefined,
      },
      pfxBuffer: decryptSecret(row.pfx_encrypted),
      pfxPassword: decryptSecret(row.pfx_password_encrypted).toString('utf-8'),
      cscId: row.csc_id ?? undefined,
      cscToken: row.csc_token ? decryptSecret(row.csc_token).toString('utf-8') : undefined,
    };
  }

  /**
   * Troca o ambiente da empresa sem exigir reenvio do certificado.
   * `salvar()` faria o mesmo, mas obriga a passar o .pfx inteiro no corpo.
   */
  async alterarAmbiente(cnpj: string, ambiente: string): Promise<void> {
    await this.pool.query(
      'UPDATE webapp_empresas SET ambiente = $2 WHERE cnpj = $1',
      [cnpj.replace(/\D/g, ''), ambiente],
    );
  }

  async desativar(cnpj: string): Promise<void> {
    await this.pool.query(
      'UPDATE webapp_empresas SET ativa = FALSE WHERE cnpj = $1',
      [cnpj.replace(/\D/g, '')],
    );
  }

  async remover(cnpj: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM webapp_empresas WHERE cnpj = $1',
      [cnpj.replace(/\D/g, '')],
    );
  }
}
