import { StatusServicoXmlGenerator } from '../infrastructure/xml/StatusServicoXmlGenerator';
import { SoapClient } from '../infrastructure/soap/SoapClient';
import { parseStatusServicoResponse, StatusServicoResponse } from '../infrastructure/soap/ResponseParser';
import { getEndpoints } from '../infrastructure/soap/SefazEndpoints';

export interface StatusServicoResult {
  online: boolean;
  cStat: string;
  xMotivo: string;
  tMed: string;
  dhRecbto: string;
}

export class StatusServicoUseCase {
  private xmlGenerator: StatusServicoXmlGenerator;
  private soapClient: SoapClient;

  constructor(deps: {
    xmlGenerator: StatusServicoXmlGenerator;
    soapClient: SoapClient;
  }) {
    this.xmlGenerator = deps.xmlGenerator;
    this.soapClient = deps.soapClient;
  }

  async execute(uf: string, ambiente: '1' | '2', cUF: string): Promise<StatusServicoResult> {
    const xml = this.xmlGenerator.generate(ambiente, cUF);

    const endpoints = getEndpoints(uf, ambiente);
    const responseXml = await this.soapClient.send(
      xml,
      endpoints.NfeStatusServico,
      'NfeStatusServico',
    );

    const parsed: StatusServicoResponse = parseStatusServicoResponse(responseXml);

    return {
      online: parsed.cStat === '107',
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      tMed: parsed.tMed,
      dhRecbto: parsed.dhRecbto,
    };
  }
}
