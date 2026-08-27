import { generateAccessKey, AccessKeyResult } from '../../src/domain/NFeKeyGenerator';

describe('NFeKeyGenerator', () => {
  describe('generateAccessKey', () => {
    it('should generate a 44-digit numeric access key for MG NFe', () => {
      const result: AccessKeyResult = generateAccessKey({
        cUF: '31',
        dhEmi: '2024-05-10T10:00:00-03:00',
        cnpj: '12345678000199',
        mod: '55',
        serie: '1',
        nNF: '1',
        tpEmis: '1',
        cNF: '00000001',
      });

      expect(result.chave).toHaveLength(44);
      expect(result.chave).toMatch(/^\d{44}$/);
      // Verify structure: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
      expect(result.chave.substring(0, 2)).toBe('31');     // cUF
      expect(result.chave.substring(2, 6)).toBe('2405');   // AAMM
      expect(result.chave.substring(6, 20)).toBe('12345678000199'); // CNPJ
      expect(result.chave.substring(20, 22)).toBe('55');   // mod
      expect(result.chave.substring(22, 25)).toBe('001');  // serie padded
      expect(result.chave.substring(25, 34)).toBe('000000001'); // nNF padded
      expect(result.chave.substring(34, 35)).toBe('1');    // tpEmis
      expect(result.chave.substring(35, 43)).toBe('00000001'); // cNF
      expect(result.cDV).toBe(result.chave[43]);
    });

    it('should generate a 44-digit key for SP NFe with different data', () => {
      const result = generateAccessKey({
        cUF: '35',
        dhEmi: '2025-12-15T14:30:00-03:00',
        cnpj: '98765432000188',
        mod: '55',
        serie: '10',
        nNF: '12345',
        tpEmis: '1',
        cNF: '99887766',
      });

      expect(result.chave).toHaveLength(44);
      expect(result.chave).toMatch(/^\d{44}$/);
      expect(result.chave.substring(0, 2)).toBe('35');     // cUF SP
      expect(result.chave.substring(2, 6)).toBe('2512');   // AAMM Dec 2025
      expect(result.chave.substring(6, 20)).toBe('98765432000188');
      expect(result.chave.substring(22, 25)).toBe('010');  // serie 10 padded
      expect(result.chave.substring(25, 34)).toBe('000012345'); // nNF padded
    });

    it('should generate a valid key for BA with contingency emission', () => {
      const result = generateAccessKey({
        cUF: '29',
        dhEmi: '2024-01-01T00:00:00-03:00',
        cnpj: '11222333000181',
        mod: '55',
        serie: '999',
        nNF: '999999999',
        tpEmis: '6',   // CONTINGENCIA_SVC_AN
        cNF: '12345678',
      });

      expect(result.chave).toHaveLength(44);
      expect(result.chave).toMatch(/^\d{44}$/);
      expect(result.chave.substring(0, 2)).toBe('29');     // cUF BA
      expect(result.chave.substring(2, 6)).toBe('2401');   // AAMM Jan 2024
      expect(result.chave.substring(34, 35)).toBe('6');    // tpEmis contingency
    });

    it('should compute check digit correctly using mod 11 algorithm', () => {
      // Generate two keys and verify the cDV is consistent
      const result1 = generateAccessKey({
        cUF: '31',
        dhEmi: '2024-05-10T10:00:00-03:00',
        cnpj: '12345678000199',
        mod: '55',
        serie: '1',
        nNF: '1',
        tpEmis: '1',
        cNF: '00000001',
      });

      // Verify cDV by manually computing mod 11
      const digits43 = result1.chave.substring(0, 43);
      const weights = [2, 3, 4, 5, 6, 7, 8, 9];
      let sum = 0;
      for (let i = digits43.length - 1, w = 0; i >= 0; i--, w++) {
        sum += parseInt(digits43[i], 10) * weights[w % weights.length];
      }
      const remainder = sum % 11;
      const expectedCDV = remainder < 2 ? '0' : String(11 - remainder);

      expect(result1.cDV).toBe(expectedCDV);
      expect(result1.chave[43]).toBe(expectedCDV);
    });

    it('should pad short fields correctly', () => {
      const result = generateAccessKey({
        cUF: '3',       // short cUF
        dhEmi: '2024-06-01T00:00:00-03:00',
        cnpj: '123',    // short CNPJ
        mod: '5',       // short mod
        serie: '1',     // short serie
        nNF: '7',       // short nNF
        tpEmis: '1',
        cNF: '1',       // short cNF
      });

      expect(result.chave).toHaveLength(44);
      expect(result.chave).toMatch(/^\d{44}$/);
      // cUF should be padded to 2 digits
      expect(result.chave.substring(0, 2)).toBe('03');
      // mod should be padded to 2 digits
      expect(result.chave.substring(20, 22)).toBe('05');
      // serie should be padded to 3 digits
      expect(result.chave.substring(22, 25)).toBe('001');
      // nNF should be padded to 9 digits
      expect(result.chave.substring(25, 34)).toBe('000000007');
    });

    it('should throw on invalid dhEmi format', () => {
      expect(() =>
        generateAccessKey({
          cUF: '31',
          dhEmi: 'invalid-date',
          cnpj: '12345678000199',
          mod: '55',
          serie: '1',
          nNF: '1',
          tpEmis: '1',
          cNF: '00000001',
        }),
      ).toThrow('Invalid dhEmi format');
    });
  });
});
