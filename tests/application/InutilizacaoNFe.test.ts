import { InutilizacaoNFeUseCase } from '../../src/application/InutilizacaoNFeUseCase';
import { InutilizacaoXmlGenerator } from '../../src/infrastructure/xml/InutilizacaoXmlGenerator';

describe('InutilizacaoNFeUseCase', () => {
  const mockSigner = { sign: jest.fn((xml: string) => xml) } as any;
  const mockSoapClient = { send: jest.fn() } as any;

  const baseInput = {
    tpAmb: '2' as string,
    cUF: '31',
    ano: '24',
    cnpj: '12345678000199',
    mod: '55',
    serie: '1',
    nNFIni: '1',
    nNFFin: '10',
    xJust: 'Inutilizacao de numeracao nao utilizada',
  };

  beforeEach(() => jest.clearAllMocks());

  test('should return success when cStat is 102', async () => {
    mockSoapClient.send.mockResolvedValue(
      '<retInutNFe><infInut><cStat>102</cStat><xMotivo>Inutilizacao homologada</xMotivo><nProt>131240000000099</nProt></infInut></retInutNFe>'
    );

    const useCase = new InutilizacaoNFeUseCase({
      xmlGenerator: new InutilizacaoXmlGenerator(),
      signer: mockSigner,
      soapClient: mockSoapClient,
    });

    const result = await useCase.execute(baseInput, 'MG');
    expect(result.success).toBe(true);
    expect(result.cStat).toBe('102');
    expect(result.nProt).toBe('131240000000099');
  });

  test('should throw if xJust has less than 15 chars', async () => {
    const useCase = new InutilizacaoNFeUseCase({
      xmlGenerator: new InutilizacaoXmlGenerator(),
      signer: mockSigner,
      soapClient: mockSoapClient,
    });

    await expect(useCase.execute({ ...baseInput, xJust: 'curto' }, 'MG'))
      .rejects.toThrow('15 caracteres');
  });

  test('should throw if nNFIni > nNFFin', async () => {
    const useCase = new InutilizacaoNFeUseCase({
      xmlGenerator: new InutilizacaoXmlGenerator(),
      signer: mockSigner,
      soapClient: mockSoapClient,
    });

    await expect(useCase.execute({ ...baseInput, nNFIni: '20', nNFFin: '10' }, 'MG'))
      .rejects.toThrow('Faixa de numeracao invalida');
  });

  test('should return failure when cStat is not 102', async () => {
    mockSoapClient.send.mockResolvedValue(
      '<retInutNFe><infInut><cStat>206</cStat><xMotivo>Inutilizacao rejeitada</xMotivo></infInut></retInutNFe>'
    );

    const useCase = new InutilizacaoNFeUseCase({
      xmlGenerator: new InutilizacaoXmlGenerator(),
      signer: mockSigner,
      soapClient: mockSoapClient,
    });

    const result = await useCase.execute(baseInput, 'MG');
    expect(result.success).toBe(false);
    expect(result.cStat).toBe('206');
  });
});
