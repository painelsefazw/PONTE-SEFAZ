import { encryptSecret, decryptSecret, hashSenha, verifySenha } from '../../src/webapp/crypto';

describe('crypto (segredos de empresas)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, WEBAPP_MASTER_KEY: 'chave-mestra-de-teste-123' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('encrypt/decrypt round-trip com Buffer (certificado)', () => {
    const pfx = Buffer.from([0x30, 0x82, 0x01, 0x02, 0xff, 0x00, 0xab, 0xcd]);
    const enc = encryptSecret(pfx);
    expect(enc).not.toContain('0882');
    const dec = decryptSecret(enc);
    expect(Buffer.compare(dec, pfx)).toBe(0);
  });

  test('encrypt/decrypt round-trip com string (senha do certificado)', () => {
    const enc = encryptSecret('senha-do-pfx');
    expect(enc).not.toContain('senha');
    expect(decryptSecret(enc).toString('utf-8')).toBe('senha-do-pfx');
  });

  test('mesmo segredo gera ciphertexts diferentes (IV aleatorio)', () => {
    expect(encryptSecret('abc')).not.toBe(encryptSecret('abc'));
  });

  test('decrypt falha com chave-mestra errada (GCM auth)', () => {
    const enc = encryptSecret('segredo');
    process.env['WEBAPP_MASTER_KEY'] = 'outra-chave';
    expect(() => decryptSecret(enc)).toThrow();
  });

  test('falha claramente sem WEBAPP_MASTER_KEY', () => {
    delete process.env['WEBAPP_MASTER_KEY'];
    expect(() => encryptSecret('x')).toThrow('WEBAPP_MASTER_KEY');
  });

  test('hashSenha/verifySenha: aceita correta, rejeita errada', () => {
    const hash = hashSenha('senha-da-empresa');
    expect(hash).toContain(':');
    expect(verifySenha('senha-da-empresa', hash)).toBe(true);
    expect(verifySenha('senha-errada', hash)).toBe(false);
    expect(verifySenha('qualquer', 'malformado')).toBe(false);
  });

  test('hashes da mesma senha diferem (salt aleatorio)', () => {
    expect(hashSenha('abc')).not.toBe(hashSenha('abc'));
  });
});
