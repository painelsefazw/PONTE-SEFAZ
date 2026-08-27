/**
 * TransmissaoNFeUseCase — Orchestrates NF-e XML generation, signing, SOAP
 * transmission, and persistence for the NF-e 4.00 authorization flow.
 */

import { NFe, TipoAmbiente } from '../domain/models';
import { generateAccessKey } from '../domain/NFeKeyGenerator';
import { XmlGenerator } from '../infrastructure/xml/XmlGenerator';
import { Signer } from '../infrastructure/crypto/Signer';
import { SoapClient } from '../infrastructure/soap/SoapClient';
import { parseAutorizacaoResponse, AutorizacaoResponse } from '../infrastructure/soap/ResponseParser';
import { getEndpoints } from '../infrastructure/soap/SefazEndpoints';
import { NFeRepository } from '../infrastructure/db/NFeRepository';
import { NFeStatus } from '../infrastructure/db/migrations';

export interface TransmissaoResult {
  success: boolean;
  chaveAcesso: string;
  cStat: string;
  xMotivo: string;
  nProt?: string;
  xmlEnviado: string;
  xmlRetorno?: string;
}

export class TransmissaoNFeUseCase {
  private xmlGenerator: XmlGenerator;
  private signer: Signer;
  private soapClient: SoapClient;
  private repository: NFeRepository;

  constructor(deps: {
    xmlGenerator: XmlGenerator;
    signer: Signer;
    soapClient: SoapClient;
    repository: NFeRepository;
  }) {
    this.xmlGenerator = deps.xmlGenerator;
    this.signer = deps.signer;
    this.soapClient = deps.soapClient;
    this.repository = deps.repository;
  }

  async execute(nfe: NFe, uf: string, ambiente: TipoAmbiente): Promise<TransmissaoResult> {
    // 1. Generate access key
    const { chave: chaveAcesso, cDV } = generateAccessKey({
      cUF: nfe.ide.cUF,
      dhEmi: nfe.ide.dhEmi,
      cnpj: nfe.emit.CNPJ || nfe.emit.CPF || '',
      mod: nfe.ide.mod,
      serie: nfe.ide.serie,
      nNF: nfe.ide.nNF,
      tpEmis: nfe.ide.tpEmis,
      cNF: nfe.ide.cNF,
    });

    let xmlEnviado = '';

    try {
      // 2. Generate XML
      const xml = this.xmlGenerator.generateInfNFe(nfe, chaveAcesso);

      // 3. Sign XML
      const signedXml = this.signer.sign(xml, `NFe${chaveAcesso}`);

      // 4. Wrap in envelope
      const envelope = this.xmlGenerator.wrapEnvelope(signedXml, Date.now().toString());
      xmlEnviado = envelope;

      // 5. Save to DB with status PENDENTE
      await this.repository.save({
        chaveAcesso,
        numero: nfe.ide.nNF,
        serie: nfe.ide.serie,
        cnpjEmitente: nfe.emit.CNPJ || nfe.emit.CPF || '',
        ambiente: ambiente as string,
        xmlEnviado: envelope,
      });

      // 6. Get SEFAZ endpoint
      const endpoints = getEndpoints(uf, ambiente as '1' | '2');

      // 7. Send via SOAP
      const responseXml = await this.soapClient.send(
        envelope,
        endpoints.NfeAutorizacao,
        'NfeAutorizacao',
      );

      // 8. Parse response
      const parsed: AutorizacaoResponse = parseAutorizacaoResponse(responseXml);

      // Determine cStat and xMotivo from protocol level if available
      const cStat = parsed.protNFe?.infProt?.cStat || parsed.cStat;
      const xMotivo = parsed.protNFe?.infProt?.xMotivo || parsed.xMotivo;
      const nProt = parsed.protNFe?.infProt?.nProt;

      // 9. Update DB status based on cStat
      let dbStatus: NFeStatus;
      if (cStat === '100') {
        dbStatus = NFeStatus.AUTORIZADA;
      } else if (cStat === '110' || cStat === '301' || cStat === '302') {
        dbStatus = NFeStatus.DENEGADA;
      } else {
        dbStatus = NFeStatus.REJEITADA;
      }

      await this.repository.updateStatus(chaveAcesso, dbStatus, {
        cstat: cStat,
        xmotivo: xMotivo,
        nprot: nProt,
        xmlRetorno: responseXml,
      });

      // 10. Return result
      return {
        success: cStat === '100',
        chaveAcesso,
        cStat,
        xMotivo,
        nProt,
        xmlEnviado,
        xmlRetorno: responseXml,
      };
    } catch (error: unknown) {
      // Update DB status to ERRO on any failure
      try {
        await this.repository.updateStatus(chaveAcesso, NFeStatus.ERRO, {
          xmotivo: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Swallow DB update error to not mask the original error
      }

      throw error;
    }
  }
}
