import * as fs from 'fs';
import * as path from 'path';

/**
 * A plataforma do cliente tem que falar com a ponte QUE O GEROU.
 *
 * O endereco vinha de um dominio cravado no codigo, com `FISCAL_API_URL` como
 * sobrescrita opcional. O manifest — que o painel escreve por cliente e que
 * trazia o endereco CERTO — era ignorado.
 *
 * O resultado foi das piores classes de defeito que existem: a plataforma da
 * Alianca, cadastrada na ponte-sefaz, mandava a chave dela para a nfe-emissor.
 * As duas rodam o MESMO servidor, entao a resposta foi um 401 com a frase
 * "API Key invalida ou revogada" — a chave certa, ativa, batendo na porta de um
 * banco que nunca ouviu falar dela.
 *
 * Tudo o que a tela dizia estava correto, e por isso a caca durou horas: a
 * chave existia, estava ativa, o painel confirmava, e o `curl` contra a ponte
 * respondia 200. So a lista de chaves entregou — a chave nova aparecia com
 * "ultimo uso: NUNCA" mesmo depois de a plataforma tentar dezenas de vezes.
 * Ela nunca tinha chegado ali.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

const fiscal = ler('platform-template', 'src', 'lib', 'fiscal.server.ts');
const tipoDoManifest = ler('platform-template', 'src', 'lib', 'manifest.ts');
const exemplo = JSON.parse(ler('platform-template', 'src', 'platform.manifest.json'));

describe('a plataforma fala com a ponte que a gerou', () => {
  test('o endereco vem do manifest, nunca de um dominio cravado', () => {
    expect(fiscal).toContain('manifest.api?.baseUrl');
    // Nenhum endereco de ponte escrito a mao no modelo: e exatamente o que faz
    // uma instalacao conversar com a outra.
    expect(fiscal).not.toMatch(/https:\/\/[a-z0-9-]*\.vercel\.app/);
  });

  test('FISCAL_API_URL continua valendo, mas so como sobrescrita', () => {
    // A ponte pode mudar de dominio depois de o template ter sido gerado, e
    // nesse dia nao da para reemitir a plataforma de cada cliente.
    const linha = fiscal.slice(fiscal.indexOf('const BASE_URL'), fiscal.indexOf('const BASE_URL') + 160);
    expect(linha).toContain('FISCAL_API_URL');
    expect(linha.indexOf('FISCAL_API_URL')).toBeLessThan(linha.indexOf('manifest.api'));
  });

  test('sem endereco, a plataforma RECLAMA em vez de escolher um', () => {
    // O defeito nao foi a falta de endereco: foi ter um padrao silencioso e
    // errado. Falhar alto e o oposto disso.
    expect(fiscal.match(/if \(!BASE_URL\) \{/g)).toHaveLength(2);
    expect(fiscal).toContain('Endereco da ponte nao configurado');
  });

  test('o bloco `api` existe no tipo E no manifest de exemplo', () => {
    // A interface nao declarava `api`, e o que nao esta declarado nao da erro
    // quando ninguem usa — foi assim que o campo certo ficou anos sem uso.
    expect(tipoDoManifest).toMatch(/api: \{ baseUrl: string;/);
    // E o exemplo tinha `api: null`, o que faria o modelo quebrar em quem o
    // rodasse sem gerar: o tipo dizia uma coisa e o arquivo trazia outra.
    expect(exemplo.api).toBeTruthy();
    expect(String(exemplo.api.baseUrl)).toMatch(/^https:\/\//);
  });
});
