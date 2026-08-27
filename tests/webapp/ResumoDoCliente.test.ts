import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStorage, NotaRecord } from '../../src/webapp/storage';

/**
 * Os números que o suporte vê de um cliente.
 *
 * Quem atende decide com isto: se o total soma nota de teste, o cliente parece
 * faturar o que não faturou; se soma nota cancelada, parece dever imposto que
 * não deve. Número errado aqui é pior que número nenhum, porque ninguém
 * desconfia dele.
 */

const CNPJ = '66509026000178';
const OUTRA = '11222333000181';

function nota(over: Partial<NotaRecord>): NotaRecord {
  return {
    chaveAcesso: Math.random().toString().slice(2).padEnd(44, '0'),
    empresaCnpj: CNPJ,
    numero: '1', serie: '880', ambiente: '1',
    destNome: 'CLIENTE', destDoc: '', vNF: '100.00',
    status: 'AUTORIZADA',
    emitidaEm: new Date().toISOString(),
    ...over,
  } as NotaRecord;
}

async function comNotas(notas: NotaRecord[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-resumo-'));
  const storage = new FileStorage(dir);
  for (const n of notas) await storage.saveNota(n);
  return { storage, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('resumo do cliente', () => {
  it('conta autorizadas e canceladas separadas, em cada ambiente', async () => {
    const { storage, limpar } = await comNotas([
      nota({ numero: '1' }),
      nota({ numero: '2' }),
      nota({ numero: '3', status: 'CANCELADA' }),
      nota({ numero: '1', ambiente: '2' }),
      nota({ numero: '2', ambiente: '2', status: 'CANCELADA' }),
    ]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.producao).toMatchObject({ autorizadas: 2, canceladas: 1 });
    expect(r.homologacao).toMatchObject({ autorizadas: 1, canceladas: 1 });
    limpar();
  });

  it('o valor total soma so producao autorizada', async () => {
    const { storage, limpar } = await comNotas([
      nota({ numero: '1', vNF: '1000.00' }),
      nota({ numero: '2', vNF: '500.50' }),
      // Cancelada nao entra: a nota foi desfeita.
      nota({ numero: '3', vNF: '9999.00', status: 'CANCELADA' }),
      // Teste nao entra: nao existe fiscalmente.
      nota({ numero: '1', ambiente: '2', vNF: '7777.00' }),
    ]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.producao.valorTotal).toBe('1500.50');
    limpar();
  });

  it('nao mistura clientes — o suporte olha um de cada vez', async () => {
    const { storage, limpar } = await comNotas([
      nota({ numero: '1', vNF: '100.00' }),
      nota({ numero: '2', vNF: '200.00', empresaCnpj: OUTRA }),
    ]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.producao.autorizadas).toBe(1);
    expect(r.producao.valorTotal).toBe('100.00');
    limpar();
  });

  it('separa o ritmo: hoje e ultimos 30 dias', async () => {
    const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const { storage, limpar } = await comNotas([
      nota({ numero: '1' }),
      nota({ numero: '2' }),
      nota({ numero: '3', emitidaEm: diasAtras(10) }),
      nota({ numero: '4', emitidaEm: diasAtras(90) }),
    ]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.hoje).toBe(2);
    expect(r.ultimos30Dias).toBe(3);
    expect(r.producao.autorizadas).toBe(4);
    limpar();
  });

  it('mostra as series em uso e o ultimo numero de cada', async () => {
    const { storage, limpar } = await comNotas([
      nota({ serie: '880', numero: '1' }),
      nota({ serie: '880', numero: '7' }),
      nota({ serie: '880', numero: '3' }),
      nota({ serie: '1', numero: '42' }),
    ]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.series[0]).toEqual({ serie: '880', quantidade: 3, ultimoNumero: '7' });
    expect(r.series[1]).toEqual({ serie: '1', quantidade: 1, ultimoNumero: '42' });
    limpar();
  });

  it('cliente sem nota nenhuma devolve zeros, nao erro', async () => {
    const { storage, limpar } = await comNotas([]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.producao).toEqual({ autorizadas: 0, canceladas: 0, valorTotal: '0.00' });
    expect(r.series).toEqual([]);
    expect(r.ultimaEmissao).toBeUndefined();
    limpar();
  });

  it('primeira e ultima emissao olham so producao', async () => {
    const { storage, limpar } = await comNotas([
      nota({ numero: '1', emitidaEm: '2026-01-10T10:00:00.000Z' }),
      nota({ numero: '2', emitidaEm: '2026-06-20T10:00:00.000Z' }),
      nota({ numero: '9', ambiente: '2', emitidaEm: '2020-01-01T10:00:00.000Z' }),
    ]);
    const r = await storage.resumoEmpresa(CNPJ);
    expect(r.primeiraEmissao).toBe('2026-01-10T10:00:00.000Z');
    expect(r.ultimaEmissao).toBe('2026-06-20T10:00:00.000Z');
    limpar();
  });
});
