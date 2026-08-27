import { CancelamentoNFeUseCase } from '../../src/application/CancelamentoNFeUseCase';
import { EventXmlGenerator, CancelamentoInput } from '../../src/infrastructure/xml/EventXmlGenerator';

const mockSigner = { sign: jest.fn((xml: string) => `<signed>${xml}</signed>`) } as any;
const mockSoapClient = { send: jest.fn() } as any;
const mockRepository = { updateStatus: jest.fn() } as any;

function makeUseCase() {
  return new CancelamentoNFeUseCase({
    eventXmlGenerator: new EventXmlGenerator(),
    signer: mockSigner,
    soapClient: mockSoapClient,
    repository: mockRepository,
  });
}

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

const SOAP_CANCELAMENTO_OK = `<?xml version="1.0" encoding="UTF-8"?>
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
            <tpEvento>110111</tpEvento>
            <nSeqEvento>1</nSeqEvento>
            <nProt>131240000000002</nProt>
            <dhRegEvento>2024-05-10T12:00:01-03:00</dhRegEvento>
          </infEvento>
        </retEvento>
      </retEnvEvento>
    </nfeResultMsg>
  </soap12:Body>
</soap12:Envelope>`;

describe('CancelamentoNFeUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should cancel successfully when SEFAZ returns cStat 135', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CANCELAMENTO_OK);
    const uc = makeUseCase();
    const result = await uc.execute(makeCancelInput(), 'MG', '2');

    expect(result.success).toBe(true);
    expect(result.cStat).toBe('135');
    expect(result.chaveAcesso).toBe('31240512345678000199550010000000011000000019');
    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      '31240512345678000199550010000000011000000019',
      'CANCELADA',
      expect.objectContaining({ cstat: '135' }),
    );
  });

  test('should reject justificativa shorter than 15 chars', async () => {
    const uc = makeUseCase();
    const input = makeCancelInput();
    input.xJust = 'curta';
    await expect(uc.execute(input, 'MG', '2')).rejects.toThrow('minimo 15 caracteres');
  });

  test('should sign the event XML before sending', async () => {
    mockSoapClient.send.mockResolvedValue(SOAP_CANCELAMENTO_OK);
    const uc = makeUseCase();
    await uc.execute(makeCancelInput(), 'MG', '2');

    expect(mockSigner.sign).toHaveBeenCalledTimes(1);
    const [xml, refUri] = mockSigner.sign.mock.calls[0];
    expect(xml).toContain('<tpEvento>110111</tpEvento>');
    expect(refUri).toContain('ID110111');
  });
});
