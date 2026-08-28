import * as fs from 'fs';
import * as path from 'path';

/**
 * O manual envelhece calado.
 *
 * Rota nova entra no código e ninguém lembra de documentá-la — e ninguém
 * descobre, porque o manual continua abrindo, bonito, com o que já tinha. Foi
 * o que aconteceu: numa medição, 49 das 81 rotas de cliente não apareciam
 * nele, incluindo a NFS-e inteira e os parâmetros do DANFE.
 *
 * Este teste é a medição virando regra. Ele lê as rotas do `app.ts` e cobra do
 * manual as que um integrador usaria — as internas (cron, diagnóstico,
 * keepalive) ficam de fora de propósito: documentá-las num manual de cliente
 * seria pior que omiti-las.
 *
 * Quando ele quebrar, há duas saídas honestas: documentar a rota nova, ou
 * declará-la interna aqui embaixo, com o motivo. O que não dá é seguir sem
 * decidir.
 */

const app = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8');

/** Rotas que NÃO pertencem a um manual de integração, e por quê. */
const INTERNAS = [
  { prefixo: '/api/admin/', motivo: 'painel do contador, não do cliente' },
  { prefixo: '/api/cron/', motivo: 'chamada pelo agendador da Vercel' },
  { prefixo: '/api/diagnostico/', motivo: 'apoio à instalação' },
  { prefixo: '/api/keepalive', motivo: 'mantém o banco acordado' },
  { prefixo: '/api/importar-modelo', motivo: 'planilha de exemplo, sem autenticação' },
  { prefixo: '/api/ping', motivo: 'health check, documentado à parte' },
  { prefixo: '/api/config', motivo: 'estado da instalação, consumido pelo próprio painel' },
  { prefixo: '/api/docs', motivo: 'é o próprio manual' },
  { prefixo: '/api/notas/homologacao', motivo: 'limpeza operacional do painel' },
  { prefixo: '/api/nfse/homologacao', motivo: 'idem' },
  { prefixo: '/api/ncm/importar', motivo: 'carga da tabela NCM, feita uma vez na instalação' },
  { prefixo: '/api/configuracoes', motivo: 'SMTP da instalação, não da integração' },
];

const rotasDoCodigo = () => {
  const achadas = new Set<string>();
  const re = /app\.(get|post|delete|patch|put)\('(\/api\/[^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(app))) {
    const rota = m[2]!;
    if (INTERNAS.some((i) => rota.startsWith(i.prefixo))) continue;
    achadas.add(rota);
  }
  return [...achadas];
};

const manual = () => {
  const i = app.indexOf("titulo: 'Ponte SEFAZ");
  expect(i).toBeGreaterThan(-1);
  return app.slice(i, i + 90000);
};

describe('o manual acompanha a API', () => {
  test('toda rota de cliente aparece no manual', () => {
    const doc = manual();
    const faltando = rotasDoCodigo().filter((rota) => {
      // `/api/nfse/:chave/xml` no código vira `/api/nfse/{chave}/xml` no manual,
      // e rotas com filtro aparecem como `/api/cfop?tipo=...`. Compara-se o
      // caminho até o primeiro parâmetro.
      const base = rota.split('/:')[0]!;
      return !doc.includes(base);
    });
    expect(faltando).toEqual([]);
  });

  test('a NFS-e tem categoria propria', () => {
    // Ela ficou de fora por muito tempo, e nao e um detalhe: e um documento
    // inteiro. A partir de 01/09/2026 a empresa do Simples que presta servico
    // so emite por ele.
    const doc = manual();
    expect(doc).toContain('Emissao de NFS-e (Sistema Nacional)');
    expect(doc).toContain('/api/nfse/emitir');
    // O convenio do municipio vem antes de tudo: sem adesao da prefeitura,
    // nenhuma nota sai, e nao ha ajuste no ERP que contorne.
    expect(doc).toContain('/api/nfse/convenio');
    // O aviso de que a adesao e da prefeitura, e nao um ajuste no ERP.
    expect(doc).toContain('Municipio sem adesao ao Emissor Nacional');
  });

  test('os parametros do DANFE estao documentados com os limites', () => {
    const doc = manual();
    expect(doc).toContain('/api/danfe/marca');
    // Os dois limites que fazem a chamada falhar, e o porque de cada um.
    expect(doc).toContain('400 KB');
    expect(doc).toContain('2000 caracteres');
    expect(doc).toContain('`gd`');
  });

  test('o contrato legivel por maquina esta anunciado', () => {
    // Quem integra prefere importar o contrato a copiar curl da tela.
    const doc = manual();
    expect(doc).toContain('/api/openapi.json');
    expect(doc).toContain('/api/postman.json');
  });
});
