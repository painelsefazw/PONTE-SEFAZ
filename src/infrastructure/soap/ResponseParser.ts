/**
 * Parser de respostas XML SEFAZ NF-e 4.00.
 * Converte respostas SOAP em objetos tipados.
 */

import { convert } from 'xmlbuilder2';

// ============================================================================
// Interfaces de resposta
// ============================================================================

export interface AutorizacaoResponse {
  /** Status code (ex: '104' = Lote processado) */
  cStat: string;
  /** Descricao do status */
  xMotivo: string;
  /** Protocolo de autorizacao (presente quando cStat = '104') */
  protNFe?: {
    infProt: {
      tpAmb: string;
      verAplic: string;
      chNFe: string;
      dhRecbto: string;
      nProt: string;
      digVal: string;
      /** '100' = Autorizada, '120' = Autorizada com alerta, '150' = fora de prazo */
      cStat: string;
      xMotivo: string;
      /** Codigo da mensagem/alerta da SEFAZ (grupo PR13, NT 2018.005 / 2026.002). */
      cMsg?: string;
      /** Mensagem/alerta da SEFAZ para o emissor (cStat 120). */
      xMsg?: string;
    };
  };
}

/**
 * cStat de autorizacao da NF-e/NFC-e no protocolo (infProt).
 *
 * A NT 2026.002 criou o "120 - Autorizado com alerta": a nota E autorizada
 * (tem protocolo, entra no banco), so vem com um aviso. Tratar apenas 100 como
 * autorizada faria a nota autorizada cair no ramo de erro. O 150 (fora de prazo)
 * ja existia e tinha o mesmo risco latente.
 */
export function nfeAutorizada(cStat?: string): boolean {
  return !!cStat && (cStat === '100' || cStat === '120' || cStat === '150');
}

export interface EventoResponse {
  cStat: string;
  xMotivo: string;
  infEvento?: {
    tpAmb: string;
    verAplic: string;
    cOrgao: string;
    cStat: string;
    xMotivo: string;
    chNFe: string;
    tpEvento: string;
    nSeqEvento: string;
    nProt?: string;
    dhRegEvento?: string;
  };
}

export interface ConsultaResponse {
  cStat: string;
  xMotivo: string;
  chNFe: string;
  nProt?: string;
  dhRecbto?: string;
}

export interface StatusServicoResponse {
  tpAmb: string;
  verAplic: string;
  cStat: string;
  xMotivo: string;
  cUF: string;
  dhRecbto: string;
  tMed: string;
}

// ============================================================================
// Funcoes de parsing
// ============================================================================

/**
 * Extrai o retEnviNFe de dentro do SOAP Body da resposta de autorizacao.
 *
 * @param soapXml - XML completo da resposta SOAP
 * @returns Objeto AutorizacaoResponse com os dados extraidos
 * @throws Error se a resposta contiver SOAP Fault ou formato inesperado
 */
export function parseAutorizacaoResponse(soapXml: string): AutorizacaoResponse {
  const obj = convertXmlToObject(soapXml);

  checkSoapFault(obj);

  const retEnviNFe = findElement(obj, 'retEnviNFe');
  if (!retEnviNFe) {
    throw new Error('Elemento retEnviNFe nao encontrado na resposta SOAP');
  }

  const result: AutorizacaoResponse = {
    cStat: extractText(retEnviNFe, 'cStat'),
    xMotivo: extractText(retEnviNFe, 'xMotivo'),
  };

  // Protocolo pode estar diretamente em retEnviNFe ou dentro de protNFe
  const protNFe = findElement(retEnviNFe, 'protNFe');
  if (protNFe) {
    const infProt = findElement(protNFe, 'infProt');
    if (infProt) {
      result.protNFe = {
        infProt: {
          tpAmb: extractText(infProt, 'tpAmb'),
          verAplic: extractText(infProt, 'verAplic'),
          chNFe: extractText(infProt, 'chNFe'),
          dhRecbto: extractText(infProt, 'dhRecbto'),
          nProt: extractText(infProt, 'nProt'),
          digVal: extractText(infProt, 'digVal'),
          cStat: extractText(infProt, 'cStat'),
          xMotivo: extractText(infProt, 'xMotivo'),
          // Grupo PR13 (NT 2018.005/2026.002): mensagem/alerta da SEFAZ, presente
          // sobretudo no cStat 120. best-effort: extrai o primeiro alerta.
          cMsg: extractText(infProt, 'cMsg') || undefined,
          xMsg: extractText(infProt, 'xMsg') || undefined,
        },
      };
    }
  }

  return result;
}

/**
 * Extrai o retConsStatServ de dentro do SOAP Body da resposta de status de servico.
 *
 * @param soapXml - XML completo da resposta SOAP
 * @returns Objeto StatusServicoResponse com os dados extraidos
 * @throws Error se a resposta contiver SOAP Fault ou formato inesperado
 */
export function parseStatusServicoResponse(soapXml: string): StatusServicoResponse {
  const obj = convertXmlToObject(soapXml);

  checkSoapFault(obj);

  const retConsStatServ = findElement(obj, 'retConsStatServ');
  if (!retConsStatServ) {
    throw new Error('Elemento retConsStatServ nao encontrado na resposta SOAP');
  }

  return {
    tpAmb: extractText(retConsStatServ, 'tpAmb'),
    verAplic: extractText(retConsStatServ, 'verAplic'),
    cStat: extractText(retConsStatServ, 'cStat'),
    xMotivo: extractText(retConsStatServ, 'xMotivo'),
    cUF: extractText(retConsStatServ, 'cUF'),
    dhRecbto: extractText(retConsStatServ, 'dhRecbto'),
    tMed: extractText(retConsStatServ, 'tMed'),
  };
}

