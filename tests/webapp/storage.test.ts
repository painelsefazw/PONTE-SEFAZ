import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStorage, PgStorage, createStorage, NotaRecord } from '../../src/webapp/storage';

function makeNota(overrides?: Partial<NotaRecord>): NotaRecord {
  return {
    chaveAcesso: '31260762050825000178550010000000011000000010',
    empresaCnpj: '62050825000178',
    numero: '1',
    serie: '1',
    ambiente: '2',
    destNome: 'CLIENTE TESTE',
    destDoc: '11222333000181',
    vNF: '16.00',
    protocolo: '131260000000001',
    dhRecbto: '2026-07-12T20:00:00-03:00',
    cStat: '100',
    status: 'AUTORIZADA',
    emitidaEm: '2026-07-12T20:00:01.000Z',
    ...overrides,
  };
}

describe('FileStorage', () => {
  let dir: string;
  let storage: FileStorage;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-storage-'));
    storage = new FileStorage(dir);
    await storage.init();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('peekNumber starts at 1 for a new serie', async () => {
    expect(await storage.peekNumber('62050825000178', '1')).toBe(1);
  });

  test('registerUsedNumber advances the sequence', async () => {
    await storage.registerUsedNumber('62050825000178', '1', 1);
    expect(await storage.peekNumber('62050825000178', '1')).toBe(2);
    await storage.registerUsedNumber('62050825000178', '1', 5);
    expect(await storage.peekNumber('62050825000178', '1')).toBe(6);
  });

  test('registerUsedNumber never goes backwards', async () => {
    await storage.registerUsedNumber('62050825000178', '1', 10);
    await storage.registerUsedNumber('62050825000178', '1', 3);
    expect(await storage.peekNumber('62050825000178', '1')).toBe(11);
  });

  test('series are independent', async () => {
    await storage.registerUsedNumber('62050825000178', '1', 7);
    expect(await storage.peekNumber('62050825000178', '2')).toBe(1);
  });

  test('saveNota + listNotas round-trip (list omits payloads)', async () => {
    await storage.saveNota(makeNota({ xml: '<NFe/>', nfeJson: { ide: {} } as any }));
    const list = await storage.listNotas();
    expect(list).toHaveLength(1);
    expect(list[0].chaveAcesso).toBe('31260762050825000178550010000000011000000010');
    expect(list[0].xml).toBeUndefined();
    expect(list[0].nfeJson).toBeUndefined();
  });

  test('getNota returns full record including xml', async () => {
    await storage.saveNota(makeNota({ xml: '<NFe/>' }));
    const nota = await storage.getNota('31260762050825000178550010000000011000000010');
    expect(nota).not.toBeNull();
    expect(nota!.xml).toBe('<NFe/>');
  });

  test('getNota returns null for unknown chave', async () => {
    expect(await storage.getNota('0'.repeat(44))).toBeNull();
  });

  test('updateStatus marks nota as CANCELADA', async () => {
    await storage.saveNota(makeNota());
    await storage.updateStatus('31260762050825000178550010000000011000000010', 'CANCELADA', '135');
    const nota = await storage.getNota('31260762050825000178550010000000011000000010');
    expect(nota!.status).toBe('CANCELADA');
    expect(nota!.cStat).toBe('135');
  });

  test('persists across instances (same dir)', async () => {
    await storage.registerUsedNumber('62050825000178', '1', 42);
    await storage.saveNota(makeNota());
    const other = new FileStorage(dir);
    await other.init();
    expect(await other.peekNumber('62050825000178', '1')).toBe(43);
    expect(await other.listNotas()).toHaveLength(1);
  });
});

