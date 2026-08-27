import * as https from 'https';
import * as zlib from 'zlib';
import { extractPemFromPfx } from '../crypto/pfxPem';

/**
 * Cliente do SEFIN Nacional (NFS-e).
 *
 * Diferente da SEFAZ, que fala SOAP: aqui o transporte é REST com JSON, mas o
 * documento fiscal continua sendo XML assinado — compactado em gzip e
 * codificado em base64 dentro do corpo.
 *
 * A autenticação é mTLS com o mesmo certificado A1 usado na NF-e. Sem ele a
 * API responde 403 em tudo, inclusive na documentação.
 */

export interface SefinConfig {
  pfx: Buffer;
  senhaPfx: string;
  /** '1' produção, '2' produção restrita (testes). */
  ambiente: '1' | '2';
  timeoutMs?: number;
}

export interface SefinMensagem {
  codigo?: string;
  descricao?: string;
  complemento?: string;
}

export interface SefinRespostaEmissao {
  sucesso: boolean;
  /** Chave de acesso da NFS-e — 50 posições. */
  chaveAcesso?: string;
  idDps?: string;
  /** XML da NFS-e já descompactado. */
  nfseXml?: string;
  dataHoraProcessamento?: string;
  alertas?: SefinMensagem[];
  erros?: SefinMensagem[];
  httpStatus: number;
}

/**
 * A API mistura convenções: o corpo de sucesso usa `idDps` e o de erro `idDPS`;
 * as mensagens vêm com inicial maiúscula (`Codigo`, `Descricao`) enquanto o
 * resto do JSON é camelCase. Normaliza para não vazar isso adiante.
 */
function normalizarMensagens(lista: unknown): SefinMensagem[] | undefined {
  if (!Array.isArray(lista) || !lista.length) return undefined;
  return lista.map((m: any) => ({
    codigo: m?.Codigo ?? m?.codigo,
    descricao: m?.Descricao ?? m?.descricao,
    complemento: m?.Complemento ?? m?.complemento,
  }));
}

/**
 * A lista de erros muda de nome conforme o serviço: a emissão devolve `erros`
 * e o registro de evento devolve `erro`, no singular. Sem tratar os dois, o
 * erro do cancelamento chega como corpo bruto e o código se perde.
 */
function extrairErros(json: any): SefinMensagem[] | undefined {
  return normalizarMensagens(json?.erros)
    ?? normalizarMensagens(json?.erro)
    ?? normalizarMensagens(json?.Erros)
    ?? normalizarMensagens(json?.Erro);
}

/**
 * Sempre devolve algo utilizável.
 *
 * A SEFIN às vezes recusa sem dizer o motivo — responde 500 com `"erro": []`,
 * que foi o que apareceu ao pedir evento sobre nota inexistente. Repassar o
 * corpo bruto nesses casos entrega um JSON no lugar de uma mensagem, então a
 * lista vazia vira um texto que ao menos diz o status.
 */
function errosOuFallback(json: any, status: number, corpo: string): SefinMensagem[] {
  const erros = extrairErros(json);
  if (erros) return erros;

  const temListaVazia = Array.isArray(json?.erros) || Array.isArray(json?.erro);
  if (temListaVazia) {
    return [{
      codigo: `HTTP_${status}`,
      descricao: `A SEFIN recusou com HTTP ${status} e não detalhou o motivo. `
        + 'Costuma ser documento inexistente ou fora do prazo do município.',
    }];
  }

  return [{ codigo: `HTTP_${status}`, descricao: corpo.slice(0, 400) || 'Resposta vazia' }];
}

const HOSTS = {
  '1': 'sefin.nfse.gov.br',
  '2': 'sefin.producaorestrita.nfse.gov.br',
} as const;

/**
 * O ADN é outro serviço, com host próprio. O DANFSE oficial mora lá — o
 * `/DANFSe` do SEFIN só responde 501 dizendo que mudou de endereço.
 */
const HOSTS_ADN = {
  '1': 'adn.nfse.gov.br',
  '2': 'adn.producaorestrita.nfse.gov.br',
} as const;

const BASE_PATH = '/SefinNacional';

export class SefinClient {
  constructor(private readonly cfg: SefinConfig) {}

  private get host(): string {
    return HOSTS[this.cfg.ambiente];
  }

  // mTLS: o PFX vira PEM via node-forge (mesmo caminho da NF-e). Passar o `.pfx`
  // cru pro `https` do Node quebra no OpenSSL 3 da Vercel ("Unsupported PKCS12
  // PFX data") com certificado A1 brasileiro. Extrai uma vez e reaproveita.
  private _pem?: { cert: string; key: string; ca: string[] };
  private get pem(): { cert: string; key: string; ca: string[] } {
    if (!this._pem) this._pem = extractPemFromPfx(this.cfg.pfx, this.cfg.senhaPfx);
    return this._pem;
  }

