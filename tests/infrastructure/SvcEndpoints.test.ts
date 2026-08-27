import { getSvcEndpoints, getSvcType } from '../../src/infrastructure/contingencia/SvcEndpoints';

describe('SvcEndpoints', () => {
  test('getSvcType returns SVC_AN for MG', () => {
    expect(getSvcType('MG')).toBe('SVC_AN');
  });

  test('getSvcType returns SVC_RS for GO', () => {
    expect(getSvcType('GO')).toBe('SVC_RS');
  });

  test('getSvcType defaults to SVC_RS for unknown UF', () => {
    expect(getSvcType('XX')).toBe('SVC_RS');
  });

  test('getSvcEndpoints returns SVC-AN homologacao for SP', () => {
    const endpoints = getSvcEndpoints('SP', '2');
    expect(endpoints.NfeAutorizacao).toContain('hom.svc.fazenda.gov.br');
  });

  test('getSvcEndpoints returns SVC-AN producao for SP', () => {
    const endpoints = getSvcEndpoints('SP', '1');
    expect(endpoints.NfeAutorizacao).toContain('www.svc.fazenda.gov.br');
  });

  test('getSvcEndpoints returns SVC-RS homologacao for GO', () => {
    const endpoints = getSvcEndpoints('GO', '2');
    expect(endpoints.NfeAutorizacao).toContain('nfe-homologacao.svrs.rs.gov.br');
  });

  test('getSvcEndpoints returns SVC-RS producao for GO', () => {
    const endpoints = getSvcEndpoints('GO', '1');
    expect(endpoints.NfeAutorizacao).toContain('nfe.svrs.rs.gov.br');
  });

  test('all 6 service endpoints present in SVC-AN', () => {
    const endpoints = getSvcEndpoints('MG', '2');
    expect(endpoints.NfeAutorizacao).toBeTruthy();
    expect(endpoints.NfeRetAutorizacao).toBeTruthy();
    expect(endpoints.NfeConsultaProtocolo).toBeTruthy();
    expect(endpoints.NfeStatusServico).toBeTruthy();
    expect(endpoints.NfeInutilizacao).toBeTruthy();
    expect(endpoints.NFeRecepcaoEvento).toBeTruthy();
  });
});
