import {
  getEndpoints,
  getNfceEndpoints,
  getNfceQrCodeUrl,
  getNfceUrlChave,
} from '../../src/infrastructure/soap/SefazEndpoints';

/**
 * Cobertura nacional dos webservices.
 *
 * A emissao precisa funcionar em qualquer UF, inclusive nas que nao tem
 * autorizador proprio e caem em SVRS/SVAN. Uma UF sem endpoint so aparece na
 * hora em que um cliente daquele estado tenta emitir — por isso o teste varre
 * as 27 unidades federativas em vez de amostrar.
 */
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const SERVICOS = [
  'NfeAutorizacao',
  'NfeRetAutorizacao',
  'NfeConsultaProtocolo',
  'NfeStatusServico',
  'NFeRecepcaoEvento',
] as const;

describe('cobertura nacional de endpoints', () => {
  describe('NF-e (modelo 55)', () => {
    for (const ambiente of ['1', '2'] as const) {
      test(`as 27 UFs resolvem todos os servicos no ambiente ${ambiente}`, () => {
        const falhas: string[] = [];
        for (const uf of UFS) {
          try {
            const e = getEndpoints(uf, ambiente);
            for (const servico of SERVICOS) {
              if (!e[servico]) falhas.push(`${uf}: ${servico} vazio`);
            }
          } catch (err: any) {
            falhas.push(`${uf}: ${err.message}`);
          }
        }
        expect(falhas).toEqual([]);
      });
    }
  });

  describe('NFC-e (modelo 65)', () => {
    for (const ambiente of ['1', '2'] as const) {
      test(`as 27 UFs resolvem autorizacao no ambiente ${ambiente}`, () => {
        const falhas: string[] = [];
        for (const uf of UFS) {
          try {
            if (!getNfceEndpoints(uf, ambiente).NfeAutorizacao) {
              falhas.push(`${uf}: NfeAutorizacao vazio`);
            }
          } catch (err: any) {
            falhas.push(`${uf}: ${err.message}`);
          }
        }
        expect(falhas).toEqual([]);
      });
    }

    // SVAN nao atende NFC-e e BA/PE nao tem autorizador proprio do modelo 65:
    // todos precisam cair em SVRS, senao a emissao quebra so naquelas UFs.
    test.each(['MA', 'PA', 'PI', 'BA', 'PE'])('%s usa SVRS para NFC-e', (uf) => {
      expect(getNfceEndpoints(uf, '2').NfeAutorizacao).toContain('svrs');
    });

    test('as 27 UFs tem URL de QR Code e de consulta por chave', () => {
      const falhas: string[] = [];
      for (const uf of UFS) {
        if (!getNfceQrCodeUrl(uf, '2')) falhas.push(`${uf}: QR Code sem URL`);
        if (!getNfceUrlChave(uf, '2')) falhas.push(`${uf}: consulta por chave sem URL`);
      }
      expect(falhas).toEqual([]);
    });
  });
});
