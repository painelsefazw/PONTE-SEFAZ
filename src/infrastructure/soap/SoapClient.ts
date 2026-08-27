/**
 * SOAP 1.2 Client para comunicacao com SEFAZ NF-e 4.00
 * Suporta mTLS via certificado PFX (A1).
 * Extrai PEM via node-forge para compatibilidade com PFX modernos (AES-256-CBC).
 */

import axios, { AxiosError } from 'axios';
import * as https from 'https';
import { extractPemFromPfx } from '../crypto/pfxPem';

export class SoapError extends Error {
  public statusCode?: number;
  public soapFault?: string;
  /**
   * `true` quando se SABE que a requisicao nao chegou a ser processada.
   *
   * Sem esta distincao, toda falha de rede vira "a nota PODE ter sido
   * autorizada" — a resposta certa para um timeout e a errada para uma conexao
   * recusada. Quem recebe "pode ter saido" tem de consultar a chave e esperar
   * antes de tentar de novo; quem recebe "nao saiu" tenta de novo e pronto.
   *
   * So e marcado onde nao ha duvida: a conexao nao se estabeleceu, ou o
   * servidor da SEFAZ devolveu indisponibilidade antes de a aplicacao rodar.
   * Timeout, ECONNRESET, HTTP 500 e SOAP Fault ficam de fora de proposito —
   * neles a nota pode ter sido processada e a resposta e que se perdeu.
   */
  public naoTransmitiu?: boolean;

  constructor(message: string, statusCode?: number, soapFault?: string, naoTransmitiu?: boolean) {
    super(message);
    this.name = 'SoapError';
    this.statusCode = statusCode;
    this.soapFault = soapFault;
    this.naoTransmitiu = naoTransmitiu;
  }
}

/**
 * Erros de rede em que a requisicao comprovadamente nao saiu.
 *
 * Nome nao resolvido, conexao recusada, host inalcancavel e falha de handshake
 * TLS acontecem ANTES de qualquer byte do corpo ser processado. `ECONNRESET`
 * NAO entra: o reset pode chegar depois de a SEFAZ ter recebido e autorizado.
 */
const CODIGOS_SEM_CONEXAO = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
  'EPROTO', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED',
]);

/**
 * HTTP que o servidor da frente devolve quando a aplicacao nem rodou.
 *
 * 500 fica de fora: erro interno pode ter acontecido DEPOIS do processamento.
 */
const HTTP_INDISPONIVEL = new Set([502, 503, 504]);

export interface SoapClientOptions {
  timeout?: number;
  pfxBuffer?: Buffer;
  pfxPassword?: string;
}

export class SoapClient {
  private readonly timeout: number;
  private readonly httpsAgent?: https.Agent;

  constructor(options?: SoapClientOptions) {
    this.timeout = options?.timeout ?? 30000;

    if (options?.pfxBuffer) {
      this.httpsAgent = this.createAgent(options.pfxBuffer, options.pfxPassword);
    }
  }

  private createAgent(pfxBuffer: Buffer, password?: string): https.Agent {
    const { cert, key, ca } = this.extractPem(pfxBuffer, password || '');
    return new https.Agent({
      cert,
      key,
      ca,
      rejectUnauthorized: false,
    });
  }

  private extractPem(pfxBuffer: Buffer, password: string): { cert: string; key: string; ca: string[] } {
    return extractPemFromPfx(pfxBuffer, password);
  }