export function parseEventoResponse(soapXml: string): EventoResponse {
  const obj = convertXmlToObject(soapXml);
  checkSoapFault(obj);

  const retEnvEvento = findElement(obj, 'retEnvEvento');
  if (!retEnvEvento) {
    throw new Error('Elemento retEnvEvento nao encontrado na resposta SOAP');
  }

  const result: EventoResponse = {
    cStat: extractText(retEnvEvento, 'cStat'),
    xMotivo: extractText(retEnvEvento, 'xMotivo'),
  };

  const retEvento = findElement(retEnvEvento, 'retEvento');
  if (retEvento) {
    const infEvento = findElement(retEvento, 'infEvento');
    if (infEvento) {
      result.infEvento = {
        tpAmb: extractText(infEvento, 'tpAmb'),
        verAplic: extractText(infEvento, 'verAplic'),
        cOrgao: extractText(infEvento, 'cOrgao'),
        cStat: extractText(infEvento, 'cStat'),
        xMotivo: extractText(infEvento, 'xMotivo'),
        chNFe: extractText(infEvento, 'chNFe'),
        tpEvento: extractText(infEvento, 'tpEvento'),
        nSeqEvento: extractText(infEvento, 'nSeqEvento'),
        nProt: extractText(infEvento, 'nProt') || undefined,
        dhRegEvento: extractText(infEvento, 'dhRegEvento') || undefined,
      };
    }
  }

  return result;
}

export function parseConsultaResponse(soapXml: string): ConsultaResponse {
  const obj = convertXmlToObject(soapXml);
  checkSoapFault(obj);

  const retConsSitNFe = findElement(obj, 'retConsSitNFe');
  if (!retConsSitNFe) {
    throw new Error('Elemento retConsSitNFe nao encontrado na resposta SOAP');
  }

  const protNFe = findElement(retConsSitNFe, 'protNFe');
  const infProt = protNFe ? findElement(protNFe, 'infProt') : null;

  return {
    cStat: infProt ? extractText(infProt, 'cStat') : extractText(retConsSitNFe, 'cStat'),
    xMotivo: infProt ? extractText(infProt, 'xMotivo') : extractText(retConsSitNFe, 'xMotivo'),
    chNFe: infProt ? extractText(infProt, 'chNFe') : extractText(retConsSitNFe, 'chNFe'),
    nProt: infProt ? (extractText(infProt, 'nProt') || undefined) : undefined,
    dhRecbto: infProt ? (extractText(infProt, 'dhRecbto') || undefined) : undefined,
  };
}

// ============================================================================
// Inutilização
// ============================================================================

export interface InutilizacaoResponse {
  cStat: string;
  xMotivo: string;
  nProt?: string;
}

export function parseInutilizacaoResponse(soapXml: string): InutilizacaoResponse {
  const obj = convertXmlToObject(soapXml);
  checkSoapFault(obj);

  const retInut = findElement(obj, 'retInutNFe');
  if (!retInut) {
    throw new Error('Elemento retInutNFe nao encontrado na resposta SOAP');
  }

  const infInut = findElement(retInut, 'infInut');
  const src = infInut || retInut;

  return {
    cStat: extractText(src, 'cStat'),
    xMotivo: extractText(src, 'xMotivo'),
    nProt: extractText(src, 'nProt') || undefined,
  };
}

// ============================================================================
// Helpers internos
// ============================================================================

/**
 * Converte XML string para objeto JS usando xmlbuilder2.
 */
function convertXmlToObject(xml: string): Record<string, unknown> {
  try {
    return convert(xml, { format: 'object' }) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao parsear XML da resposta SEFAZ: ${msg}`);
  }
}

/**
 * Verifica se o objeto contem um SOAP Fault e lanca erro se encontrado.
 */
function checkSoapFault(obj: Record<string, unknown>): void {
  const fault = findElement(obj, 'Fault') ?? findElement(obj, 'soap12:Fault') ?? findElement(obj, 'soap:Fault');
  if (fault) {
    const faultString = extractText(fault, 'faultstring')
      || extractText(fault, 'Text')
      || 'SOAP Fault sem descricao';
    throw new Error(`SOAP Fault: ${faultString}`);
  }
}

/**
 * Busca recursivamente um elemento pelo nome (ignorando namespace prefixes)
 * dentro de um objeto aninhado produzido por xmlbuilder2 convert.
 */
function findElement(obj: unknown, elementName: string): Record<string, unknown> | null {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return null;
  }

  const record = obj as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    // Checa match direto ou match sem namespace prefix
    const localName = key.includes(':') ? key.split(':').pop()! : key;

    if (localName === elementName || key === elementName) {
      const value = record[key];
      if (typeof value === 'object' && value !== null) {
        return value as Record<string, unknown>;
      }
    }

    // Busca recursiva nos filhos
    const found = findElement(record[key], elementName);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Extrai o valor texto de um elemento filho, lidando com namespace prefixes
 * e com a estrutura { '#': 'valor' } que xmlbuilder2 pode produzir.
 */
function extractText(parent: Record<string, unknown>, childName: string): string {
  for (const key of Object.keys(parent)) {
    const localName = key.includes(':') ? key.split(':').pop()! : key;

    if (localName === childName || key === childName) {
      const value = parent[key];

      if (typeof value === 'string') {
        return value;
      }

      if (typeof value === 'number') {
        return String(value);
      }

      // xmlbuilder2 pode retornar { '#': 'texto' } para elementos com texto
      if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        if ('#' in record && typeof record['#'] === 'string') {
          return record['#'];
        }
        // Tambem pode ser { '$': {...attrs}, '#': 'texto' }
        if ('#' in record) {
          return String(record['#']);
        }
      }

      return '';
    }
  }

  return '';
}
