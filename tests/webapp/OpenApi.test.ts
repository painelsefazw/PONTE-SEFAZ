import { app } from '../../src/webapp/app';

/**
 * O OpenAPI so vale se for VALIDO e se descrever o que existe.
 *
 * Spec que aponta rota inexistente e pior que spec nenhuma: o cliente gera o
 * SDK, chama o metodo e toma 404 achando que a credencial esta errada. Ja
 * aconteceu neste projeto — o painel imprimia `POST /api/nfe`, rota que nunca
 * existiu.
 *
 * Por isso o teste central aqui compara os caminhos declarados com as rotas
 * REGISTRADAS no Express, em vez de conferir a forma do JSON.
 */

function rotasRegistradas(): Set<string> {
  const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
  const rotas = new Set<string>();
  for (const l of stack) {
    if (!l.route) continue;
    for (const m of Object.keys(l.route.methods)) {
      rotas.add(`${m.toLowerCase()} ${l.route.path}`);
    }
  }
  return rotas;
}

/** Chama o handler do /api/openapi.json sem subir servidor. */
function spec(): any {
  const stack = ((app as any).router?.stack ?? (app as any)._router.stack) as any[];
  const camada = stack.find((l) => l.route?.path === '/api/openapi.json');
  expect(camada).toBeDefined();

  let corpo: any;
  const req: any = { headers: {}, protocol: 'https', get: () => 'exemplo.test', query: {} };
  const res: any = { json: (b: any) => { corpo = b; return res; } };
  camada.route.stack[0].handle(req, res, () => {});
  return corpo;
}

describe('OpenAPI', () => {
  const s = spec();

  test('e um documento 3.x com servidor e seguranca', () => {
    expect(s.openapi).toMatch(/^3\./);
    expect(s.servers?.[0]?.url).toBe('https://exemplo.test');
    // A URL sai da requisicao: cravar o dominio faria o cliente que le por outro
    // endereco gerar um SDK apontando para o lugar errado.
    expect(s.components.securitySchemes.ApiKey.name).toBe('x-api-key');
  });

  test('todo caminho declarado existe de verdade no Express', () => {
    const reais = rotasRegistradas();
    const inexistentes: string[] = [];
    for (const [caminho, metodos] of Object.entries<any>(s.paths)) {
      // OpenAPI usa {chave}; o Express usa :chave.
      const expresso = caminho.replace(/\{([^}]+)\}/g, ':$1');
      for (const metodo of Object.keys(metodos)) {
        if (!reais.has(`${metodo} ${expresso}`)) inexistentes.push(`${metodo.toUpperCase()} ${caminho}`);
      }
    }
    expect(inexistentes).toEqual([]);
  });

  test('cobre o ciclo que um ERP precisa', () => {
    // Nao e sobre quantidade: sao os passos sem os quais a integracao nao fecha.
    for (const p of ['/api/me', '/api/status', '/api/proximo-numero', '/api/emitir',
                     '/api/consultar', '/api/cancelar', '/api/carta-correcao',
                     '/api/nota/{chave}/xml', '/api/nota/{chave}/danfe']) {
      expect(Object.keys(s.paths)).toContain(p);
    }
  });

  test('avisa das duas armadilhas que fazem o ERP errar', () => {
    // Afirma o SIGNIFICADO, e nao a string dentro do JSON: procurar
    // `sucesso": false` no `JSON.stringify` falha porque ali as aspas vem
    // escapadas — o teste reprovava uma spec correta.

    // 1) Rejeicao da SEFAZ vem em HTTP 200. Quem checa so o status HTTP trata
    //    rejeicao como sucesso e escritura nota que nao existe.
    expect(s.info.description).toMatch(/HTTP 200/);
    expect(s.components.schemas.RespostaEmissao.properties.sucesso.description)
      .toMatch(/rejeicao/i);

    // 2) 502 indefinido: reemitir as cegas duplica a nota, e duplicidade nao
    //    tem desfazer.
    expect(s.components.schemas.RespostaEmissao.properties.indefinido).toBeDefined();
    expect(s.paths['/api/emitir'].post.responses['502'].description)
      .toMatch(/NAO reemita/);
    expect(s.paths['/api/consultar'].get.description).toMatch(/502/);
  });

  test('nao expoe rota administrativa', () => {
    // Elas exigem senha mestra e nao sao do cliente. Documenta-las convida a
    // tentativa e vaza a superficie interna.
    const admin = Object.keys(s.paths).filter((p) => p.includes('/admin'));
    expect(admin).toEqual([]);
  });

  test('todo $ref aponta para schema existente', () => {
    const texto = JSON.stringify(s);
    const refs = [...texto.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]!);
    const definidos = Object.keys(s.components.schemas);
    expect([...new Set(refs)].filter((r) => !definidos.includes(r))).toEqual([]);
  });
});
