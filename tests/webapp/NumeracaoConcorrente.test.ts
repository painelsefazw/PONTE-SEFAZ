import { FileStorage } from '../../src/webapp/storage';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Numeracao sob concorrencia.
 *
 * `peekNumber` LE e soma 1. Duas emissoes simultaneas leem o mesmo `ultimo` e
 * recebem o MESMO numero — a segunda volta da SEFAZ como duplicidade (cStat
 * 539). So aparece com dois operadores ao mesmo tempo ou com volume, e por isso
 * passava despercebido ate doer.
 *
 * `reservarNumero` resolve reservando de forma atomica. Mas reservar cria um
 * problema novo: numero reservado numa nota que nao sai vira buraco na
 * numeracao, e buraco so se fecha com inutilizacao. Por isso existe
 * `devolverNumero`, e por isso ele so devolve se o numero ainda for o ultimo.
 *
 * Estes testes rodam sobre o armazenamento em ARQUIVO. A garantia real de
 * atomicidade e do Postgres (INSERT ... ON CONFLICT DO UPDATE ... RETURNING,
 * que trava a linha); aqui o que se prova e o CONTRATO — que as duas
 * implementacoes precisam cumprir igual.
 */

/**
 * `FileStorage` direto, e nao `createStorage`: aquele trata o argumento como URL
 * de banco, e um diretorio ali vira tentativa de conexao com Postgres.
 */
function storageTemporario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-'));
  return { storage: new FileStorage(dir), dir };
}

const CNPJ = '50229544000106';

describe('reserva de numero', () => {
  test('duas reservas seguidas nunca repetem', () => {
    const { storage } = storageTemporario();
    return (async () => {
      const a = await storage.reservarNumero(CNPJ, '1', '1');
      const b = await storage.reservarNumero(CNPJ, '1', '1');
      expect(b).toBe(a + 1);
    })();
  });

  test('peek continua sem consumir — e o que a tela usa', () => {
    const { storage } = storageTemporario();
    return (async () => {
      // A tela mostra o proximo numero antes de o operador decidir emitir.
      // Se `peek` consumisse, abrir a tela e desistir queimaria numeracao.
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(1);
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(1);
      await storage.reservarNumero(CNPJ, '1', '1');
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(2);
    })();
  });

  test('a contagem continua separada por ambiente', () => {
    const { storage } = storageTemporario();
    return (async () => {
      // Producao e homologacao dividiam o mesmo contador ate isso ser
      // corrigido; a reserva nao pode desfazer aquilo.
      expect(await storage.reservarNumero(CNPJ, '1', '1')).toBe(1);
      expect(await storage.reservarNumero(CNPJ, '1', '2')).toBe(1);
      expect(await storage.reservarNumero(CNPJ, '1', '1')).toBe(2);
    })();
  });

  test('e separada por serie', () => {
    const { storage } = storageTemporario();
    return (async () => {
      expect(await storage.reservarNumero(CNPJ, '1', '1')).toBe(1);
      expect(await storage.reservarNumero(CNPJ, '880', '1')).toBe(1);
    })();
  });
});

describe('devolucao — rejeicao nao pode queimar numeracao', () => {
  test('devolve quando ainda e o ultimo', () => {
    const { storage } = storageTemporario();
    return (async () => {
      const n = await storage.reservarNumero(CNPJ, '1', '1');
      await storage.devolverNumero(CNPJ, '1', n, '1');
      // O proximo volta a ser o mesmo: a nota rejeitada nao abriu buraco.
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(n);
    })();
  });

  test('NAO devolve quando outra emissao ja passou por cima', () => {
    const { storage } = storageTemporario();
    return (async () => {
      const a = await storage.reservarNumero(CNPJ, '1', '1'); // 1
      const b = await storage.reservarNumero(CNPJ, '1', '1'); // 2
      // A nota 1 falhou, mas a 2 ja saiu. Devolver o 1 faria o proximo ser 2 de
      // novo — recriando exatamente a duplicidade que a reserva evita.
      await storage.devolverNumero(CNPJ, '1', a, '1');
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(b + 1);
    })();
  });

  test('devolver duas vezes nao anda para tras duas vezes', () => {
    const { storage } = storageTemporario();
    return (async () => {
      const n = await storage.reservarNumero(CNPJ, '1', '1');
      await storage.devolverNumero(CNPJ, '1', n, '1');
      await storage.devolverNumero(CNPJ, '1', n, '1');
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(n);
    })();
  });
});

describe('convivencia com o registro pos-autorizacao', () => {
  test('registerUsedNumber continua avancando e nunca recua', () => {
    const { storage } = storageTemporario();
    return (async () => {
      // O ERP que numera por conta propria continua funcionando: informar um
      // numero alto avanca o contador, e um baixo nao o puxa para tras.
      await storage.registerUsedNumber(CNPJ, '1', 50, '1');
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(51);
      await storage.registerUsedNumber(CNPJ, '1', 10, '1');
      expect(await storage.peekNumber(CNPJ, '1', '1')).toBe(51);
    })();
  });
});
