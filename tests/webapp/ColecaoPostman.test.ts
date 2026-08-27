import { app } from '../../src/webapp/app';

/**
 * A colecao do Postman e GERADA a partir da OpenAPI.
 *
 * Escrever a colecao a mao criaria uma segunda descricao da API para manter em
 * dia, e ela nasceria desatualizada no primeiro endpoint novo. Estes testes
 * cobrem o que a conversao precisa acertar para o integrador conseguir disparar
 * a primeira requisicao sem editar nada alem da chave.
 */

/**
 * Chama o handler direto, sem subir servidor — o padrao ja usado em
 * `OpenApi.test.ts`. Devolve o corpo e os cabecalhos escritos.
 */
function chamar(rota: string): { corpo: any; headers: Record<string, string> } {
  const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
  const camada = stack.find((l) => l.route?.path === rota);
  expect(camada).toBeDefined();

  let corpo: any;
  const headers: Record<string, string> = {};
  const req: any = { headers: {}, protocol: 'https', get: () => 'exemplo.test', query: {} };
  const res: any = {
    json: (b: any) => { corpo = b; return res; },
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res; },
  };
  camada.route.stack[0].handle(req, res, () => {});
  return { corpo, headers };
}

const pegar = (rota: string) => chamar(rota).corpo;

describe('a colecao acompanha a spec', () => {
  test('tem um item para cada operacao da OpenAPI', () => {
    {
      const spec = pegar('/api/openapi.json');
      const colecao = pegar('/api/postman.json');
      const operacoes = Object.values(spec.paths as Record<string, object>)
        .reduce((total, metodos) => total + Object.keys(metodos).length, 0);
      expect(colecao.item).toHaveLength(operacoes);
    }
  });

  test('nao sobra rota de admin — a spec ja as omite de proposito', () => {
    {
      const colecao = pegar('/api/postman.json');
      const caminhos = colecao.item.map((i: any) => i.request.url.raw);
      expect(caminhos.filter((c: string) => c.includes('/admin/'))).toEqual([]);
    }
  });
});

describe('a chave nao e colada em cada requisicao', () => {
  test('vai como variavel de colecao, vazia', () => {
    {
      // Embutir a chave em vinte requisicoes obriga o integrador a trocar em
      // vinte lugares — e a versao com a chave dentro acaba compartilhada.
      const colecao = pegar('/api/postman.json');
      const apiKey = colecao.variable.find((v: any) => v.key === 'apiKey');
      expect(apiKey).toBeDefined();
      expect(apiKey.value).toBe('');
    }
  });

  test('todo item manda o header x-api-key apontando para a variavel', () => {
    {
      const colecao = pegar('/api/postman.json');
      for (const item of colecao.item) {
        const h = item.request.header.find((x: any) => x.key === 'x-api-key');
        expect(h?.value).toBe('{{apiKey}}');
      }
    }
  });

  test('nenhuma chave real vaza para dentro da colecao', () => {
    {
      const texto = JSON.stringify(pegar('/api/postman.json'));
      expect(texto).not.toMatch(/nfe_live_\w/);
      expect(texto).not.toMatch(/nfe_test_\w/);
    }
  });
});

describe('a URL base sai da requisicao, nao cravada', () => {
  test('a variavel baseUrl aponta para o dominio que atendeu', () => {
    {
      // Um dominio cravado faz o cliente que usa dominio proprio importar uma
      // colecao que aponta para outro lugar.
      const colecao = pegar('/api/postman.json');
      const base = colecao.variable.find((v: any) => v.key === 'baseUrl');
      expect(base.value).toMatch(/^https?:\/\//);
    }
  });

  test('as URLs dos itens usam a variavel', () => {
    {
      const colecao = pegar('/api/postman.json');
      for (const item of colecao.item) {
        expect(item.request.url.raw).toMatch(/^\{\{baseUrl\}\}\//);
      }
    }
  });
});

describe('o corpo vem preenchido', () => {
  test('POST com requestBody traz JSON de exemplo, nao vazio', () => {
    {
      const colecao = pegar('/api/postman.json');
      const comCorpo = colecao.item.filter((i: any) => i.request.body);
      expect(comCorpo.length).toBeGreaterThan(0);
      for (const item of comCorpo) {
        expect(() => JSON.parse(item.request.body.raw)).not.toThrow();
        expect(item.request.body.raw.length).toBeGreaterThan(2);
      }
    }
  });

  test('quem tem corpo declara Content-Type; quem nao tem, nao declara', () => {
    {
      const colecao = pegar('/api/postman.json');
      for (const item of colecao.item) {
        const ct = item.request.header.find((h: any) => h.key === 'Content-Type');
        expect(Boolean(ct)).toBe(Boolean(item.request.body));
      }
    }
  });

  test('parametro de caminho vira variavel, em vez de ficar na URL', () => {
    {
      // `/api/nota/:chave` com a chave colada na URL obriga a editar texto.
      const colecao = pegar('/api/postman.json');
      const comPath = colecao.item.filter((i: any) => i.request.url.variable?.length);
      expect(comPath.length).toBeGreaterThan(0);
    }
  });
});

describe('a colecao se identifica', () => {
  test('declara o schema v2.1 que o Postman importa', () => {
    {
      const colecao = pegar('/api/postman.json');
      expect(colecao.info.schema).toMatch(/collection\/v2\.1\.0/);
    }
  });

  test('a descricao diz como preencher a chave', () => {
    {
      const colecao = pegar('/api/postman.json');
      expect(colecao.info.description).toMatch(/apiKey/);
    }
  });

  test('vem como download, com nome de arquivo', () => {
    {
      expect(chamar('/api/postman.json').headers['content-disposition'])
        .toMatch(/postman_collection\.json/);
    }
  });
});
