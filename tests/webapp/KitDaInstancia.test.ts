import { montarKitDaInstancia } from '../../src/webapp/kit-instancia';

/**
 * O pacote da instância precisa estar COMPLETO, e ninguém percebe quando não
 * está.
 *
 * "Baixar projeto (.zip)" promete uma instalação independente: outro banco,
 * outro certificado, outros clientes, vendendo os mesmos serviços sem depender
 * de quem entregou. Um arquivo esquecido na lista de cópia não aparece aqui —
 * aparece semanas depois, na máquina de outra pessoa, como um erro que ela não
 * tem como diagnosticar.
 *
 * Já aconteceu duas vezes, e as duas estão documentadas no próprio código:
 * `domain_models.ts` e `danfe-service/DanfePhpService.ts` moram FORA de `src/`
 * e ficavam para trás — a instância nova subia, buildava, e morria na primeira
 * requisição com "Cannot find module".
 */

describe('o pacote da instancia sai completo', () => {
  let arquivos: Map<string, Buffer>;

  beforeAll(async () => {
    arquivos = await montarKitDaInstancia({ marca: 'Teste' });
  }, 120000);

  test('leva as quatro pecas do produto', async () => {
    // Sem qualquer uma delas a instalacao nova nao e o mesmo produto:
    // o motor fiscal, o painel de quem opera, o modelo das plataformas dos
    // clientes e o console para quem quer interface propria.
    expect(arquivos.has('src/webapp/app.ts')).toBe(true);
    expect(arquivos.has('src/webapp/public/index.html')).toBe(true);
    expect(arquivos.has('platform-template/package.json')).toBe(true);
    expect(arquivos.has('admin-template/package.json')).toBe(true);
  });

  test('leva como montar o banco', () => {
    // Codigo sem banco nao guarda nota, cliente nem chave. O script existe
    // para o erro de conexao aparecer NA MAQUINA de quem instala, com a
    // mensagem inteira, em vez de virar um 500 no log de producao.
    expect(arquivos.has('database/schema_completo.sql')).toBe(true);
    expect(arquivos.has('scripts/preparar-banco.ts')).toBe(true);
  });

  test('leva os imports que moram fora de src/', () => {
    // Os dois que ja ficaram para tras. O bundler da Vercel de origem seguia
    // os imports e levava junto; o kit copia por LISTA, entao some.
    expect(arquivos.has('domain_models.ts')).toBe(true);
    expect(arquivos.has('danfe-service/DanfePhpService.ts')).toBe(true);
  });

  test('leva o que ensina a instalar', () => {
    for (const doc of ['README.md', 'INSTALACAO.md', '.env.example', 'docs/API-CLIENTES.md']) {
      expect(arquivos.has(doc)).toBe(true);
    }
  });

  test('o .env.example conta a verdade sobre o DANFE', () => {
    // Esta foi encontrada auditando o pacote: as duas variaveis do servico de
    // DANFE nao apareciam em lugar nenhum. Quem instalasse teria uma ponte que
    // emite certo e imprime um PDF simplificado, sem a logo do emitente — sem
    // nada dizendo por que, nem que ha escolha.
    const env = arquivos.get('.env.example')!.toString('utf8');
    expect(env).toContain('DANFE_SERVICE_URL');
    expect(env).toContain('DANFE_KEY');
    // E precisa dizer o que acontece SEM ela, senao a variavel vira mais uma
    // linha para copiar sem entender.
    expect(env).toMatch(/simplificado/i);
  });

  test('NENHUMA credencial viaja no pacote', () => {
    // O zip vai para o repositorio de outra pessoa. Certificado ou `.env` que
    // entrasse aqui ficaria no Git dela para sempre.
    const suspeitos = [...arquivos.keys()].filter((c) => /(^|\/)\.env$|\.pfx$|\.p12$/i.test(c));
    expect(suspeitos).toEqual([]);
    // E nem chave de API por acidente dentro de algum arquivo.
    for (const [caminho, dados] of arquivos) {
      if (caminho === '.env.example' || caminho.startsWith('tests/')) continue;
      expect(dados.toString('utf8')).not.toMatch(/nfe_(live|test)_[A-Za-z0-9_-]{20,}/);
    }
  });

  test('nao leva dependencia instalada nem build', () => {
    const caminhos = [...arquivos.keys()];
    for (const proibida of ['node_modules/', '.output/', '.wrangler/', 'dist/', '.git/']) {
      expect(caminhos.some((c) => c.includes(proibida))).toBe(false);
    }
  });
});
