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
  logoBase64?: string;
  posicao: PosicaoDaLogo;
  /**
   * O texto fixo que acompanha toda nota deste emitente.
   *
   * Sai em "Informações complementares", o quadro de baixo do DANFE — que é
   * onde vive o recado que a empresa repete em toda nota: dados bancários,
   * prazo de garantia, a frase que a contabilidade exige. Sem isto, ou alguém
   * digita a mesma coisa a cada emissão (e um dia esquece), ou o ERP do
   * cliente precisa carregar essa regra, que não é dele.
   */
  textoPadrao?: string;
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
 * O que o desenhista de PDF do DANFE consegue, de fato, desenhar.
 *
 * Aqui não vale a intuição de "PNG é PNG". O serviço de DANFE roda no runtime
 * PHP da Vercel, que **não traz a extensão `gd`** — e não é configuração: ela
 * não está na lista de extensões de nenhuma versão do runtime. Sem `gd`, a
 * biblioteca não converte nada, e a imagem cai direto no FPDF, que é de uma
 * geração que recusa três coisas: canal alfa, 16 bits por canal e entrelaçada.
 *
 * Recusar aqui é o ponto barato. Aceita, a imagem só falha quando alguém baixa
 * um DANFE — e o modo como falha é o pior possível: a nota sai, correta e
 * autorizada, apenas sem a logo. Ninguém abre um chamado para isso; o cliente
 * só conclui que a plataforma não faz logo.
 *
 * As telas já mandam JPEG sobre fundo branco justamente para não esbarrar
 * nisto. Esta função protege quem chama a API direto.
 */
function conferirPngQueOFpdfDesenha(bytes: Buffer): LogoRecusada | null {
  // Assinatura (8) + tamanho do chunk (4) + "IHDR" (4) + largura (4) + altura (4).
  const IHDR = 8 + 4 + 4 + 4 + 4;
  if (bytes.length < IHDR + 5) return { erro: 'PNG truncado: falta o cabecalho IHDR.' };
  const profundidade = bytes[IHDR];
  const tipoDeCor = bytes[IHDR + 1];
  const entrelacada = bytes[IHDR + 4];

  const comoResolver = 'Salve a logo como JPG sobre fundo branco — o DANFE e impresso em papel '
    + 'branco, entao a transparencia nao faz diferenca no resultado. Pelo painel isso e '
    + 'automatico: a tela converte a imagem escolhida antes de enviar.';

  if (tipoDeCor === 4 || tipoDeCor === 6) {
    return { erro: 'PNG com transparencia (canal alfa) nao e desenhado no DANFE.', comoResolver };
  }
  if (profundidade > 8) {
    return { erro: `PNG de ${profundidade} bits por canal nao e desenhado no DANFE.`, comoResolver };
  }
  if (entrelacada) {
    return { erro: 'PNG entrelacado (interlaced) nao e desenhado no DANFE.', comoResolver };
  }
  return null;
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
        + 'Exporte como JPG, ou escolha o arquivo pelo painel, que converte sozinho.',
    };
  }

  if (formato.tipo === 'image/png') return conferirPngQueOFpdfDesenha(bytes);

  return null;
}

/** Normaliza a posicao; qualquer coisa fora de L/C/R vira `L`. */
export function normalizarPosicao(valor: unknown): PosicaoDaLogo {
  const p = String(valor ?? '').trim().toUpperCase();
  return p === 'C' || p === 'R' ? p : 'L';
}

/**
 * O teto do texto padrão.
 *
 * `infCpl` vai até 5000 caracteres no leiaute 4.00 — passar disso é rejeição
 * 215 na SEFAZ, não aviso. E esse espaço não é só do texto fixo: divide-se com
 * o que vem no pedido e com o demonstrativo obrigatório de IBS/CBS. 2000 deixa
 * o texto fixo confortável e ainda sobra para os outros dois.
 */
export const LIMITE_DO_TEXTO = 2000;

