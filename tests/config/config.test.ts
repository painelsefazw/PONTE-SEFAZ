import { loadConfig, urlDoBanco } from '../../src/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('loadConfig', () => {
  const ORIGINAL_ENV = process.env;
  const envPath = path.resolve(process.cwd(), '.env');
  let envExisted = false;
  let originalEnvContent: string | null = null;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    envExisted = fs.existsSync(envPath);
    if (envExisted) {
      originalEnvContent = fs.readFileSync(envPath, 'utf-8');
    }
  });

  afterEach(() => {
    if (envExisted && originalEnvContent !== null) {
      fs.writeFileSync(envPath, originalEnvContent);
    } else if (!envExisted && fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
    }
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  const REQUIRED_ENV_LINES = [
    'NFE_PFX_PATH=/tmp/cert.pfx',
    'NFE_PFX_PASSWORD=senha123',
    'NFE_UF=MG',
    'NFE_CNPJ_EMITENTE=12345678000199',
    'NFE_RAZAO_SOCIAL=EMPRESA TESTE',
    'NFE_IE=1234567890',
    'NFE_LOGRADOURO=RUA TESTE',
    'NFE_NUMERO=100',
    'NFE_BAIRRO=CENTRO',
    'NFE_COD_MUNICIPIO=3106200',
    'NFE_NOME_MUNICIPIO=BELO HORIZONTE',
    'NFE_CEP=30100000',
  ];

  function setRequiredEnv() {
    process.env.NFE_PFX_PATH = '/tmp/cert.pfx';
    process.env.NFE_PFX_PASSWORD = 'senha123';
    process.env.NFE_UF = 'MG';
    process.env.NFE_DB_URL = 'postgres://localhost/nfe';
    process.env.NFE_CNPJ_EMITENTE = '12345678000199';
    process.env.NFE_RAZAO_SOCIAL = 'EMPRESA TESTE';
    process.env.NFE_IE = '1234567890';
    process.env.NFE_LOGRADOURO = 'RUA TESTE';
    process.env.NFE_NUMERO = '100';
    process.env.NFE_BAIRRO = 'CENTRO';
    process.env.NFE_COD_MUNICIPIO = '3106200';
    process.env.NFE_NOME_MUNICIPIO = 'BELO HORIZONTE';
    process.env.NFE_CEP = '30100000';
  }

  function writeMinimalEnv() {
    fs.writeFileSync(envPath, REQUIRED_ENV_LINES.join('\n'));
  }

  test('should load all required config from env vars', () => {
    setRequiredEnv();
    const config = loadConfig();
    expect(config.pfxPath).toBe('/tmp/cert.pfx');
    expect(config.uf).toBe('MG');
    expect(config.cnpjEmitente).toBe('12345678000199');
    expect(config.endereco.logradouro).toBe('RUA TESTE');
    expect(config.endereco.codigoMunicipio).toBe('3106200');
  });

  test('should throw when required var is missing', () => {
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
    }
    delete process.env.NFE_PFX_PATH;
    delete process.env.NFE_PFX_PASSWORD;
    delete process.env.NFE_UF;
    delete process.env.NFE_DB_URL;
    delete process.env.NFE_CNPJ_EMITENTE;
    delete process.env.NFE_RAZAO_SOCIAL;
    delete process.env.NFE_IE;
    delete process.env.NFE_LOGRADOURO;
    delete process.env.NFE_NUMERO;
    delete process.env.NFE_BAIRRO;
    delete process.env.NFE_COD_MUNICIPIO;
    delete process.env.NFE_NOME_MUNICIPIO;
    delete process.env.NFE_CEP;
    expect(() => loadConfig()).toThrow('NFE_PFX_PATH');
  });

  test('should use defaults for optional vars', () => {
    setRequiredEnv();
    delete process.env.NFE_AMBIENTE;
    delete process.env.NFE_CRT;
    delete process.env.NFE_TIMEOUT_MS;
    delete process.env.NFE_MAX_RETRIES;
    delete process.env.NFE_FANTASIA;
    delete process.env.NFE_DB_URL;
    writeMinimalEnv();
    const config = loadConfig();
    expect(config.ambiente).toBe('2');
    expect(config.crt).toBe('1');
    expect(config.timeoutMs).toBe(30000);
    expect(config.maxRetries).toBe(3);
    expect(config.fantasia).toBe('');
  });

  test('should override defaults when env vars are set', () => {
    setRequiredEnv();
    process.env.NFE_AMBIENTE = '1';
    process.env.NFE_CRT = '3';
    process.env.NFE_TIMEOUT_MS = '60000';
    process.env.NFE_FANTASIA = 'TESTE FANTASIA';
    const config = loadConfig();
    expect(config.ambiente).toBe('1');
    expect(config.crt).toBe('3');
    expect(config.timeoutMs).toBe(60000);
    expect(config.fantasia).toBe('TESTE FANTASIA');
  });

  test('should load config from .env file when it exists', () => {
    fs.writeFileSync(envPath, [
      'NFE_PFX_PATH=/from/env/file.pfx',
      'NFE_PFX_PASSWORD=fromfile',
      'NFE_UF=SP',
      'NFE_DB_URL=postgres://envfile/nfe',
      'NFE_CNPJ_EMITENTE=99887766000155',
      'NFE_RAZAO_SOCIAL=FROM ENVFILE',
      'NFE_IE=9876543210',
      'NFE_LOGRADOURO=AV PAULISTA',
      'NFE_NUMERO=1000',
      'NFE_BAIRRO=BELA VISTA',
      'NFE_COD_MUNICIPIO=3550308',
      'NFE_NOME_MUNICIPIO=SAO PAULO',
      'NFE_CEP=01310100',
      '# This is a comment',
      '',
      'NFE_CRT="3"',
    ].join('\n'));
    delete process.env.NFE_PFX_PATH;
    delete process.env.NFE_PFX_PASSWORD;
    delete process.env.NFE_UF;
    delete process.env.NFE_DB_URL;
    delete process.env.NFE_CNPJ_EMITENTE;
    delete process.env.NFE_RAZAO_SOCIAL;
    delete process.env.NFE_IE;
    delete process.env.NFE_CRT;
    delete process.env.NFE_LOGRADOURO;
    delete process.env.NFE_NUMERO;
    delete process.env.NFE_BAIRRO;
    delete process.env.NFE_COD_MUNICIPIO;
    delete process.env.NFE_NOME_MUNICIPIO;
    delete process.env.NFE_CEP;
    const config = loadConfig();
    expect(config.pfxPath).toBe('/from/env/file.pfx');
    expect(config.uf).toBe('SP');
    expect(config.crt).toBe('3');
    expect(config.endereco.logradouro).toBe('AV PAULISTA');
    expect(config.endereco.nomeMunicipio).toBe('SAO PAULO');
  });

  test('should not override existing env vars from .env file', () => {
    fs.writeFileSync(envPath, ['NFE_UF=RJ', ...REQUIRED_ENV_LINES.slice(1)].join('\n'));
    setRequiredEnv();
    const config = loadConfig();
    expect(config.uf).toBe('MG');
  });
});

