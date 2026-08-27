import { Pool } from 'pg';

/**
 * A marca que sai impressa no DANFE de cada emitente.
 *
 * O DANFE tem um espaço reservado para a logomarca do emitente, e a biblioteca
 * que o desenha (`sped-da`) sabe preenchê-lo desde sempre — `logoParameters`,
 * com posição à esquerda, ao centro ou à direita. O que faltava era de onde
 * tirar a imagem: o serviço recebia apenas o XML, e o XML não carrega logo.
 *
 * O resultado é que toda nota de todo cliente saía com o mesmo espaço vazio.
 * Numa plataforma vendida como white-label isso aparece justamente no
 * documento que o cliente entrega ao cliente DELE.
 *
 * **Por CNPJ, e não por empresa ou por cliente de API.** Os dois cadastros
 * existem e não se cobrem: há empresa em `webapp_empresas` que não é cliente de
 * API, e cliente de API que nunca virou empresa — a Aliança é assim. O que
 * sempre existe, nos dois casos, é o CNPJ de quem emite, e é ele que o DANFE
 * imprime. Guardar por CNPJ faz a logo valer para os dois caminhos sem
 * duplicar nada.
 */

/** Onde a logo fica dentro do quadro do emitente. */
export type PosicaoDaLogo = 'L' | 'C' | 'R';

export interface MarcaDoDanfe {
  cnpj: string;
  /** A imagem em base64, SEM o prefixo `data:`. PNG ou JPG. */
  logoBase64: string;
  posicao: PosicaoDaLogo;
  atualizadaEm?: string;
}

/**
 * O limite existe para proteger a emissão, não para economizar disco.
 *
 * A logo viaja junto do XML em toda geração de DANFE. Uma imagem de 3 MB
 * transforma cada download de nota numa transferência de 3 MB — e, em
 * serverless, aproxima o limite de corpo da requisição. 400 KB comporta com
 * folga um PNG de 600×200, que e mais resolucao do que o quadro do DANFE usa.
 */
export const LIMITE_DA_LOGO = 400 * 1024;

/** Formatos que a biblioteca do DANFE desenha. */
const FORMATOS = [
  { assinatura: '89504e47', tipo: 'image/png' },
  { assinatura: 'ffd8ff', tipo: 'image/jpeg' },
];

export interface LogoRecusada {
  erro: string;
  comoResolver?: string;
}

/**
 * Confere a imagem antes de guardar — pura, para poder ser testada sem banco.
 *
 * Recusar aqui é o ponto barato. Guardada, uma imagem inválida só aparece
 * quando alguém baixa um DANFE, e o erro que chega é da biblioteca de PDF:
 * fala de recurso de imagem, não de logo, e não diz de qual cliente.
 */
export function conferirLogo(base64: string): LogoRecusada | null {
  const limpo = String(base64 ?? '').replace(/^data:image\/[a-z+]+;base64,/i, '').trim();
  if (!limpo) return { erro: 'Nenhuma imagem enviada.' };

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) {
    return {
      erro: 'A imagem nao esta em base64 valido.',
      comoResolver: 'Envie o conteudo do arquivo em base64. O prefixo "data:image/png;base64," '
        + 'e aceito e removido automaticamente.',
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(limpo, 'base64');
  } catch {
    return { erro: 'Nao foi possivel decodificar a imagem.' };
  }

  if (bytes.length > LIMITE_DA_LOGO) {
    return {
      erro: `A imagem tem ${Math.round(bytes.length / 1024)} KB e o limite e `
        + `${Math.round(LIMITE_DA_LOGO / 1024)} KB.`,
      comoResolver: 'A logo viaja junto do XML em toda geracao de DANFE — imagem grande deixa '
        + 'cada download de nota mais lento. Reduza para algo em torno de 600x200 pixels.',
    };
  }

  const inicio = bytes.subarray(0, 4).toString('hex');
  const formato = FORMATOS.find((f) => inicio.startsWith(f.assinatura));
  if (!formato) {
    return {
      erro: 'Formato nao reconhecido. Use PNG ou JPG.',
      comoResolver: 'SVG e WEBP nao sao desenhados pela biblioteca do DANFE. '
        + 'Exporte como PNG com fundo transparente.',
    };
  }

  return null;
}

/** Normaliza a posicao; qualquer coisa fora de L/C/R vira `L`. */
export function normalizarPosicao(valor: unknown): PosicaoDaLogo {
  const p = String(valor ?? '').trim().toUpperCase();
  return p === 'C' || p === 'R' ? p : 'L';
}

export class MarcaDoDanfeStore {
  private initialized = false;

  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_danfe_marca (
        cnpj VARCHAR(14) PRIMARY KEY,
        logo_base64 TEXT NOT NULL,
        posicao VARCHAR(1) NOT NULL DEFAULT 'L',
        atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    this.initialized = true;
  }

  /** A marca de um emitente, ou `null` quando ele nunca enviou logo. */
  async obter(cnpj: string): Promise<MarcaDoDanfe | null> {
    await this.init();
    const r = await this.pool.query(
      'SELECT cnpj, logo_base64, posicao, atualizada_em FROM webapp_danfe_marca WHERE cnpj = $1',
      [soDigitos(cnpj)],
    );
    const linha = r.rows[0];
    if (!linha) return null;
    return {
      cnpj: linha.cnpj,
      logoBase64: linha.logo_base64,
      posicao: normalizarPosicao(linha.posicao),
      atualizadaEm: linha.atualizada_em?.toISOString?.() ?? undefined,
    };
  }

  async salvar(cnpj: string, logoBase64: string, posicao: unknown): Promise<void> {
    await this.init();
    const limpo = String(logoBase64).replace(/^data:image\/[a-z+]+;base64,/i, '').trim();
    await this.pool.query(
      `INSERT INTO webapp_danfe_marca (cnpj, logo_base64, posicao, atualizada_em)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (cnpj) DO UPDATE
         SET logo_base64 = EXCLUDED.logo_base64,
             posicao = EXCLUDED.posicao,
             atualizada_em = NOW()`,
      [soDigitos(cnpj), limpo, normalizarPosicao(posicao)],
    );
  }

  async remover(cnpj: string): Promise<void> {
    await this.init();
    await this.pool.query('DELETE FROM webapp_danfe_marca WHERE cnpj = $1', [soDigitos(cnpj)]);
  }
}

function soDigitos(v: string): string {
  return String(v ?? '').replace(/\D/g, '');
}