export function conferirTextoPadrao(texto: unknown): LogoRecusada | null {
  const t = String(texto ?? '');
  if (t.length <= LIMITE_DO_TEXTO) return null;
  return {
    erro: `O texto tem ${t.length} caracteres e o limite e ${LIMITE_DO_TEXTO}.`,
    comoResolver: 'O campo de informacoes complementares da nota vai ate 5000 caracteres e e '
      + 'dividido com o texto do pedido e com o demonstrativo da Reforma Tributaria. '
      + 'Acima disso a SEFAZ rejeita a nota (215).',
  };
}

export class MarcaDoDanfeStore {
  private initialized = false;

  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS webapp_danfe_marca (
        cnpj VARCHAR(14) PRIMARY KEY,
        logo_base64 TEXT,
        posicao VARCHAR(1) NOT NULL DEFAULT 'L',
        atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // A tabela nasceu só com a logo, e obrigatória. Agora guarda também o texto
    // fixo, e cada um dos dois vale sozinho: há empresa que só quer a frase da
    // contabilidade, e há a que só quer a logo. `IF NOT EXISTS` / `DROP NOT
    // NULL` deixam a instalação que já existe alcançar o mesmo formato sem
    // migração manual — nenhuma delas tem psql à mão.
    await this.pool.query(
      'ALTER TABLE webapp_danfe_marca ADD COLUMN IF NOT EXISTS texto_padrao TEXT');
    await this.pool.query(
      'ALTER TABLE webapp_danfe_marca ALTER COLUMN logo_base64 DROP NOT NULL');
    this.initialized = true;
  }

  /** A marca de um emitente, ou `null` quando ele nunca configurou nada. */
  async obter(cnpj: string): Promise<MarcaDoDanfe | null> {
    await this.init();
    const r = await this.pool.query(
      'SELECT cnpj, logo_base64, posicao, texto_padrao, atualizada_em '
      + 'FROM webapp_danfe_marca WHERE cnpj = $1',
      [soDigitos(cnpj)],
    );
    const linha = r.rows[0];
    if (!linha) return null;
    return {
      cnpj: linha.cnpj,
      logoBase64: linha.logo_base64 || undefined,
      posicao: normalizarPosicao(linha.posicao),
      textoPadrao: linha.texto_padrao || undefined,
      atualizadaEm: linha.atualizada_em?.toISOString?.() ?? undefined,
    };
  }

  /**
   * Grava o que veio e preserva o que não veio.
   *
   * `undefined` significa "não mexe", e string vazia significa "apaga". A
   * diferença importa porque a tela salva logo e texto em abas separadas: sem
   * ela, salvar o texto apagaria a logo que já estava lá — e o cliente
   * descobriria isso no primeiro DANFE que imprimisse.
   */
  async salvar(cnpj: string, dados: {
    logoBase64?: string | undefined;
    posicao?: unknown;
    textoPadrao?: string | undefined;
  }): Promise<void> {
    await this.init();
    const atual = await this.obter(cnpj);

    const logo = dados.logoBase64 === undefined
      ? (atual?.logoBase64 ?? null)
      : (String(dados.logoBase64).replace(/^data:image\/[a-z+]+;base64,/i, '').trim() || null);

    const posicao = dados.posicao === undefined
      ? (atual?.posicao ?? 'L')
      : normalizarPosicao(dados.posicao);

    const texto = dados.textoPadrao === undefined
      ? (atual?.textoPadrao ?? null)
      : (String(dados.textoPadrao).trim() || null);

    await this.pool.query(
      `INSERT INTO webapp_danfe_marca (cnpj, logo_base64, posicao, texto_padrao, atualizada_em)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (cnpj) DO UPDATE
         SET logo_base64 = EXCLUDED.logo_base64,
             posicao = EXCLUDED.posicao,
             texto_padrao = EXCLUDED.texto_padrao,
             atualizada_em = NOW()`,
      [soDigitos(cnpj), logo, posicao, texto],
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
