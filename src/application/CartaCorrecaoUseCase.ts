import { Signer } from '../infrastructure/crypto/Signer';
import { SoapClient } from '../infrastructure/soap/SoapClient';
import { NFeRepository } from '../infrastructure/db/NFeRepository';
import { EventXmlGenerator, CartaCorrecaoInput } from '../infrastructure/xml/EventXmlGenerator';
import { getEndpoints } from '../infrastructure/soap/SefazEndpoints';
import { parseEventoResponse } from '../infrastructure/soap/ResponseParser';

export interface CartaCorrecaoResult {
  success: boolean;
  chaveAcesso: string;
  cStat: string;
  xMotivo: string;
  nProt?: string;
  xmlEnviado: string;
  xmlRetorno?: string;
}

export class CartaCorrecaoUseCase {
  private eventXmlGenerator: EventXmlGenerator;
  private signer: Signer;
  private soapClient: SoapClient;
  private repository: NFeRepository;

  constructor(deps: {
    eventXmlGenerator: EventXmlGenerator;
    signer: Signer;
    soapClient: SoapClient;
    repository: NFeRepository;
  }) {
    this.eventXmlGenerator = deps.eventXmlGenerator;
    this.signer = deps.signer;
    this.soapClient = deps.soapClient;
    this.repository = deps.repository;
  }

  async execute(input: CartaCorrecaoInput, uf: string, ambiente: '1' | '2'): Promise<CartaCorrecaoResult> {
    if (input.xCorrecao.length < 15) {
      throw new Error('Texto de correcao deve ter no minimo 15 caracteres');
    }

    const loteId = Date.now().toString();
    const seqPadded = String(input.nSeqEvento).padStart(2, '0');
    const xml = this.eventXmlGenerator.generateCartaCorrecao(input, loteId);

    const idEvento = `ID110110${input.chaveAcesso}${seqPadded}`;
    const signedXml = this.signer.sign(xml, idEvento);

    const endpoints = getEndpoints(uf, ambiente);

    const responseXml = await this.soapClient.send(
      signedXml,
      endpoints.NFeRecepcaoEvento,
      'NFeRecepcaoEvento',
    );

    const parsed = parseEventoResponse(responseXml);

    const cStat = parsed.infEvento?.cStat || parsed.cStat;
    const xMotivo = parsed.infEvento?.xMotivo || parsed.xMotivo;
    const nProt = parsed.infEvento?.nProt;

    return {
      success: cStat === '135' || cStat === '155',
      chaveAcesso: input.chaveAcesso,
      cStat,
      xMotivo,
      nProt,
      xmlEnviado: signedXml,
      xmlRetorno: responseXml,
    };
  }
}
