import { InutilizacaoXmlGenerator } from '../../src/infrastructure/xml/InutilizacaoXmlGenerator';

describe('InutilizacaoXmlGenerator', () => {
  const generator = new InutilizacaoXmlGenerator();

  const baseInput = {
    tpAmb: '2',
    cUF: '31',
    ano: '24',
    cnpj: '12345678000199',
    mod: '55',
    serie: '1',
    nNFIni: '1',
    nNFFin: '10',
    xJust: 'Inutilizacao de numeracao nao utilizada',
  };

  test('should generate valid inutNFe XML', () => {
    const xml = generator.generate(baseInput);
    expect(xml).toContain('<inutNFe');
    expect(xml).toContain('versao="4.00"');
    expect(xml).toContain('<infInut');
    expect(xml).toContain('<xServ>INUTILIZAR</xServ>');
  });

  test('should include all required fields', () => {
    const xml = generator.generate(baseInput);
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('<cUF>31</cUF>');
    expect(xml).toContain('<ano>24</ano>');
    expect(xml).toContain('<CNPJ>12345678000199</CNPJ>');
    expect(xml).toContain('<mod>55</mod>');
    expect(xml).toContain('<serie>1</serie>');
    expect(xml).toContain('<nNFIni>1</nNFIni>');
    expect(xml).toContain('<nNFFin>10</nNFFin>');
  });

  test('should generate correct Id attribute with padding', () => {
    const xml = generator.generate(baseInput);
    expect(xml).toContain('Id="ID31241234567800019955001000000001000000010"');
  });

  test('should include xJust', () => {
    const xml = generator.generate(baseInput);
    expect(xml).toContain('<xJust>Inutilizacao de numeracao nao utilizada</xJust>');
  });

  test('should include nfe namespace', () => {
    const xml = generator.generate(baseInput);
    expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"');
  });
});