/**
 * Copiar connection string a mao e a etapa que mais quebra numa instalacao
 * nova, e os erros que ela produz nao apontam para a causa: um espaco no meio
 * vira `ENOTFOUND` de um host que ninguem escreveu, e um simbolo nao codificado
 * na senha a corta pela metade e vira `password authentication failed`, como se
 * a senha estivesse errada.
 *
 * A integracao Supabase-Vercel escreve `POSTGRES_URL` sozinha. Aceitar esse
 * nome tira a digitacao do caminho.
 */
describe('urlDoBanco', () => {
  const ORIGINAL_ENV = process.env;
  const raizOriginal = process.cwd();
  let pastaVazia = '';

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env['NFE_DB_URL'];
    delete process.env['POSTGRES_URL'];
    delete process.env['NFE_DB_PASSWORD'];
    delete process.env['NFE_DB_REF'];
    delete process.env['NFE_DB_HOST'];
    delete process.env['NFE_DB_PORT'];
    delete process.env['NFE_DB_NAME'];

    /**
     * `urlDoBanco` le o `.env` do disco antes de olhar o ambiente, e na maquina
     * de quem desenvolve esse arquivo existe e tem um banco de verdade dentro.
     *
     * A primeira versao disto APAGAVA o `.env` e devolvia no fim — e derrubou
     * outra suite. O Jest roda suites em paralelo, em processos diferentes, mas
     * o disco e o mesmo: outra suite leu o arquivo justo no intervalo em que
     * ele nao existia. O sintoma foi uma falha que nao tinha relacao nenhuma
     * com o que mudou.
     *
     * Mudar o diretorio de trabalho resolve sem tocar em arquivo compartilhado:
     * o caminho passa a apontar para uma pasta vazia, e `process.cwd()` e por
     * processo — nao vaza para as outras suites.
     */
    pastaVazia = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-env-'));
    process.chdir(pastaVazia);
  });

  afterEach(() => {
    process.chdir(raizOriginal);
    fs.rmSync(pastaVazia, { recursive: true, force: true });
    process.env = ORIGINAL_ENV;
  });

  test('usa NFE_DB_URL quando ela existe', () => {
    process.env['NFE_DB_URL'] = 'postgresql://a:b@host:5432/db';
    expect(urlDoBanco()).toBe('postgresql://a:b@host:5432/db');
  });

  test('cai para POSTGRES_URL, que a integracao Supabase-Vercel escreve', () => {
    process.env['POSTGRES_URL'] = 'postgresql://c:d@pooler:6543/db';
    expect(urlDoBanco()).toBe('postgresql://c:d@pooler:6543/db');
  });

  test('NFE_DB_URL vence, para nao atropelar quem configurou a mao', () => {
    // Quem aponta para um banco que nao e do Supabase nao pode ter a escolha
    // trocada por uma variavel que uma integracao criou sozinha.
    process.env['NFE_DB_URL'] = 'postgresql://meu:banco@proprio:5432/db';
    process.env['POSTGRES_URL'] = 'postgresql://c:d@pooler:6543/db';
    expect(urlDoBanco()).toBe('postgresql://meu:banco@proprio:5432/db');
  });

  test('NFE_DB_URL vazia nao bloqueia a integracao', () => {
    // A tela de importacao da Vercel cria uma linha para cada variavel do
    // .env.example: `NFE_DB_URL` nasce existindo e VAZIA. Se vazia contasse
    // como escolha, a integracao ficaria inerte sem ninguem entender por que.
    process.env['NFE_DB_URL'] = '   ';
    process.env['POSTGRES_URL'] = 'postgresql://c:d@pooler:6543/db';
    expect(urlDoBanco()).toBe('postgresql://c:d@pooler:6543/db');
  });

  test('sem nenhuma das duas, devolve vazio em vez de explodir', () => {
    expect(urlDoBanco()).toBe('');
  });

  describe('montada a partir das partes', () => {
    // A connection string obriga senha, host, porta, usuario e banco a viajarem
    // num texto so, e cada modo de estragar mente sobre a causa. Separadas, a
    // senha vai sozinha num campo, sem sintaxe em volta para quebrar.
    const partes = () => {
      process.env['NFE_DB_REF'] = 'abcdefghijklmnop';
      process.env['NFE_DB_HOST'] = 'aws-0-us-west-2.pooler.supabase.com';
    };

    test('monta a URL do pooler com o usuario no formato do Supabase', () => {
      partes();
      process.env['NFE_DB_PASSWORD'] = 'SenhaSimples123';
      expect(urlDoBanco()).toBe(
        'postgresql://postgres.abcdefghijklmnop:SenhaSimples123'
        + '@aws-0-us-west-2.pooler.supabase.com:6543/postgres',
      );
    });

    test('codifica os simbolos da senha, que era o erro que se disfarcava de senha errada', () => {
      // `@`, `#`, `%`, `+` e `/` tem significado dentro de uma URL: crus, cortam
      // a senha pela metade e o banco responde `password authentication failed`
      // — indistinguivel de senha de fato errada, e leva a resetar a senha a toa.
      partes();
      process.env['NFE_DB_PASSWORD'] = 'a@b#c%d+e/f';
      expect(urlDoBanco()).toContain(':a%40b%23c%25d%2Be%2Ff@');
    });

    test('espaco sobrando no fim nao conta', () => {
      // Espaco no fim de um campo colado e sempre acidente, e era o que virava
      // `ENOTFOUND` de um host que ninguem tinha escrito.
      partes();
      process.env['NFE_DB_PASSWORD'] = '  SenhaSimples123  ';
      expect(urlDoBanco()).toContain(':SenhaSimples123@');
    });

    test('porta e banco tem padrao, para sobrar menos campo para preencher', () => {
      partes();
      process.env['NFE_DB_PASSWORD'] = 'x';
      expect(urlDoBanco()).toContain(':6543/postgres');
    });

    test('faltando qualquer parte, devolve vazio em vez de montar URL quebrada', () => {
      // Melhor nao ter banco do que ter um endereco pela metade: o erro de
      // conexao apontaria para o servidor, e nao para o campo em branco.
      partes();
      expect(urlDoBanco()).toBe('');
    });

    test('uma URL pronta continua vencendo as partes', () => {
      partes();
      process.env['NFE_DB_PASSWORD'] = 'x';
      process.env['NFE_DB_URL'] = 'postgresql://a:b@host:5432/db';
      expect(urlDoBanco()).toBe('postgresql://a:b@host:5432/db');
    });
  });
});
