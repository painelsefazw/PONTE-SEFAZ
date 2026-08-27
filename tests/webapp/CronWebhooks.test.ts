import * as fs from 'fs';
import * as path from 'path';

/**
 * A rota de cron do reenvio de webhooks.
 *
 * Ela fica ANTES do middleware de senha — o Vercel Cron nao tem como mandar a
 * senha da plataforma —, entao e a unica coisa entre a internet e um endpoint
 * que dispara entregas. O que se prova aqui e que ela nao pode ser aberta:
 *
 *  - sem `CRON_SECRET` definido, DESLIGADA (nao "livre");
 *  - com o segredo definido, so passa com o Bearer exato.
 *
 * A inversao mais provavel — `if (!segredo) permitir` — deixaria a rota publica
 * em toda instalacao que esqueceu de configurar, que sao justamente as que nao
 * olhariam.
 */

const fonte = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8',
);

const rota = (() => {
  const i = fonte.indexOf("app.get('/api/cron/webhooks-retry'");
  expect(i).toBeGreaterThan(-1);
  return fonte.slice(i, i + 1200);
})();

describe('protecao da rota de cron', () => {
  test('segredo ausente desliga, em vez de liberar', () => {
    expect(rota).toMatch(/if\s*\(\s*!segredo\s*\|\|/);
  });

  test('a comparacao e com o Bearer exato', () => {
    expect(rota).toMatch(/authorization'\]\s*!==\s*`Bearer \$\{segredo\}`/);
  });

  test('recusa com 403 e diz como disparar sem o cron', () => {
    expect(rota).toMatch(/status\(403\)/);
    expect(rota).toMatch(/admin\/webhooks\/reprocessar/);
  });

  test('nao ha caminho que chame o reprocessamento antes da conferencia', () => {
    const guarda = rota.indexOf('res.status(403)');
    const trabalho = rota.indexOf('reprocessarPendentes');
    expect(guarda).toBeGreaterThan(-1);
    expect(trabalho).toBeGreaterThan(guarda);
  });
});

describe('agendamento', () => {
  test('o cron esta declarado no vercel.json', () => {
    // Sem esta entrada a rota existe e nunca e chamada — que e exatamente o
    // estado anterior: `next_retry_at` gravado e nunca lido.
    const vercel = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'vercel.json'), 'utf8',
    ));
    const paths = (vercel.crons || []).map((c: { path: string }) => c.path);
    expect(paths).toContain('/api/cron/webhooks-retry');
  });

  test('nenhum cron roda mais de 1x por dia — Hobby REPROVA o deploy', () => {
    // Nao e degradacao: a Vercel recusa a expressao na validacao, antes de criar
    // o deployment. Nada aparece em `vercel ls`, o site segue servindo o build
    // anterior, e o sintoma e "minha mudanca nao subiu" — foi assim que tres
    // commits ficaram fora de producao com `0 * * * *`.
    //
    // 1x/dia significa: minuto e hora fixos (nem `*`, nem `*/n`, nem lista).
    const vercel = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'vercel.json'), 'utf8',
    ));
    for (const c of (vercel.crons || []) as Array<{ path: string; schedule: string }>) {
      const [minuto, hora] = c.schedule.split(' ');
      expect(`${c.path} minuto=${minuto}`).toMatch(/minuto=\d+$/);
      expect(`${c.path} hora=${hora}`).toMatch(/hora=\d+$/);
    }
  });

  test('no maximo 2 crons — e o teto do plano Hobby', () => {
    const vercel = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'vercel.json'), 'utf8',
    ));
    expect((vercel.crons || []).length).toBeLessThanOrEqual(2);
  });

  test('o keepalive continua agendado', () => {
    // Ele existe porque o Supabase free pausa o banco depois de 7 dias sem
    // query. Perder este cron derruba o sistema inteiro, em silencio, uma
    // semana depois — vale travar junto.
    const vercel = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'vercel.json'), 'utf8',
    ));
    const paths = (vercel.crons || []).map((c: { path: string }) => c.path);
    expect(paths).toContain('/api/keepalive');
  });
});

describe('a documentacao nao promete mais do que o agendamento entrega', () => {
  test('o contrato diz que as esperas sao pisos, nao horarios', () => {
    // "5, 10, 20, 40 minutos" sozinho vira promessa de relogio, e o reenvio sai
    // na varredura seguinte — nao no instante em que a espera vence.
    expect(fonte).toMatch(/varredura AGENDADA, nao no instante/);
  });
});