describe('PgStorage', () => {
  function makeFakePool() {
    const calls: Array<{ text: string; values?: any[] }> = [];
    let nextResult: any = { rows: [] };
    const pool = {
      query: jest.fn(async (text: string, values?: any[]) => {
        calls.push({ text, values });
        return nextResult;
      }),
      setNextResult: (r: any) => { nextResult = r; },
      calls,
    };
    return pool;
  }

  test('init creates tables', async () => {
    const pool = makeFakePool();
    const storage = new PgStorage(pool as any);
    await storage.init();
    const ddl = pool.calls.map(c => c.text).join('\n');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS webapp_sequencia');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS webapp_notas');
  });

  test('registerUsedNumber uses atomic upsert with GREATEST, por ambiente', async () => {
    const pool = makeFakePool();
    const storage = new PgStorage(pool as any);
    await storage.registerUsedNumber('62050825000178', '1', 7, '2');
    const call = pool.calls[0];
    expect(call.text).toContain('ON CONFLICT (cnpj, serie, ambiente)');
    expect(call.text).toContain('GREATEST');
    expect(call.values).toEqual(['62050825000178', '1', '2', 7]);
  });

  test('registerUsedNumber sem ambiente grava em producao', async () => {
    // O lado conservador: se alguma chamada esquecer o ambiente, ela avança o
    // contador de produção — nunca o contrário, que reabriria número já emitido.
    const pool = makeFakePool();
    const storage = new PgStorage(pool as any);
    await storage.registerUsedNumber('62050825000178', '1', 7);
    expect(pool.calls[0]!.values).toEqual(['62050825000178', '1', '1', 7]);
  });

  test('peekNumber returns ultimo + 1, filtrando por ambiente', async () => {
    const pool = makeFakePool();
    pool.setNextResult({ rows: [{ ultimo: 9 }] });
    const storage = new PgStorage(pool as any);
    expect(await storage.peekNumber('62050825000178', '1', '2')).toBe(10);
    expect(pool.calls[0]!.text).toContain('ambiente = $3');
    expect(pool.calls[0]!.values).toEqual(['62050825000178', '1', '2']);
  });

  test('init separa a numeracao por ambiente sem perder o contador antigo', async () => {
    const pool = makeFakePool();
    const storage = new PgStorage(pool as any);
    await storage.init();
    const ddl = pool.calls.map(c => c.text).join('\n');
    expect(ddl).toContain('ADD COLUMN IF NOT EXISTS ambiente');
    expect(ddl).toContain('PRIMARY KEY (cnpj, serie, ambiente)');
    // A coluna nasce com DEFAULT '1': o contador herdado vira o de produção e é
    // copiado para homologação, para nenhum dos lados repetir número.
    expect(ddl).toContain(`DEFAULT '1'`);
    expect(ddl).toContain(`SELECT cnpj, serie, ultimo, '2' FROM webapp_sequencia2`);
  });

  test('peekNumber returns 1 when serie unknown', async () => {
    const pool = makeFakePool();
    pool.setNextResult({ rows: [] });
    const storage = new PgStorage(pool as any);
    expect(await storage.peekNumber('62050825000178', '1')).toBe(1);
  });

  test('saveNota uses parameterized insert with ON CONFLICT DO NOTHING', async () => {
    const pool = makeFakePool();
    const storage = new PgStorage(pool as any);
    await storage.saveNota(makeNota());
    const call = pool.calls[0];
    expect(call.text).toContain('INSERT INTO webapp_notas');
    expect(call.text).toContain('ON CONFLICT (chave_acesso) DO NOTHING');
    expect(call.values![0]).toBe('31260762050825000178550010000000011000000010');
  });

  test('updateStatus updates status and cstat', async () => {
    const pool = makeFakePool();
    const storage = new PgStorage(pool as any);
    await storage.updateStatus('x'.repeat(44), 'CANCELADA', '135');
    const call = pool.calls[0];
    expect(call.text).toContain('UPDATE webapp_notas SET status');
    expect(call.values).toEqual(['x'.repeat(44), 'CANCELADA', '135']);
  });
});

describe('createStorage', () => {
  test('returns FileStorage when dbUrl is empty', () => {
    expect(createStorage('').kind()).toBe('file');
  });

  test('returns PgStorage when dbUrl is set', () => {
    expect(createStorage('postgresql://user:pass@localhost:5432/db').kind()).toBe('postgres');
  });
});
