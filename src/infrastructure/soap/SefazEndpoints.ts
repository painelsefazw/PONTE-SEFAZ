/**
 * SEFAZ NF-e 4.00 Web Service Endpoints por UF e Ambiente
 */

export interface SefazEndpointMap {
  NfeAutorizacao: string;
  NfeRetAutorizacao: string;
  NfeConsultaProtocolo: string;
  NfeStatusServico: string;
  NfeInutilizacao: string;
  NFeRecepcaoEvento: string;
}

export const ENDPOINTS_HOMOLOGACAO: Record<string, SefazEndpointMap> = {
  AM: {
    NfeAutorizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
    NfeStatusServico: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    NfeInutilizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://homnfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
  },
  BA: {
    NfeAutorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    NfeStatusServico: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
    NfeInutilizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  GO: {
    NfeAutorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4',
    NfeInutilizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4',
  },
  MG: {
    NfeAutorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    NfeInutilizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
  },
  MS: {
    NfeAutorizacao: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeStatusServico4',
    NfeInutilizacao: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://homologacao.nfe.ms.gov.br/ws/NFeRecepcaoEvento4',
  },
  MT: {
    NfeAutorizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
    NfeStatusServico: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
    NfeInutilizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4',
  },
  PE: {
    NfeAutorizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
    NfeInutilizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4',
  },
  PR: {
    NfeAutorizacao: 'https://homologacao.nfe.sefaz.pr.gov.br/nfe/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://homologacao.nfe.sefaz.pr.gov.br/nfe/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homologacao.nfe.sefaz.pr.gov.br/nfe/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://homologacao.nfe.sefaz.pr.gov.br/nfe/NFeStatusServico4',
    NfeInutilizacao: 'https://homologacao.nfe.sefaz.pr.gov.br/nfe/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://homologacao.nfe.sefaz.pr.gov.br/nfe/NFeRecepcaoEvento4',
  },
  RS: {
    NfeAutorizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  SP: {
    NfeAutorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
    NfeRetAutorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
    NfeConsultaProtocolo: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
    NfeStatusServico: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
    NfeInutilizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
  },
  SVRS: {
    NfeAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  SVAN: {
    NfeAutorizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://hom.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    NfeStatusServico: 'https://hom.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
    NfeInutilizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://hom.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
};

export const ENDPOINTS_PRODUCAO: Record<string, SefazEndpointMap> = {
  AM: {
    NfeAutorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
    NfeStatusServico: 'https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    NfeInutilizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
  },
  BA: {
    NfeAutorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    NfeStatusServico: 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  GO: {
    NfeAutorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4',
    NfeInutilizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4',
  },
  MG: {
    NfeAutorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    NfeInutilizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
  },
  MS: {
    NfeAutorizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfe.sefaz.ms.gov.br/ws/NFeStatusServico4',
    NfeInutilizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4',
  },
  MT: {
    NfeAutorizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
    NfeStatusServico: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
    NfeInutilizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4',
  },
  PE: {
    NfeAutorizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
    NfeInutilizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4',
  },
  PR: {
    NfeAutorizacao: 'https://nfe.sefaz.pr.gov.br/nfe/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfe.sefaz.pr.gov.br/nfe/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfe.sefaz.pr.gov.br/nfe/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfe.sefaz.pr.gov.br/nfe/NFeStatusServico4',
    NfeInutilizacao: 'https://nfe.sefaz.pr.gov.br/nfe/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfe.sefaz.pr.gov.br/nfe/NFeRecepcaoEvento4',
  },
  RS: {
    NfeAutorizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfe.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  SP: {
    NfeAutorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
    NfeStatusServico: 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
    NfeInutilizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
  },
  SVRS: {
    NfeAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  SVAN: {
    NfeAutorizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    NfeStatusServico: 'https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
    NfeInutilizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://www.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
};

/**
 * UFs que utilizam SVRS como autorizador virtual (estados sem autorizador próprio).
 * Quando a UF não está mapeada diretamente, o fallback é SVRS.
 */
const UF_TO_AUTORIZADOR: Record<string, string> = {
  AM: 'AM',
  BA: 'BA',
  GO: 'GO',
  MG: 'MG',
  MS: 'MS',
  MT: 'MT',
  PE: 'PE',
  PR: 'PR',
  RS: 'RS',
  SP: 'SP',
  // Estados que usam SVAN
  MA: 'SVAN',
  PA: 'SVAN',
  PI: 'SVAN',
  // Todos os demais usam SVRS (tratado pelo fallback)
};

/**
 * Retorna os endpoints SEFAZ para a UF e ambiente informados.
 * Se a UF não estiver mapeada diretamente, utiliza SVRS como fallback.
 *
 * @param uf - Sigla da UF (ex: 'SP', 'MG')
 * @param ambiente - '1' para Producao, '2' para Homologacao
 */
export function getEndpoints(uf: string, ambiente: '1' | '2'): SefazEndpointMap {
  const endpoints = ambiente === '1' ? ENDPOINTS_PRODUCAO : ENDPOINTS_HOMOLOGACAO;
  const autorizador = UF_TO_AUTORIZADOR[uf.toUpperCase()] ?? 'SVRS';
  const result = endpoints[autorizador];

  if (!result) {
    throw new Error(`Endpoints nao encontrados para UF=${uf}, ambiente=${ambiente}, autorizador=${autorizador}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// NFC-e (Modelo 65) Endpoints
// ---------------------------------------------------------------------------
const NFCE_ENDPOINTS_HOMOLOGACAO: Record<string, SefazEndpointMap> = {
  AM: {
    NfeAutorizacao: 'https://homnfce.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://homnfce.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homnfce.sefaz.am.gov.br/services2/services/NfeConsulta4',
    NfeStatusServico: 'https://homnfce.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    NfeInutilizacao: 'https://homnfce.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://homnfce.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
  },
  GO: {
    NfeAutorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NfeAutorizacao4?wsdl',
    NfeRetAutorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NfeRetAutorizacao4?wsdl',
    NfeConsultaProtocolo: 'https://homolog.sefaz.go.gov.br/nfe/services/NfeConsulta4?wsdl',
    NfeStatusServico: 'https://homolog.sefaz.go.gov.br/nfe/services/NfeStatusServico4?wsdl',
    NfeInutilizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NfeInutilizacao4?wsdl',
    NFeRecepcaoEvento: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4?wsdl',
  },
  MG: {
    NfeAutorizacao: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4',
    NfeInutilizacao: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4',
  },
  MS: {
    NfeAutorizacao: 'https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeStatusServico4',
    NfeInutilizacao: 'https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://homologacao.nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4',
  },
  MT: {
    NfeAutorizacao: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4',
    NfeStatusServico: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4',
    NfeInutilizacao: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4',
  },
  PR: {
    NfeAutorizacao: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeStatusServico4',
    NfeInutilizacao: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4',
  },
  RS: {
    NfeAutorizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  SP: {
    NfeAutorizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
    NfeStatusServico: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
    NfeInutilizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
  },
  SVRS: {
    NfeAutorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NFeRecepcaoEvento4.asmx',
  },
};

const NFCE_ENDPOINTS_PRODUCAO: Record<string, SefazEndpointMap> = {
  AM: {
    NfeAutorizacao: 'https://nfce.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://nfce.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfce.sefaz.am.gov.br/services2/services/NfeConsulta4',
    NfeStatusServico: 'https://nfce.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    NfeInutilizacao: 'https://nfce.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfce.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
  },
  GO: {
    NfeAutorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NfeAutorizacao4?wsdl',
    NfeRetAutorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NfeRetAutorizacao4?wsdl',
    NfeConsultaProtocolo: 'https://nfe.sefaz.go.gov.br/nfe/services/NfeConsulta4?wsdl',
    NfeStatusServico: 'https://nfe.sefaz.go.gov.br/nfe/services/NfeStatusServico4?wsdl',
    NfeInutilizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NfeInutilizacao4?wsdl',
    NFeRecepcaoEvento: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4?wsdl',
  },
  MG: {
    NfeAutorizacao: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4',
    NfeInutilizacao: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4',
  },
  MS: {
    NfeAutorizacao: 'https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfce.sefaz.ms.gov.br/ws/NFeStatusServico4',
    NfeInutilizacao: 'https://nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4',
  },
  MT: {
    NfeAutorizacao: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4',
    NfeRetAutorizacao: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4',
    NfeStatusServico: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4',
    NfeInutilizacao: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfce.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4',
  },
  PR: {
    NfeAutorizacao: 'https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4',
    NfeRetAutorizacao: 'https://nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4',
    NfeConsultaProtocolo: 'https://nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4',
    NfeStatusServico: 'https://nfce.sefa.pr.gov.br/nfce/NFeStatusServico4',
    NfeInutilizacao: 'https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4',
    NFeRecepcaoEvento: 'https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4',
  },
  RS: {
    NfeAutorizacao: 'https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfce.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfce.sefazrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  SP: {
    NfeAutorizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
    NfeStatusServico: 'https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
  },
  SVRS: {
    NfeAutorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NfeStatusServico: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NfeInutilizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeInutilizacao/NfeInutilizacao4.asmx',
    NFeRecepcaoEvento: 'https://nfce.svrs.rs.gov.br/ws/NFeRecepcaoEvento4.asmx',
  },
};

export function getNfceEndpoints(uf: string, ambiente: '1' | '2'): SefazEndpointMap {
  const endpoints = ambiente === '1' ? NFCE_ENDPOINTS_PRODUCAO : NFCE_ENDPOINTS_HOMOLOGACAO;
  // O autorizador da NF-e nem sempre atende NFC-e: a SVAN (MA/PA/PI) nao emite
  // NFC-e, e BA/PE nao tem autorizador proprio para o modelo 65. Nesses casos a
  // SEFAZ direciona para a SVRS — por isso o fallback aqui e por disponibilidade
  // do endpoint, nao apenas por UF ausente no mapa.
  const autorizador = UF_TO_AUTORIZADOR[uf.toUpperCase()] ?? 'SVRS';
  const result = endpoints[autorizador] ?? endpoints['SVRS'];
  if (!result) {
    throw new Error(`Endpoints NFC-e nao encontrados para UF=${uf}, ambiente=${ambiente}`);
  }
  return result;
}

// URLs de consulta QR Code por UF e ambiente (para infNFeSupl.urlChave)
const NFCE_CONSULTA_QRCODE: Record<string, { hom: string; prod: string }> = {
  AM: { hom: 'https://homnfce.sefaz.am.gov.br/nfce/consultarNFCe.jsp', prod: 'https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp' },
  GO: { hom: 'https://homolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', prod: 'https://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe' },
  MG: { hom: 'https://hnfce.fazenda.mg.gov.br/portalnfce', prod: 'https://nfce.fazenda.mg.gov.br/portalnfce' },
  MS: { hom: 'https://homologacao.nfce.sefaz.ms.gov.br/nfce/consulta', prod: 'https://nfce.sefaz.ms.gov.br/nfce/consulta' },
  MT: { hom: 'https://homologacao.sefaz.mt.gov.br/nfce/consultanfce', prod: 'https://www.sefaz.mt.gov.br/nfce/consultanfce' },
  PR: { hom: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/qrcode', prod: 'https://www.nfce.sefa.pr.gov.br/nfce/qrcode' },
  RS: { hom: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', prod: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
  SP: { hom: 'https://homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica', prod: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica' },
  SVRS: { hom: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', prod: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
};

export function getNfceQrCodeUrl(uf: string, ambiente: '1' | '2'): string {
  const autorizador = UF_TO_AUTORIZADOR[uf.toUpperCase()] ?? 'SVRS';
  const urls = NFCE_CONSULTA_QRCODE[autorizador] || NFCE_CONSULTA_QRCODE['SVRS'];
  return ambiente === '1' ? urls.prod : urls.hom;
}

export function getNfceUrlChave(uf: string, ambiente: '1' | '2'): string {
  return getNfceQrCodeUrl(uf, ambiente);
}
