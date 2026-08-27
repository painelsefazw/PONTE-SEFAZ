import { Signer } from '../infrastructure/crypto/Signer';
import { SoapClient } from '../infrastructure/soap/SoapClient';
import { NFeRepository } from '../infrastructure/db/NFeRepository';
import { EventXmlGenerator, CancelamentoInput } from '../infrastructure/xml/EventXmlGenerator';
import { getEndpoints } from '../infrastructure/soap/SefazEndpoints';
import { parseEventoResponse } from '../infrastructure/soap/ResponseParser';
import { NFeStatus } from '../infrastructure/db/migrations';

export interface CancelamentoResult {
  success: boolean;
  chaveAcesso: string;
  cStat: string;
  xMotivo: string;
  nProt?: string;
  xmlEnviado: string;
  xmlRetorno?: string;
}

export class CancelamentoNFeUseCase {
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

  async execute(input: CancelamentoInput, uf: string, ambiente: '1' | '2'): Promise<CancelamentoResult> {
    if (input.xJust.length < 15) {
      throw new Error('Justificativa deve ter no minimo 15 caracteres');
    }

    const loteId = Date.now().toString();
    const xml = this.eventXmlGenerator.generateCancelamento(input, loteId);

    const idEvento = `ID110111${input.chaveAcesso}01`;
    const signedXml = this.signer.sign(xml, idEvento);

    const endpoints = getEndpoints(uf, ambiente);
    const xmlEnviado = signedXml;

    try {
      const responseXml = await this.soapClient.send(
        signedXml,
        endpoints.NFeRecepcaoEvento,
        'NFeRecepcaoEvento',
      );

      const parsed = parseEventoResponse(responseXml);

      const cStat = parsed.infEvento?.cStat || parsed.cStat;
      const xMotivo = parsed.infEvento?.xMotivo || parsed.xMotivo;
      const nProt = parsed.infEvento?.nProt;

      if (cStat === '135' || cStat === '155') {
        await this.repository.updateStatus(input.chaveAcesso, NFeStatus.CANCELADA, {
          cstat: cStat,
          xmotivo: xMotivo,
          nprot: nProt,
        });
      }

      return {
        success: cStat === '135' || cStat === '155',
        chaveAcesso: input.chaveAcesso,
        cStat,
        xMotivo,
        nProt,
        xmlEnviado,
        xmlRetorno: responseXml,
      };
    } catch (error: unknown) {
      throw error;
    }
  }
}
