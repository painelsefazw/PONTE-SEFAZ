import { StatusServicoXmlGenerator } from '../../src/infrastructure/xml/StatusServicoXmlGenerator';

describe('StatusServicoXmlGenerator', () => {
  const generator = new StatusServicoXmlGenerator();

  test('should generate consStatServ XML', () => {
    const xml = generator.generate('2', '31');
    expect(xml).toContain('<consStatServ');
    expect(xml).toContain('versao="4.00"');
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('<cUF>31</cUF>');
    expect(xml).toContain('<xServ>STATUS</xServ>');
  });

  test('should include nfe namespace', () => {
    const xml = generator.generate('1', '35');
    expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"');
  });

  test('should use producao ambiente', () => {
    const xml = generator.generate('1', '35');
    expect(xml).toContain('<tpAmb>1</tpAmb>');
    expect(xml).toContain('<cUF>35</cUF>');
  });
});
