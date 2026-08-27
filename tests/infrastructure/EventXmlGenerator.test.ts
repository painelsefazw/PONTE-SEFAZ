import { EventXmlGenerator, CancelamentoInput, CartaCorrecaoInput } from '../../src/infrastructure/xml/EventXmlGenerator';

function makeCancelInput(): CancelamentoInput {
  return {
    chaveAcesso: '31240512345678000199550010000000011000000019',
    cnpj: '12345678000199',
    cUF: '31',
    ambiente: '2',
    nSeqEvento: 1,
    dhEvento: '2024-05-10T12:00:00-03:00',
    nProt: '131240000000001',
    xJust: 'Cancelamento por erro na emissao da nota fiscal',
  };
}

function makeCCeInput(): CartaCorrecaoInput {
  return {
    chaveAcesso: '31240512345678000199550010000000011000000019',
    cnpj: '12345678000199',
    cUF: '31',
    ambiente: '2',
    nSeqEvento: 1,
    dhEvento: '2024-05-10T12:00:00-03:00',
    xCorrecao: 'Correcao do endereco do destinatario para Rua Nova 123',
  };
}

describe('EventXmlGenerator', () => {
  let generator: EventXmlGenerator;

  beforeEach(() => {
    generator = new EventXmlGenerator();
  });

  describe('generateCancelamento', () => {
    test('should generate envEvento with tpEvento 110111', () => {
      const xml = generator.generateCancelamento(makeCancelInput(), '1');
      expect(xml).toContain('<tpEvento>110111</tpEvento>');
      expect(xml).toContain('<descEvento>Cancelamento</descEvento>');
    });

    test('should include nProt and xJust in detEvento', () => {
      const xml = generator.generateCancelamento(makeCancelInput(), '1');
      expect(xml).toContain('<nProt>131240000000001</nProt>');
      expect(xml).toContain('<xJust>Cancelamento por erro na emissao da nota fiscal</xJust>');
    });

    test('should have correct Id attribute format', () => {
      const xml = generator.generateCancelamento(makeCancelInput(), '1');
      expect(xml).toContain('Id="ID11011131240512345678000199550010000000011000000019');
    });

    test('should contain envEvento with versao 1.00', () => {
      const xml = generator.generateCancelamento(makeCancelInput(), '123');
      expect(xml).toContain('versao="1.00"');
      expect(xml).toContain('<idLote>123</idLote>');
    });

    test('should include SEFAZ namespace', () => {
      const xml = generator.generateCancelamento(makeCancelInput(), '1');
      expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"');
    });

    // O padding de 2 dígitos vale só para o atributo Id. No elemento, o schema
    // exige [1-9][0-9]? — sem zero à esquerda. Confirmado contra a SEFAZ: CC-e
    // e cancelamento retornam cStat 135 neste formato.
    test('should pad nSeqEvento to 2 digits only in the Id attribute', () => {
      const xml = generator.generateCancelamento(makeCancelInput(), '1');
      expect(xml).toContain('<nSeqEvento>1</nSeqEvento>');
      expect(xml).toContain('01"');
    });
  });

  describe('generateCartaCorrecao', () => {
    test('should generate envEvento with tpEvento 110110', () => {
      const xml = generator.generateCartaCorrecao(makeCCeInput(), '1');
      expect(xml).toContain('<tpEvento>110110</tpEvento>');
      expect(xml).toContain('<descEvento>Carta de Correcao</descEvento>');
    });

    test('should include xCorrecao and xCondUso', () => {
      const xml = generator.generateCartaCorrecao(makeCCeInput(), '1');
      expect(xml).toContain('<xCorrecao>Correcao do endereco do destinatario para Rua Nova 123</xCorrecao>');
      expect(xml).toContain('<xCondUso>A Carta de Correcao e disciplinada');
    });

    test('should support nSeqEvento > 1 for multiple corrections', () => {
      const input = makeCCeInput();
      input.nSeqEvento = 3;
      const xml = generator.generateCartaCorrecao(input, '1');
      expect(xml).toContain('<nSeqEvento>3</nSeqEvento>');
      expect(xml).toContain('03"'); // Id continua com 2 dígitos
    });

    test('should include CNPJ and chNFe', () => {
      const xml = generator.generateCartaCorrecao(makeCCeInput(), '1');
      expect(xml).toContain('<CNPJ>12345678000199</CNPJ>');
      expect(xml).toContain('<chNFe>31240512345678000199550010000000011000000019</chNFe>');
    });
  });
});
