import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStorage } from '../../src/webapp/storage';

/**
 * Numeração separada por ambiente.
 *
 * Antes, produção e homologação dividiam o mesmo contador. Uma nota de teste
 * consumia número da série real e deixava um buraco que só se fecha com pedido
 * de inutilização à SEFAZ — o que inviabilizava ensaiar a nota antes de emitir,
 * justamente a coisa mais útil que a plataforma podia oferecer.
 *
 * O que estes testes protegem: os dois lados contam sozinhos, e o contador
 * herdado da versão antiga (que era compartilhado) vira piso dos dois, para que
 * produção nunca reemita um número que já pode ter saído.
 */

const CNPJ = '66509026000178';
const SERIE = '880';

function novoStorage(): { storage: FileStorage; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-seq-'));
  return { storage: new FileStorage(dir), dir };
}

function semearContadorAntigo(dir: string, valor: number): void {
  fs.writeFileSync(
    path.join(dir, 'sequence.json'),
    JSON.stringify({ [`${CNPJ}_serie_${SERIE}`]: valor }),
    'utf-8',
  );
}

describe('numeracao por ambiente', () => {
  let storage: FileStorage;
  let dir: string;

  beforeEach(() => {
    const novo = novoStorage();
    storage = novo.storage;
    dir = novo.dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('comeca em 1 nos dois ambientes', async () => {
    expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(1);
    expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(1);
  });

  it('emitir em homologacao nao mexe no contador de producao', async () => {
    await storage.registerUsedNumber(CNPJ, SERIE, 1, '2');
    await storage.registerUsedNumber(CNPJ, SERIE, 2, '2');
    await storage.registerUsedNumber(CNPJ, SERIE, 3, '2');

    expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(4);
    // O ponto de tudo: três ensaios e a série real continua intacta.
    expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(1);
  });

  it('emitir em producao nao mexe no contador de homologacao', async () => {
    await storage.registerUsedNumber(CNPJ, SERIE, 1, '1');
    await storage.registerUsedNumber(CNPJ, SERIE, 2, '1');

    expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(3);
    expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(1);
  });

  it('series diferentes continuam independentes dentro do ambiente', async () => {
    await storage.registerUsedNumber(CNPJ, '880', 7, '1');
    expect(await storage.peekNumber(CNPJ, '881', '1')).toBe(1);
    expect(await storage.peekNumber(CNPJ, '880', '1')).toBe(8);
  });

  it('empresas diferentes contam separado', async () => {
    await storage.registerUsedNumber(CNPJ, SERIE, 5, '1');
    expect(await storage.peekNumber('11222333000181', SERIE, '1')).toBe(1);
  });

  it('o padrao sem ambiente e producao — o lado onde repetir numero custa caro', async () => {
    await storage.registerUsedNumber(CNPJ, SERIE, 9);
    expect(await storage.peekNumber(CNPJ, SERIE)).toBe(10);
    expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(10);
    expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(1);
  });

  describe('contador herdado da versao com ambiente unico', () => {
    it('vira piso dos dois lados — producao nao reemite numero ja usado', async () => {
      semearContadorAntigo(dir, 42);
      expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(43);
      expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(43);
    });

    it('a primeira emissao apos a migracao nao retrocede', async () => {
      semearContadorAntigo(dir, 42);
      await storage.registerUsedNumber(CNPJ, SERIE, 43, '1');

      expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(44);
      // Homologação ainda enxerga o piso herdado, e não o 43 de produção.
      expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(43);
    });

    it('registrar em homologacao nao rebaixa o piso de producao', async () => {
      semearContadorAntigo(dir, 42);
      await storage.registerUsedNumber(CNPJ, SERIE, 43, '2');
      expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(43);
    });
  });

  describe('reset', () => {
    it('zerar homologacao preserva producao', async () => {
      await storage.registerUsedNumber(CNPJ, SERIE, 10, '1');
      await storage.registerUsedNumber(CNPJ, SERIE, 4, '2');

      await storage.resetSequencia(CNPJ, SERIE, '2');

      expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(1);
      expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(11);
    });

    it('zerar homologacao nao ressuscita o contador herdado em producao', async () => {
      // O valor antigo é compartilhado: apagá-lo ao limpar um lado devolveria
      // números já emitidos para o outro.
      semearContadorAntigo(dir, 42);
      await storage.resetSequencia(CNPJ, SERIE, '2');

      expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(1);
      expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(43);
    });

    it('sem ambiente, zera os dois e o herdado', async () => {
      semearContadorAntigo(dir, 42);
      await storage.registerUsedNumber(CNPJ, SERIE, 50, '1');
      await storage.registerUsedNumber(CNPJ, SERIE, 60, '2');

      await storage.resetSequencia(CNPJ, SERIE);

      expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(1);
      expect(await storage.peekNumber(CNPJ, SERIE, '2')).toBe(1);
    });
  });

  it('o contador nunca retrocede, mesmo com numero menor', async () => {
    await storage.registerUsedNumber(CNPJ, SERIE, 20, '1');
    await storage.registerUsedNumber(CNPJ, SERIE, 5, '1');
    expect(await storage.peekNumber(CNPJ, SERIE, '1')).toBe(21);
  });
});
