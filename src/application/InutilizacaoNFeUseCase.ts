import { InutilizacaoXmlGenerator, InutilizacaoInput } from '../infrastructure/xml/InutilizacaoXmlGenerator';
import { Signer } from '../infrastructure/crypto/Signer';
import { SoapClient } from '../infrastructure/soap/SoapClient';
import { getEndpoints } from '../infrastructure/soap/SefazEndpoints';

export interface InutilizacaoResult {
  success: boolean;
  cStat: string;
  xMotivo: string;
  nProt?: string;
}

export class InutilizacaoNFeUseCase {
  private xmlGenerator: InutilizacaoXmlGenerator;
  private signer: Signer;
  private soapClient: SoapClient;

  constructor(deps: {
    xmlGenerator: InutilizacaoXmlGenerator;
    signer: Signer;
    soapClient: SoapClient;
  }) {
    this.xmlGenerator = deps.xmlGenerator;
    this.signer = deps.signer;
    this.soapClient = deps.soapClient;
  }

  async execute(input: InutilizacaoInput, uf: string): Promise<InutilizacaoResult> {
    if (!input.xJust || input.xJust.length < 15) {
      throw new Error('Justificativa de inutilizacao deve ter no minimo 15 caracteres');
    }

    const nNFIni = parseInt(input.nNFIni, 10);
    const nNFFin = parseInt(input.nNFFin, 10);
    if (isNaN(nNFIni) || isNaN(nNFFin) || nNFIni > nNFFin) {
      throw new Error('Faixa de numeracao invalida: nNFIni deve ser <= nNFFin');
    }

    const xml = this.xmlGenerator.generate(input);

    const id = `ID${input.cUF}${input.ano}${input.cnpj}${input.mod}${input.serie.padStart(3, '0')}${input.nNFIni.padStart(9, '0')}${input.nNFFin.padStart(9, '0')}`;
    const signedXml = this.signer.sign(xml, id);

    const endpoints = getEndpoints(uf, input.tpAmb as '1' | '2');
    const responseXml = await this.soapClient.send(
      signedXml,
      endpoints.NfeInutilizacao,
      'NfeInutilizacao',
    );

    const cStat = extractField(responseXml, 'cStat');
    const xMotivo = extractField(responseXml, 'xMotivo');
    const nProt = extractField(responseXml, 'nProt') || undefined;

    return {
      success: cStat === '102',
      cStat,
      xMotivo,
      nProt,
    };
  }
}

function extractField(xml: string, field: string): string {
  const match = xml.match(new RegExp(`<${field}>([^<]*)</${field}>`));
  return match ? match[1] : '';
}
