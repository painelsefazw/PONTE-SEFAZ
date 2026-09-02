import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { app, explicarErroDeBanco } from '../../src/webapp/app';

/**
 * `GET /api/diagnostico/banco` — por que esta instalacao nao achou o Postgres.
 *
 * Sem ele, uma instalacao nova responde `storage: "file"` e pronto: o operador
 * preencheu tres variaveis, uma esta errada, e nada diz qual. Foi exatamente o
 * que aconteceu com a segunda instancia da ponte — no ar, respondendo 200, e
 * gravando num disco que some a cada invocacao.
 *
 * A rota fica ANTES do middleware de senha, porque quem precisa dela e
 * justamente quem ainda nao configurou a instalacao. Isso a torna PUBLICA — e
 * por isso o teste que mais importa e o que prova que ela nao vaza a senha.
 */

const SENHA = 'S3nh@#Muito+Secreta/2026';

/**
 * O `.env` da maquina de quem roda os testes NAO pode participar.
 *
 * `carregarArquivoEnv()` le o `.env` de `process.cwd()`. Rodando na raiz do
 * repositorio, ele preenche NFE_DB_HOST e companhia — e todo caso de "banco nao
 * configurado" passa a enxergar um banco configurado. A primeira versao deste
 * arquivo falhou por isso, com o host da maquina aparecendo no lugar do host do
 * teste.
 */
const cwdOriginal = process.cwd();
const envOriginal = { ...process.env };
let dirLimpo: string;

