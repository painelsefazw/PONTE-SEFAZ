import * as fs from 'fs';
import * as path from 'path';

/**
 * Numa ponte de revenda nao existe certificado do servidor — e isso e o normal.
 *
 * Cada cliente traz o certificado dele, guardado cifrado no banco, e e ele que
 * assina. `NFE_PFX_PATH` so faz sentido na instalacao que emite em nome
 * proprio.
 *
 * Oito rotas ignoravam isso. Elas chamavam `getConfig()`, que valida o emitente
 * INTEIRO e estoura sem `NFE_PFX_PATH` — e nenhuma delas usava outra coisa dali
 * alem de `timeoutMs`, um numero com valor padrao. O resultado: emitir,
 * cancelar, corrigir, consultar, inutilizar, manifestar e o radar respondiam
 *
 *     Variavel de ambiente obrigatoria ausente: NFE_PFX_PATH
 *
 * a quem tinha instalado tudo certo. A ponte inteira estava morta para o
 * negocio que ela existe para atender, por causa de um timeout.
 */

const app = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8').replace(/\r\n/g, '\n');

/** O corpo de uma rota: do `app.<verbo>('<caminho>'` ate a proxima rota. */
function rota(caminho: string): string {
  const i = app.indexOf(`'${caminho}'`);
  expect(i).toBeGreaterThan(-1);
  const resto = app.slice(i);
  const m = resto.slice(10).search(/\napp\.(get|post|put|delete)\(/);
  return m > -1 ? resto.slice(0, m + 10) : resto;
}

/** As rotas que um cliente de revenda usa — todas com certificado do BANCO. */
const DO_CLIENTE = [
  '/api/emitir',
  '/api/emitir-nfce',
  '/api/cancelar',
  '/api/carta-correcao',
  '/api/consultar',
  '/api/inutilizar',
  '/api/manifestar',
  '/api/nfe/distribuicao',
];

describe('ponte sem certificado proprio', () => {
  test('o timeout tem leitura propria, sem passar pelo emitente', () => {
    expect(app).toContain('function timeoutSefazMs(): number');
    const fn = app.slice(app.indexOf('function timeoutSefazMs(): number'));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain("process.env['NFE_TIMEOUT_MS']");
    // Padrao explicito: sem ele, `Number(undefined)` vira NaN e o timeout
    // desaparece — que e pior do que um valor errado, porque nao falha.
    expect(corpo).toContain('30000');
    expect(corpo).toContain('Number.isFinite');
  });

  test('nenhuma rota de cliente exige o certificado do servidor', () => {
    const culpadas = DO_CLIENTE.filter((r) => rota(r).includes('getConfig()'));
    expect(culpadas).toEqual([]);
  });

  test('o `config.timeoutMs` nao existe mais em lugar nenhum', () => {
    // Era o unico campo que essas rotas liam do emitente do servidor. Enquanto
    // a expressao existir, alguem volta a escrever `getConfig()` para chegar
    // nela.
    expect(app).not.toContain('config.timeoutMs');
  });

  test('getConfig continua onde ele e o assunto: o emitente do proprio .env', () => {
    // A checagem nao e "sumiu": e "sobrou so onde faz sentido". `resolveEmpresa`
    // cai no emitente do .env quando NAO ha empresa cadastrada nenhuma — ali
    // cobrar o certificado e o comportamento certo, porque sem ele nao ha em
    // nome de quem emitir.
    const resolve = app.slice(app.indexOf('async function resolveEmpresa('));
    const corpo = resolve.slice(0, resolve.indexOf('\napp.'));
    expect(corpo).toContain('const config = getConfig();');
    expect(corpo).toContain('config.cnpjEmitente');
  });

  test('o modo revenda continua sendo deduzido pela falta desse certificado', () => {
    // A mesma ausencia que quebrava as rotas e a que define o modo do painel.
    // Se um dia `getConfig()` parar de estourar sem certificado, esta deducao
    // muda de sentido — e o teste falha aqui, junto.
    const ping = app.slice(app.indexOf("app.get('/api/ping'"));
    expect(ping.slice(0, 600)).toContain('getConfig();');
    expect(ping.slice(0, 600)).toContain('configurado = false');
  });
});