  /** Emite a NFS-e a partir do DPS já assinado. Síncrono: a nota volta na resposta. */
  async emitir(dpsXmlAssinado: string): Promise<SefinRespostaEmissao> {
    const corpo = { dpsXmlGZipB64: compactar(dpsXmlAssinado) };
    const r = await this.requisitar('POST', `${BASE_PATH}/nfse`, corpo);

    let json: any = {};
    try { json = JSON.parse(r.corpo); } catch { /* resposta não-JSON cai no erro abaixo */ }

    if (r.status >= 200 && r.status < 300 && json.chaveAcesso) {
      return {
        sucesso: true,
        chaveAcesso: json.chaveAcesso,
        idDps: json.idDps ?? json.idDPS,
        nfseXml: json.nfseXmlGZipB64 ? descompactar(json.nfseXmlGZipB64) : undefined,
        dataHoraProcessamento: json.dataHoraProcessamento,
        alertas: normalizarMensagens(json.alertas),
        httpStatus: r.status,
      };
    }

    return {
      sucesso: false,
      idDps: json.idDps ?? json.idDPS,
      erros: errosOuFallback(json, r.status, r.corpo),
      dataHoraProcessamento: json.dataHoraProcessamento,
      httpStatus: r.status,
    };
  }

  /**
   * Diz se já existe NFS-e para aquele DPS.
   *
   * É o que torna a emissão segura em caso de timeout: em vez de reenviar às
   * cegas — que geraria nota duplicada — pergunta-se antes.
   */
  async jaEmitida(idDps: string): Promise<boolean> {
    const r = await this.requisitar('HEAD', `${BASE_PATH}/dps/${encodeURIComponent(idDps)}`);
    return r.status >= 200 && r.status < 300;
  }

  /** Chave de acesso a partir do Id do DPS. */
  async consultarPorDps(idDps: string): Promise<string | null> {
    const r = await this.requisitar('GET', `${BASE_PATH}/dps/${encodeURIComponent(idDps)}`);
    if (r.status < 200 || r.status >= 300) return null;
    try { return JSON.parse(r.corpo).chaveAcesso ?? null; } catch { return null; }
  }

  /** NFS-e completa pela chave de acesso. */
  async consultar(chaveAcesso: string): Promise<{ sucesso: boolean; nfseXml?: string; httpStatus: number }> {
    const r = await this.requisitar('GET', `${BASE_PATH}/nfse/${encodeURIComponent(chaveAcesso)}`);
    if (r.status < 200 || r.status >= 300) return { sucesso: false, httpStatus: r.status };
    try {
      const j = JSON.parse(r.corpo);
      return {
        sucesso: true,
        nfseXml: j.nfseXmlGZipB64 ? descompactar(j.nfseXmlGZipB64) : undefined,
        httpStatus: r.status,
      };
    } catch {
      return { sucesso: false, httpStatus: r.status };
    }
  }

  /**
   * Eventos registrados sobre a nota.
   *
   * Sem isso o status guardado aqui pode divergir da realidade: o município
   * pode cancelar de ofício (e305101), bloquear a nota (e305102) ou o tomador
   * pode rejeitá-la, e nada disso passa pelo nosso sistema. Consultar é o único
   * jeito de saber.
   *
   * O `numSeqEvento` distingue eventos repetíveis; cancelamento só ocorre uma
   * vez, então é sempre 1.
   */
  async consultarEvento(
    chaveAcesso: string,
    tipoEvento: string,
    numSeqEvento = 1,
  ): Promise<{ sucesso: boolean; eventoXml?: string; httpStatus: number }> {
    const r = await this.requisitar(
      'GET',
      `${BASE_PATH}/nfse/${encodeURIComponent(chaveAcesso)}/eventos/`
      + `${encodeURIComponent(tipoEvento)}/${numSeqEvento}`,
    );
    if (r.status < 200 || r.status >= 300) return { sucesso: false, httpStatus: r.status };
    try {
      const j = JSON.parse(r.corpo);
      return {
        sucesso: true,
        eventoXml: j.eventoXmlGZipB64 ? descompactar(j.eventoXmlGZipB64) : undefined,
        httpStatus: r.status,
      };
    } catch {
      return { sucesso: false, httpStatus: r.status };
    }
  }