  async send(xml: string, endpoint: string, soapAction: string): Promise<string> {
    const soapEnvelope = this.buildEnvelope(xml, soapAction);

    try {
      const response = await axios.post(endpoint, soapEnvelope, {
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
        },
        timeout: this.timeout,
        httpsAgent: this.httpsAgent,
        responseType: 'text',
        validateStatus: (status: number) => status >= 200 && status < 600,
      });

      const responseData = typeof response.data === 'string'
        ? response.data
        : String(response.data);

      if (this.containsSoapFault(responseData)) {
        const faultMessage = this.extractFaultMessage(responseData);
        throw new SoapError(
          `SOAP Fault recebido do SEFAZ: ${faultMessage}`,
          response.status,
          faultMessage,
        );
      }

      if (response.status >= 400) {
        const snippet = responseData.slice(0, 400).replace(/\s+/g, ' ').trim();
        throw new SoapError(
          `Erro HTTP ${response.status} ao comunicar com SEFAZ: ${snippet}`,
          response.status,
          undefined,
          HTTP_INDISPONIVEL.has(response.status),
        );
      }

      return responseData;
    } catch (error: unknown) {
      if (error instanceof SoapError) {
        throw error;
      }

      if (error instanceof AxiosError) {
        // Timeout continua sendo "nao sei": a SEFAZ pode ter recebido, processado
        // e autorizado — quem se perdeu foi a resposta.
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new SoapError(
            `Timeout ao comunicar com SEFAZ (${this.timeout}ms): ${error.message}`,
          );
        }

        const status = error.response?.status;
        const naoTransmitiu = CODIGOS_SEM_CONEXAO.has(String(error.code))
          || (status !== undefined && HTTP_INDISPONIVEL.has(status));

        throw new SoapError(
          `Erro de comunicacao com SEFAZ: ${error.message}`,
          status,
          undefined,
          naoTransmitiu,
        );
      }

      const msg = error instanceof Error ? error.message : String(error);
      throw new SoapError(`Erro inesperado ao comunicar com SEFAZ: ${msg}`);
    }
  }

  private buildEnvelope(xml: string, soapAction: string): string {
    const wsdlNamespace = this.resolveWsdlNamespace(soapAction);

    // Remove a declaração <?xml?> do conteúdo: dentro do <soap:Body> ela seria uma
    // instrução de processamento no MEIO do documento (XML inválido) e a SEFAZ
    // rejeita com HTTP 400 vazio. Ocorre nos geradores de evento/consulta.
    const inner = xml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">',
      '  <soap12:Header/>',
      '  <soap12:Body>',
      `    <nfeDadosMsg xmlns="${wsdlNamespace}">`,
      `      ${inner}`,
      '    </nfeDadosMsg>',
      '  </soap12:Body>',
      '</soap12:Envelope>',
    ].join('\n');
  }

  private resolveWsdlNamespace(soapAction: string): string {
    const baseNamespace = 'http://www.portalfiscal.inf.br/nfe/wsdl/';

    const servicePairs: Array<[string, string]> = [
      ['cadconsultacadastro', 'CadConsultaCadastro4'],
      ['retautorizacao', 'NFeRetAutorizacao4'],
      ['consultaprotocolo', 'NFeConsultaProtocolo4'],
      ['statusservico', 'NFeStatusServico4'],
      ['inutilizacao', 'NFeInutilizacao4'],
      ['recepcaoevento', 'NFeRecepcaoEvento4'],
      ['distribuicaodfe', 'NFeDistribuicaoDFe'],
      ['autorizacao', 'NFeAutorizacao4'],
    ];

    const actionLower = soapAction.toLowerCase();
    for (const [key, service] of servicePairs) {
      if (actionLower.includes(key)) {
        return `${baseNamespace}${service}`;
      }
    }

    return `${baseNamespace}NFeAutorizacao4`;
  }

  private containsSoapFault(xml: string): boolean {
    return xml.includes('soap12:Fault') || xml.includes('soap:Fault') || xml.includes(':Fault>');
  }

  private extractFaultMessage(xml: string): string {
    const faultStringMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    if (faultStringMatch) {
      return faultStringMatch[1].trim();
    }

    const textMatch = xml.match(/<[^:]*:Text[^>]*>([\s\S]*?)<\/[^:]*:Text>/i);
    if (textMatch) {
      return textMatch[1].trim();
    }

    const reasonMatch = xml.match(/<[^:]*:Reason[^>]*>([\s\S]*?)<\/[^:]*:Reason>/i);
    if (reasonMatch) {
      return reasonMatch[1].trim();
    }

    return 'SOAP Fault sem descricao';
  }
}
