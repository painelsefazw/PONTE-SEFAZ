import { getEndpoints } from '../../src/infrastructure/soap/SefazEndpoints';

describe('SefazEndpoints', () => {
  test('should return MG homologacao endpoints', () => {
    const ep = getEndpoints('MG', '2');
    expect(ep.NfeAutorizacao).toContain('nfe');
    expect(ep.NfeAutorizacao).toContain('.fazenda.mg.gov.br');
    expect(ep.NfeStatusServico).toBeDefined();
    expect(ep.NfeRetAutorizacao).toBeDefined();
    expect(ep.NfeConsultaProtocolo).toBeDefined();
    expect(ep.NfeInutilizacao).toBeDefined();
  });

  test('should return SP producao endpoints', () => {
    const ep = getEndpoints('SP', '1');
    expect(ep.NfeAutorizacao).toContain('nfe.fazenda.sp.gov.br');
  });

  test('should fall back to SVRS for unmapped UF in homologacao', () => {
    const ep = getEndpoints('AC', '2');
    expect(ep.NfeAutorizacao).toContain('svrs');
  });

  test('should fall back to SVRS for unmapped UF in producao', () => {
    const ep = getEndpoints('AC', '1');
    expect(ep.NfeAutorizacao).toContain('svrs');
  });

  test('should return different URLs for producao vs homologacao', () => {
    const hom = getEndpoints('SP', '2');
    const prod = getEndpoints('SP', '1');
    expect(hom.NfeAutorizacao).not.toBe(prod.NfeAutorizacao);
  });

  test('should have all 5 service endpoints for any UF', () => {
    const ep = getEndpoints('RS', '2');
    const keys = Object.keys(ep);
    expect(keys).toContain('NfeAutorizacao');
    expect(keys).toContain('NfeRetAutorizacao');
    expect(keys).toContain('NfeConsultaProtocolo');
    expect(keys).toContain('NfeStatusServico');
    expect(keys).toContain('NfeInutilizacao');
  });
});
