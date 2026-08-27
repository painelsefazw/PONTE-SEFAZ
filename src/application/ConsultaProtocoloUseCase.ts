import { SoapClient } from '../infrastructure/soap/SoapClient';
import { NFeRepository } from '../infrastructure/db/NFeRepository';
import { NFeStatus } from '../infrastructure/db/migrations';
import { getEndpoints } from '../infrastructure/soap/SefazEndpoints';
import { parseConsultaResponse, ConsultaResponse } from '../infrastructure/soap/ResponseParser';
import { ConsultaXmlGenerator } from '../infrastructure/xml/ConsultaXmlGenerator';

export interface ConsultaResult {
  chaveAcesso: string;
  cStat: string;
  xMotivo: string;
  nProt?: string;
  dhRecbto?: string;
}

const STATUS_MAP: Record<string, NFeStatus> = {
  '100': NFeStatus.AUTORIZADA,
  '101': NFeStatus.CANCELADA,
  '110': NFeStatus.DENEGADA,
  '301': NFeStatus.DENEGADA,
  '302': NFeStatus.DENEGADA,
};

export class ConsultaProtocoloUseCase {
  private readonly xmlGenerator = new ConsultaXmlGenerator();

  constructor(
    private readonly soapClient: SoapClient,
    private readonly repository: NFeRepository,
  ) {}

  async execute(
    chaveAcesso: string,
    uf: string,
    ambiente: '1' | '2',
  ): Promise<ConsultaResult> {
    const xml = this.xmlGenerator.generate(chaveAcesso, ambiente);
    const endpoints = getEndpoints(uf, ambiente);
    const responseXml = await this.soapClient.send(
      xml,
      endpoints.NfeConsultaProtocolo,
      'NfeConsultaProtocolo',
    );

    const parsed: ConsultaResponse = parseConsultaResponse(responseXml);

    const mappedStatus = STATUS_MAP[parsed.cStat];
    if (mappedStatus) {
      const existing = await this.repository.findByChave(chaveAcesso);
      if (existing) {
        await this.repository.updateStatus(
          chaveAcesso,
          mappedStatus,
          {
            cstat: parsed.cStat,
            xmotivo: parsed.xMotivo,
            nprot: parsed.nProt,
          },
        );
      }
    }

    return {
      chaveAcesso: parsed.chNFe,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      nProt: parsed.nProt,
      dhRecbto: parsed.dhRecbto,
    };
  }
}