  /** Registra evento sobre a nota — cancelamento, por exemplo. */
  async registrarEvento(chaveAcesso: string, eventoXmlAssinado: string): Promise<SefinRespostaEmissao> {
    const corpo = { pedidoRegistroEventoXmlGZipB64: compactar(eventoXmlAssinado) };
    const r = await this.requisitar('POST', `${BASE_PATH}/nfse/${encodeURIComponent(chaveAcesso)}/eventos`, corpo);

    let json: any = {};
    try { json = JSON.parse(r.corpo); } catch { /* idem */ }

    const ok = r.status >= 200 && r.status < 300;
    return {
      sucesso: ok,
      chaveAcesso: json.chaveAcesso,
      nfseXml: json.eventoXmlGZipB64 ? descompactar(json.eventoXmlGZipB64) : undefined,
      dataHoraProcessamento: json.dataHoraProcessamento,
      alertas: normalizarMensagens(json.alertas),
      erros: ok ? undefined : errosOuFallback(json, r.status, r.corpo),
      httpStatus: r.status,
    };
  }

  /**
   * DANFSE oficial, gerado pelo ADN.
   *
   * Duas coisas para saber antes de depender disto:
   *
   * 1. Mora no ADN, não no SEFIN — o `/DANFSe` do SEFIN responde 501 dizendo
   *    que mudou de endereço.
   * 2. **O módulo não existe na produção restrita**: lá qualquer caminho de
   *    `/danfse` devolve 404 sem corpo, enquanto em produção devolve 404
   *    tipado (`application/problem+json`) para nota inexistente. Ou seja, em
   *    homologação não dá para testar — só o gerador local funciona.
   *
   * Devolve o PDF em binário. Quem chama decide o que fazer quando falha; o
   * caso de uso cai no DANFSE simplificado.
   */
  async danfseOficial(chaveAcesso: string): Promise<{ sucesso: boolean; pdf?: Buffer; httpStatus: number }> {
    const r = await this.requisitarBinario(
      HOSTS_ADN[this.cfg.ambiente],
      `/danfse/${encodeURIComponent(chaveAcesso.replace(/\D/g, ''))}`,
    );
    const pdf = r.corpo;
    // Confere a assinatura do PDF: um 200 com HTML de erro não serve.
    const ehPdf = pdf.length > 4 && pdf.subarray(0, 5).toString('latin1') === '%PDF-';
    return {
      sucesso: r.status >= 200 && r.status < 300 && ehPdf,
      pdf: ehPdf ? pdf : undefined,
      httpStatus: r.status,
    };
  }

  /**
   * Documentos fiscais de serviço da empresa no ambiente nacional.
   *
   * Este é o caminho que funciona hoje. Emitir pelo Emissor Nacional exige que
   * o município seja aderente a ele, e nenhum dos nossos é — todos usam emissor
   * próprio. Mas todos são aderentes ao **Ambiente** Nacional, o que significa
   * que as NFS-e emitidas pelo sistema da prefeitura chegam aqui e podem ser
   * baixadas pelo contribuinte com o certificado dele.
   *
   * A leitura é incremental por NSU: cada documento tem um número sequencial, e
   * pede-se a partir do último já visto. NSU 0 traz desde o começo.
   *
   * O serviço limita a frequência — responde 429 sem corpo JSON quando se pede
   * rápido demais. Quem chama precisa espaçar.
   */
  async distribuirDFe(nsu: number, opts: { cnpjConsulta?: string } = {}): Promise<{
    sucesso: boolean;
    status?: string;
    documentos: { nsu: number; chaveAcesso: string; tipo: string; xml?: string; geradoEm?: string }[];
    ultimoNsu: number;
    limiteAtingido: boolean;
    httpStatus: number;
  }> {
    const query = opts.cnpjConsulta ? `?cnpjConsulta=${encodeURIComponent(opts.cnpjConsulta)}` : '';
    const r = await this.requisitar(
      'GET',
      `/contribuintes/DFe/${Math.max(0, Math.floor(nsu))}${query}`,
      undefined,
      HOSTS_ADN[this.cfg.ambiente],
    );

    // 429 vem como HTML, não JSON — tratar antes de tentar o parse.
    if (r.status === 429) {
      return { sucesso: false, documentos: [], ultimoNsu: nsu, limiteAtingido: true, httpStatus: 429 };
    }

    let json: any = {};
    try { json = JSON.parse(r.corpo); } catch { /* resposta não-JSON */ }

    const lote: any[] = Array.isArray(json.LoteDFe) ? json.LoteDFe : [];
    const documentos = lote.map((d) => ({
      nsu: Number(d.NSU),
      chaveAcesso: String(d.ChaveAcesso || ''),
      tipo: String(d.TipoDocumento || ''),
      xml: d.ArquivoXml ? descompactarSeguro(d.ArquivoXml) : undefined,
      geradoEm: d.DataHoraGeracao,
    }));

    return {
      sucesso: r.status >= 200 && r.status < 300,
      status: json.StatusProcessamento,
      documentos,
      // Continua de onde parou; se o lote veio vazio, não anda.
      ultimoNsu: documentos.reduce((max, d) => Math.max(max, d.nsu), nsu),
      limiteAtingido: false,
      httpStatus: r.status,
    };
  }

