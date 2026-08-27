import { CartaCorrecaoUseCase } from '../../src/application/CartaCorrecaoUseCase';
import { EventXmlGenerator, CartaCorrecaoInput } from '../../src/infrastructure/xml/EventXmlGenerator';

const mockSigner = { sign: jest.fn((xml: string) => `<signed>${xml}</signed>`) } as any;
const mockSoapClient = { send: jest.fn() } as any;
const mockRepository = {} as any;

function makeUseCase() {
  return new CartaCorrecaoUseCase({
    eventXmlGenerator: new EventXmlGenerator(),
    signer: mockSigner,
    soapClient: mockSoapClient,
    repository: mockRepository,
  });
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

const SOAP_CCE_OK = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
      <retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
        <idLote>1</idLote>
        <tpAmb>2</tpAmb>
        <verAplic>SVRS202405</verAplic>
        <cOrgao>31</cOrgao>
        <cStat>128</cStat>
        <xMotivo>Lote de Evento Processado</xMotivo>
        <retEvento versao="1.00">
          <infEvento>
            <tpAmb>2</tpAmb>
            <verAplic>SVRS202405</verAplic>
            <cOrgao>31</cOrgao>
            <cStat>135</cStat>
            <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
            <chNFe>31240512345678000199550010000000011000000019</chNFe>
            <tpEvento>110110</tpEvento>
            <nSeqEvento>1</nSeqEvento>
            <nProt>131240000000003</nProt>
            <dhRegEvento>2024-05-10T12:01:00-03:00</dhRegEvento>
          </infEvento>
        </retEvento>
      </retEnvEvento>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

describe('CartaCorrecaoUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should send CC-e successfully when SEFAZ returns cStat 135', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CCE_OK);
    const uc = makeUseCase();
    const result = await uc.execute(makeCCeInput(), 'MG', '2');

    expect(result.success).toBe(true);
    expect(result.cStat).toBe('135');
    expect(result.nProt).toBe('131240000000003');
  });

  test('should reject xCorrecao shorter than 15 chars', async () => {
    const uc = makeUseCase();
    const input = makeCCeInput();
    input.xCorrecao = 'curta';
    await expect(uc.execute(input, 'MG', '2')).rejects.toThrow('minimo 15 caracteres');
  });

  test('should sign with correct event Id', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CCE_OK);
    const uc = makeUseCase();
    await uc.execute(makeCCeInput(), 'MG', '2');

    expect(mockSigner.sign).toHaveBeenCalledTimes(1);
    const [, refUri] = mockSigner.sign.mock.calls[0];
    expect(refUri).toContain('ID110110');
  });

  test('should include xCondUso in the XML', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CCE_OK);
    const uc = makeUseCase();
    await uc.execute(makeCCeInput(), 'MG', '2');

    const [xml] = mockSigner.sign.mock.calls[0];
    expect(xml).toContain('Carta de Correcao e disciplinada');
  });
});
