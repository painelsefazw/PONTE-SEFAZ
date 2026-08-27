import { ContingenciaManager } from '../../src/infrastructure/contingencia/ContingenciaManager';
import { TipoEmissao } from '../../src/domain/models';

describe('ContingenciaManager', () => {
  const makeManager = (uf = 'MG') =>
    new ContingenciaManager({ uf, ambiente: '2' });

  test('should start in normal mode', () => {
    const mgr = makeManager();
    expect(mgr.isAtiva()).toBe(false);
    expect(mgr.getState().tpEmis).toBe(TipoEmissao.NORMAL);
  });

  test('should activate SVC-AN for MG (autorizador AN)', () => {
    const mgr = makeManager('MG');
    mgr.ativarSvc('Indisponibilidade do SEFAZ', '2024-05-10T10:00:00-03:00');
    expect(mgr.isAtiva()).toBe(true);
    expect(mgr.getState().tpEmis).toBe(TipoEmissao.CONTINGENCIA_SVC_AN);
    expect(mgr.getState().motivo).toBe('Indisponibilidade do SEFAZ');
  });

  test('should activate SVC-RS for GO (autorizador RS)', () => {
    const mgr = makeManager('GO');
    mgr.ativarSvc('SEFAZ GO indisponivel', '2024-05-10T10:00:00-03:00');
    expect(mgr.isAtiva()).toBe(true);
    expect(mgr.getState().tpEmis).toBe(TipoEmissao.CONTINGENCIA_SVC_RS);
  });

  test('should throw if motivo has less than 15 chars', () => {
    const mgr = makeManager();
    expect(() => mgr.ativarSvc('curto', '2024-05-10T10:00:00-03:00'))
      .toThrow('15 caracteres');
  });

  test('should deactivate contingency', () => {
    const mgr = makeManager();
    mgr.ativarSvc('Indisponibilidade do SEFAZ', '2024-05-10T10:00:00-03:00');
    mgr.desativar();
    expect(mgr.isAtiva()).toBe(false);
    expect(mgr.getState().tpEmis).toBe(TipoEmissao.NORMAL);
  });

  test('should resolve normal endpoints when not in contingency', () => {
    const mgr = makeManager('MG');
    const endpoints = mgr.resolveEndpoints();
    expect(endpoints.NfeAutorizacao).toContain('hnfe.fazenda.mg.gov.br');
  });

  test('should resolve SVC-AN endpoints when in contingency for MG', () => {
    const mgr = makeManager('MG');
    mgr.ativarSvc('Indisponibilidade do SEFAZ MG', '2024-05-10T10:00:00-03:00');
    const endpoints = mgr.resolveEndpoints();
    expect(endpoints.NfeAutorizacao).toContain('svc.fazenda.gov.br');
  });

  test('should resolve SVC-RS endpoints when in contingency for GO', () => {
    const mgr = makeManager('GO');
    mgr.ativarSvc('SEFAZ GO indisponivel agora', '2024-05-10T10:00:00-03:00');
    const endpoints = mgr.resolveEndpoints();
    expect(endpoints.NfeAutorizacao).toContain('svrs.rs.gov.br');
  });

  test('should return copy of state (immutability)', () => {
    const mgr = makeManager();
    const state1 = mgr.getState();
    mgr.ativarSvc('Indisponibilidade do SEFAZ', '2024-05-10T10:00:00-03:00');
    const state2 = mgr.getState();
    expect(state1.ativa).toBe(false);
    expect(state2.ativa).toBe(true);
  });

  test('should resolve tpEmis correctly', () => {
    const mgr = makeManager('SP');
    expect(mgr.resolveTpEmis()).toBe(TipoEmissao.NORMAL);
    mgr.ativarSvc('Indisponibilidade SP SEFAZ', '2024-05-10T10:00:00-03:00');
    expect(mgr.resolveTpEmis()).toBe(TipoEmissao.CONTINGENCIA_SVC_AN);
  });
});
