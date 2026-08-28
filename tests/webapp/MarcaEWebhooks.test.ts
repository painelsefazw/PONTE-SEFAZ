import * as fs from 'fs';
import * as path from 'path';

const html = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');
const appTs = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8');

/**
 * O titulo era fixo em "NF-e Engine".
 *
 * Numa instalacao que voce revende — ou que o cliente opera — o nome do
 * fornecedor no topo e, no minimo, estranho. E cada instancia gerada nascia
 * com o mesmo nome, sem jeito de distinguir uma da outra.
 */
describe('a instancia tem nome proprio', () => {
  test('o /api/ping devolve a marca, com o antigo como padrao', () => {
    expect(appTs).toContain("marca: String(process.env['WEBAPP_MARCA']");
    // Quem nao configurar nada continua vendo o nome de sempre: a mudanca nao
    // pode renomear instalacao que ja existe.
    expect(appTs).toMatch(/WEBAPP_MARCA[\s\S]{0,60}'Ponte SEFAZ'/);
  });

  test('a marca da instancia vive no titulo da aba', () => {
    // Ela ficava tambem num cabecalho, que saiu: gastava uma faixa inteira em
    // toda tela para repetir o nome do sistema em que a pessoa acabou de
    // entrar. A aba do navegador continua precisando dele — com varias
    // abertas, todas iguais, nao da para saber qual e qual.
    expect(html).toContain('document.title = ping.marca');
    expect(html).not.toContain('id="marcaDaInstancia"');
  });
});

/**
 * Webhooks tinham rotas e nenhuma tela.
 *
 * O cliente configurava o endpoint, as entregas falhavam, e do lado de ca nao
 * havia como ver. O sintoma chegava pelo cliente dizendo "nao recebi", sem
 * nada para conferir — e o reenvio so acontecia no cron do dia seguinte.
 */
describe('webhooks ganharam tela', () => {
  test('da para ver as entregas de cada endpoint', () => {
    expect(html).toContain('/api/admin/webhooks/');
    expect(html).toMatch(/deliveries/);
    expect(html).toContain('verEntregasDoWebhook');
  });

  test('a entrega mostra se falhou, o codigo HTTP e quantas tentativas', () => {
    // "Nao recebi" so vira acao quando se sabe se saiu, com que resposta e
    // quantas vezes ja tentou.
    const fn = html.slice(html.indexOf('async function verEntregasDoWebhook'));
    expect(fn).toContain('FALHOU');
    expect(fn).toContain('statusCode');
    expect(fn).toContain('attempts');
  });

  test('da para ligar e desligar sem apagar e recriar', () => {
    expect(html).toContain('alternarWebhook');
    expect(html).toMatch(/alternarWebhook[\s\S]{0,400}'PATCH'/);
  });

  test('da para reprocessar os pendentes na hora', () => {
    // O cron roda 1x/dia — teto da conta Hobby, nao escolha. Quando o endpoint
    // do cliente volta do ar, esperar ate amanha nao serve.
    expect(html).toContain('reprocessarWebhooks');
    expect(html).toContain('/api/admin/webhooks/reprocessar');
  });

  test('a URL do webhook e escapada antes de ir para a tela', () => {
    // Ela vem do cliente. Sem escapar, um endpoint com HTML dentro executa no
    // painel de quem administra.
    const bloco = html.slice(html.indexOf('var whHtml = (d.webhooks'), html.indexOf('var whHtml = (d.webhooks') + 900);
    expect(bloco).toContain('escapeHtml((w.url');
    expect(bloco).toContain('escapeHtml((w.events');
  });
});