beforeAll(() => { dirLimpo = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-env-')); });
beforeEach(() => {
  process.chdir(dirLimpo);
  for (const n of ['NFE_DB_URL', 'POSTGRES_URL', 'NFE_DB_PASSWORD', 'NFE_DB_REF',
    'NFE_DB_HOST', 'NFE_DB_PORT', 'NFE_DB_NAME']) delete process.env[n];
});
afterEach(() => { process.chdir(cwdOriginal); process.env = { ...envOriginal }; });

async function diagnostico(): Promise<{ status: number; corpo: any }> {
  const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
  const camada = stack.find((l) => l.route?.path === '/api/diagnostico/banco');
  expect(camada).toBeDefined();

  let corpo: any;
  let status = 200;
  const req: any = { headers: {}, protocol: 'https', get: () => 'exemplo.test', query: {} };
  const res: any = {
    json: (b: any) => { corpo = b; return res; },
    status: (c: number) => { status = c; return res; },
    setHeader: () => res,
  };
  await camada.route.stack[0].handle(req, res, () => {});
  return { status, corpo };
}

/** As tres partes preenchidas, apontando para um host que nao existe. */
function comPartes(host = 'host-que-nao-existe.invalido.test') {
  process.env['NFE_DB_PASSWORD'] = SENHA;
  process.env['NFE_DB_REF'] = 'rjmspbooiwvzjkyqmdre';
  process.env['NFE_DB_HOST'] = host;
}

describe('nao vaza segredo — a rota e publica', () => {
  test('a senha nao aparece na resposta', async () => {
    comPartes();
    const texto = JSON.stringify((await diagnostico()).corpo);
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain(encodeURIComponent(SENHA));
  });

  test('nem mascarada — mascarar ja diz o tamanho', async () => {
    comPartes();
    expect(JSON.stringify((await diagnostico()).corpo)).not.toMatch(/\*{3,}/);
  });

  test('a URL montada nao e devolvida', async () => {
    comPartes();
    expect(JSON.stringify((await diagnostico()).corpo)).not.toContain('postgresql://');
  });

  test('diz presente/ausente, nunca o valor do segredo', async () => {
    comPartes();
    expect((await diagnostico()).corpo.variaveis.NFE_DB_PASSWORD).toBe('presente');
  });
});

describe('sem banco configurado', () => {
  test('responde 503, e nao 200 — nao esta pronto', async () => {
    // 200 aqui faria um monitor externo considerar a instalacao saudavel.
    expect((await diagnostico()).status).toBe(503);
  });

  test('avisa que arquivo em serverless PERDE os dados', async () => {
    // O ponto que ninguem descobre sozinho: parece que funciona.
    const { corpo } = await diagnostico();
    expect(corpo.alerta).toMatch(/disco\s+vazio/i);
    expect(corpo.alerta).toMatch(/Parece que funciona/);
  });

  test('lista as tres variaveis que resolveriam', async () => {
    expect((await diagnostico()).corpo.faltando).toEqual(
      expect.arrayContaining(['NFE_DB_PASSWORD', 'NFE_DB_REF', 'NFE_DB_HOST']),
    );
  });

  test('lembra que variavel nova exige redeploy', async () => {
    // Salvar na Vercel e nao republicar e a armadilha seguinte, e o operador
    // conclui que a variavel "nao funcionou".
    expect((await diagnostico()).corpo.ondeConfigurar).toMatch(/REDEPLOY/);
  });
});

describe('partes pela metade — o caso da ponte', () => {
  test('com duas das tres, diz exatamente qual falta', async () => {
    // As tres so valem juntas: com uma ausente o codigo ignora as outras duas e
    // cai no arquivo, em silencio. Era este o estado da segunda instancia.
    process.env['NFE_DB_PASSWORD'] = SENHA;
    process.env['NFE_DB_REF'] = 'rjmspbooiwvzjkyqmdre';

    const { status, corpo } = await diagnostico();
    expect(status).toBe(503);
    expect(corpo.faltando).toEqual(['NFE_DB_HOST']);
    expect(corpo.comoResolver).toMatch(/valem juntas/);
  });

  test('e mostra o que JA chegou, para nao repetir trabalho', async () => {
    process.env['NFE_DB_PASSWORD'] = SENHA;
    process.env['NFE_DB_REF'] = 'rjmspbooiwvzjkyqmdre';

    const { corpo } = await diagnostico();
    expect(corpo.variaveis.NFE_DB_REF).toBe('presente');
    expect(corpo.variaveis.NFE_DB_HOST).toBe('ausente');
  });
});

/**
 * A traducao do erro do driver, como funcao pura.
 *
 * Testada aqui e nao pela rota porque `getStorage()` guarda a conexao em cache
 * de modulo: o primeiro teste que conectasse decidiria o resultado de todos os
 * seguintes. Funcao pura nao tem esse problema — e e nela que mora o valor.
 */
describe('traducao do erro do driver', () => {
  const casos: Array<[string, RegExp]> = [
    ['getaddrinfo ENOTFOUND base', /HOST n.o foi encontrado/],
    ['getaddrinfo EAI_AGAIN pooler', /HOST n.o foi encontrado/],
    ['password authentication failed for user postgres', /senha foi RECUSADA/],
    ['connect ETIMEDOUT 10.0.0.1:6543', /6543/],
    ['connect ECONNREFUSED 127.0.0.1:5432', /pausado por inatividade/],
    ['database postgres does not exist', /Confira NFE_DB_REF/],
    ['self signed certificate in certificate chain', /host errado/],
    ['(ENOTFOUND) tenant/user postgres.abc not found', /pooler RESPONDEU/],
  ];

  test.each(casos)('%s vira explicacao', (cru, esperado) => {
    expect(explicarErroDeBanco(cru)).toMatch(esperado);
  });

  test('o ENOTFOUND cita a causa real, e nao so o codigo', () => {
    // Foi assim que a palavra "base", de uma pagina traduzida pelo navegador,
    // virou nome de servidor.
    expect(explicarErroDeBanco('getaddrinfo ENOTFOUND base'))
      .toMatch(/traduzida pelo navegador/);
  });

  test('tenant nao encontrado NAO manda conferir espaco no host', () => {
    // Este caso enganou de verdade. O Supavisor embrulha a resposta dele como
    // `(ENOTFOUND) tenant/user postgres.<ref> not found`, e o codigo de DNS ali
    // e mentira: o host resolveu e RESPONDEU — quem respondeu foi o pooler,
    // dizendo que nao hospeda o projeto. Casando primeiro com ENOTFOUND, a
    // explicacao mandava cacar um espaco colado no fim do NFE_DB_HOST, um erro
    // de digitacao que nao existia, enquanto a causa real era o projeto ter
    // sumido. Por isso este caso vem ANTES na cadeia.
    const dito = explicarErroDeBanco('(ENOTFOUND) tenant/user postgres.ddfoo not found')!;
    // A explicacao de DNS nao pode ser esta — e nem parecida com ela. Dizer
    // "nao e host com espaco" faz parte da resposta certa: descarta de saida o
    // caminho que o codigo `ENOTFOUND` sugere sozinho.
    expect(dito).not.toBe(explicarErroDeBanco('getaddrinfo ENOTFOUND base'));
    expect(dito).not.toMatch(/costuma vir com espaço/);
    expect(dito).toMatch(/regi.o|pausado|removido/i);
    // E aponta a ferramenta que responde a pergunta em vez de deixar adivinhar.
    expect(dito).toContain('/api/diagnostico/pooler');
  });

  test('a senha recusada aponta o simbolo, e nao trocar a senha', () => {
    // Resetar a senha nao resolve: a nova tem outro simbolo e o ciclo recomeca.
    expect(explicarErroDeBanco('password authentication failed'))
      .toMatch(/@ # % \+ \//);
  });

  test('erro desconhecido devolve null, em vez de inventar causa', () => {
    // Causa provavel errada e pior que nenhuma: manda procurar no lugar errado
    // com confianca.
    expect(explicarErroDeBanco('algo que ninguem previu')).toBeNull();
    expect(explicarErroDeBanco('')).toBeNull();
  });
});


/**
 * `GET /api/keepalive` — o sinal que era olhado, e que estava verde errado.
 *
 * Ele respondia `{ok:true, storage:"file"}` com 200 quando o banco nao estava
 * configurado. Tecnicamente verdade — o SELECT no arquivo funcionou — e
 * praticamente uma mentira, porque em serverless o disco some a cada
 * invocacao. Ninguem procura defeito onde o monitor diz que esta tudo bem, e a
 * instalacao ficou cinco dias assim.
 *
 * O criterio e a PLATAFORMA, nao o modo: local com arquivo e legitimo.
 */
describe('keepalive nao pode dizer que esta bem sem banco', () => {
  async function keepalive(): Promise<{ status: number; corpo: any }> {
    const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
    const camada = stack.find((l) => l.route?.path === '/api/keepalive');
    expect(camada).toBeDefined();

    let corpo: any;
    let status = 200;
    const req: any = { headers: {}, protocol: 'https', get: () => 'exemplo.test', query: {} };
    const res: any = {
      json: (b: any) => { corpo = b; return res; },
      status: (c: number) => { status = c; return res; },
      setHeader: () => res,
    };
    await camada.route.stack[0].handle(req, res, () => {});
    return { status, corpo };
  }

  test('na Vercel, sem banco, responde 503 em vez de 200', async () => {
    process.env['VERCEL'] = '1';
    const { status, corpo } = await keepalive();
    expect(status).toBe(503);
    expect(corpo.ok).toBe(false);
    expect(corpo.storage).toBe('file');
  });

  test('e diz que o que for gravado nao sobrevive, em vez de so citar o modo', async () => {
    // "storage: file" nao significa nada para quem esta instalando. O que
    // significa e que a empresa cadastrada some.
    process.env['VERCEL'] = '1';
    const { corpo } = await keepalive();
    expect(corpo.erro).toMatch(/disco vazio|nao sobrevive/i);
    expect(corpo.veja).toBe('/api/diagnostico/banco');
  });

  test('fora da Vercel, arquivo continua sendo modo legitimo', async () => {
    // `npm run dev` sem banco tem disco que persiste entre requisicoes. Falhar
    // aqui obrigaria a subir um Postgres so para abrir o painel local.
    delete process.env['VERCEL'];
    const { status, corpo } = await keepalive();
    expect(status).toBe(200);
    expect(corpo.ok).toBe(true);
  });
});