  private requisitarBinario(host: string, caminho: string): Promise<{ status: number; corpo: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          path: caminho,
          method: 'GET',
          cert: this.pem.cert,
          key: this.pem.key,
          ca: this.pem.ca,
          rejectUnauthorized: false,
          timeout: this.cfg.timeoutMs ?? 30000,
          headers: { Accept: 'application/pdf' },
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (c) => partes.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes) }));
        },
      );
      req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT_ADN: sem resposta ao pedir o DANFSE.')); });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Convênio do município com o Sistema Nacional.
   *
   * São duas adesões diferentes, e confundi-las custa caro:
   *
   *   `aderenteEmissorNacional`  — a prefeitura **emite** pelo Sistema
   *                                Nacional. Sem isso, emitir devolve E0039.
   *   `aderenteAmbienteNacional` — as notas emitidas pelo sistema próprio da
   *                                prefeitura chegam ao ambiente nacional e
   *                                podem ser **baixadas** pelo contribuinte.
   *
   * A segunda é comum; a primeira, não. Município aderente só ao ambiente
   * aparece na distribuição e recusa a emissão — que é exatamente o caso de
   * quem emite por sistema próprio.
   */
  async convenioMunicipio(codigoMunicipio: string): Promise<{
    sucesso: boolean;
    podeEmitir: boolean;
    podeBaixar: boolean;
    dados?: Record<string, unknown>;
    httpStatus: number;
    erro?: string;
  }> {
    const cod = String(codigoMunicipio).replace(/\D/g, '');
    const r = await this.requisitar(
      'GET',
      `/contribuintes/parametrizacao/${cod}/convenio`,
      undefined,
      HOSTS_ADN[this.cfg.ambiente],
    );

    let json: any = {};
    try { json = JSON.parse(r.corpo); } catch { /* resposta não-JSON cai no erro abaixo */ }

    const ok = r.status >= 200 && r.status < 300;
    // O ADN devolve 1/0; alguns campos vêm como booleano. Aceita os dois.
    const ligado = (v: unknown) => v === 1 || v === '1' || v === true;

    return {
      sucesso: ok,
      podeEmitir: ok && ligado(json.aderenteEmissorNacional),
      podeBaixar: ok && ligado(json.aderenteAmbienteNacional),
      dados: ok ? json : undefined,
      httpStatus: r.status,
      erro: ok ? undefined : (json.mensagem || json.message || `HTTP ${r.status}`),
    };
  }

  private requisitar(
    metodo: 'GET' | 'POST' | 'HEAD',
    caminho: string,
    corpo?: unknown,
    host?: string,
  ): Promise<{ status: number; corpo: string }> {
    const dados = corpo === undefined ? undefined : Buffer.from(JSON.stringify(corpo), 'utf-8');

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host ?? this.host,
          path: caminho,
          method: metodo,
          cert: this.pem.cert,
          key: this.pem.key,
          ca: this.pem.ca,
          rejectUnauthorized: false,
          timeout: this.cfg.timeoutMs ?? 30000,
          headers: {
            Accept: 'application/json',
            ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}),
          },
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (c) => partes.push(c));
          res.on('end', () => resolve({
            status: res.statusCode ?? 0,
            corpo: Buffer.concat(partes).toString('utf-8'),
          }));
        },
      );

      // Timeout não é falha de emissão: a nota pode ter sido gerada do outro
      // lado. Quem chama deve consultar por HEAD /dps/{id} antes de reenviar.
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('TIMEOUT_SEFIN: sem resposta. Consulte jaEmitida(idDps) antes de reenviar.'));
      });
      req.on('error', reject);

      if (dados) req.write(dados);
      req.end();
    });
  }
}

/** XML → gzip → base64, como a API exige no corpo. */
export function compactar(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, 'utf-8')).toString('base64');
}

/**
 * Igual a descompactar, mas sem derrubar o lote por um documento ruim.
 *
 * A distribuicao traz ate 50 XMLs de uma vez; um deles corrompido nao pode
 * fazer perder os outros 49.
 */
function descompactarSeguro(base64: string): string | undefined {
  try { return descompactar(base64); } catch { return undefined; }
}

/** Caminho inverso, para ler o que a API devolve. */
export function descompactar(base64: string): string {
  return zlib.gunzipSync(Buffer.from(base64, 'base64')).toString('utf-8');
}
