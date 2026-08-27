import { SefazEndpointMap } from '../soap/SefazEndpoints';

export const SVC_AN_HOMOLOGACAO: SefazEndpointMap = {
  NfeAutorizacao: 'https://hom.svc.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
  NfeRetAutorizacao: 'https://hom.svc.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
  NfeConsultaProtocolo: 'https://hom.svc.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  NfeStatusServico: 'https://hom.svc.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
  NfeInutilizacao: 'https://hom.svc.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
  NFeRecepcaoEvento: 'https://hom.svc.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

export const SVC_AN_PRODUCAO: SefazEndpointMap = {
  NfeAutorizacao: 'https://www.svc.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
  NfeRetAutorizacao: 'https://www.svc.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
  NfeConsultaProtocolo: 'https://www.svc.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  NfeStatusServico: 'https://www.svc.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
  NfeInutilizacao: 'https://www.svc.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
  NFeRecepcaoEvento: 'https://www.svc.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

export const SVC_RS_HOMOLOGACAO: SefazEndpointMap = {
  NfeAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  NfeRetAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  NfeConsultaProtocolo: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  NfeStatusServico: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  NfeInutilizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  NFeRecepcaoEvento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

export const SVC_RS_PRODUCAO: SefazEndpointMap = {
  NfeAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  NfeRetAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  NfeConsultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  NfeStatusServico: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  NfeInutilizacao: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  NFeRecepcaoEvento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const UF_TO_SVC: Record<string, 'SVC_AN' | 'SVC_RS'> = {
  AM: 'SVC_RS', BA: 'SVC_RS', CE: 'SVC_RS', GO: 'SVC_RS',
  MA: 'SVC_AN', MG: 'SVC_AN', MS: 'SVC_RS', MT: 'SVC_RS',
  PA: 'SVC_AN', PE: 'SVC_RS', PI: 'SVC_AN', PR: 'SVC_RS',
  RS: 'SVC_AN', SP: 'SVC_AN',
};

export function getSvcEndpoints(uf: string, ambiente: '1' | '2'): SefazEndpointMap {
  const svcType = UF_TO_SVC[uf.toUpperCase()] ?? 'SVC_RS';

  if (svcType === 'SVC_AN') {
    return ambiente === '1' ? SVC_AN_PRODUCAO : SVC_AN_HOMOLOGACAO;
  }
  return ambiente === '1' ? SVC_RS_PRODUCAO : SVC_RS_HOMOLOGACAO;
}

export function getSvcType(uf: string): 'SVC_AN' | 'SVC_RS' {
  return UF_TO_SVC[uf.toUpperCase()] ?? 'SVC_RS';
}
