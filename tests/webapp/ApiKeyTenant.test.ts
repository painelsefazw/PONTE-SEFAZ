import { ApiKeyStore } from '../../src/webapp/apikeys';

/**
 * A quem uma API Key pertence.
 *
 * O tenant de uma chave pode ser uma empresa emitente do Emissor OU um cliente
 * de API — cadastros separados, em tabelas separadas. Enquanto a validação era
 * um INNER JOIN só com webapp_empresas, toda chave emitida para cliente de API
 * nascia morta: era gravada, aparecia ativa no painel, era entregue ao cliente
 * e devolvia 401 em 100% das chamadas. Nada no log apontava a causa.
 *
 * O outro lado importa igual: afrouxar essa consulta não pode ressuscitar
 * credencial de quem foi desligado. Empresa desativada e cliente suspenso,
 * cancelado ou ainda em rascunho continuam sem emitir.
 */

const CNPJ = '66509026000178';
const CHAVE = 'nfe_live_0123456789abcdef0123456789abcdef';

type Mundo = {
  empresas?: { cnpj: string; ativa: boolean }[];
  clientes?: { cnpj: string; status: string }[];
  /** Deploy anterior à criação da tabela de clientes de API. */
  semTabelaDeClientes?: boolean;
};

function store(mundo: Mundo): ApiKeyStore {
  const pool: any = {
    async query(sql: string, params: unknown[]) {
      if (/FROM webapp_api_keys/.test(sql)) {
        return {
          rows: [{
            id: 1, empresa_cnpj: CNPJ, escopo: 'full',
            ambiente_permitido: 'producao', nome: 'Integracao',
          }],
        };
      }
      if (/FROM webapp_empresas/.test(sql)) {
        const achou = (mundo.empresas ?? []).some((e) => e.cnpj === params[0] && e.ativa);
        return { rows: achou ? [{ um: 1 }] : [] };
      }
      if (/FROM webapp_api_clients/.test(sql)) {
        if (mundo.semTabelaDeClientes) throw new Error('relation "webapp_api_clients" does not exist');
        const achou = (mundo.clientes ?? []).some(
          (c) => c.cnpj === params[0] && ['active', 'sandbox'].includes(c.status),
        );
        return { rows: achou ? [{ um: 1 }] : [] };
      }
      return { rows: [] };
    },
  };
  return new ApiKeyStore(pool);
}

describe('tenant de uma API Key', () => {
  test('empresa emitente ativa autentica', async () => {
    const ctx = await store({ empresas: [{ cnpj: CNPJ, ativa: true }] }).validar(CHAVE);
    expect(ctx?.empresaCnpj).toBe(CNPJ);
  });

  test('cliente de API ativo autentica, mesmo sem existir como emitente', async () => {
    const ctx = await store({ clientes: [{ cnpj: CNPJ, status: 'active' }] }).validar(CHAVE);
    expect(ctx?.empresaCnpj).toBe(CNPJ);
  });

  test('cliente de API em sandbox autentica', async () => {
    const ctx = await store({ clientes: [{ cnpj: CNPJ, status: 'sandbox' }] }).validar(CHAVE);
    expect(ctx).not.toBeNull();
  });

  test.each(['suspended', 'cancelled', 'draft'])(
    'cliente de API %s nao autentica',
    async (status) => {
      const ctx = await store({ clientes: [{ cnpj: CNPJ, status }] }).validar(CHAVE);
      expect(ctx).toBeNull();
    },
  );

  test('empresa desativada nao autentica', async () => {
    const ctx = await store({ empresas: [{ cnpj: CNPJ, ativa: false }] }).validar(CHAVE);
    expect(ctx).toBeNull();
  });

  test('CNPJ que nao existe em cadastro nenhum nao autentica', async () => {
    const ctx = await store({}).validar(CHAVE);
    expect(ctx).toBeNull();
  });

  // A consulta ao cadastro de clientes é tolerante a falha para não derrubar
  // quem já emitia num deploy onde a tabela ainda não existe.
  test('sem a tabela de clientes, a empresa emitente continua autenticando', async () => {
    const ctx = await store({ empresas: [{ cnpj: CNPJ, ativa: true }], semTabelaDeClientes: true }).validar(CHAVE);
    expect(ctx).not.toBeNull();
  });

  test('sem a tabela de clientes, empresa desativada segue barrada', async () => {
    const ctx = await store({ empresas: [{ cnpj: CNPJ, ativa: false }], semTabelaDeClientes: true }).validar(CHAVE);
    expect(ctx).toBeNull();
  });

  test('chave em formato invalido nem consulta o banco', async () => {
    const ctx = await store({ empresas: [{ cnpj: CNPJ, ativa: true }] }).validar('senha-qualquer');
    expect(ctx).toBeNull();
  });
});
