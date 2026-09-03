import * as fs from 'fs';
import * as path from 'path';
import { comPadrao, CAMPOS_DO_PADRAO } from '../../src/webapp/padroes-plataforma';

/**
 * Suporte e paginas legais sao quase sempre OS MESMOS em todos os clientes.
 *
 * O atendimento e o seu, o site e o seu, os termos sao os seus. Sem um padrao,
 * cada cliente novo exigia redigitar seis campos — e quem esquecia um entregava
 * uma plataforma com a aba de Suporte pela metade.
 *
 * A regra que nao pode inverter: o padrao NUNCA sobrescreve o cliente. Um
 * cliente com suporte proprio existe (revenda dentro da revenda), e sobrepor o
 * dele mandaria o cliente FINAL ligar para a pessoa errada.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

const padroes = {
  suporteEmail: 'suporte@ponte.com', suporteTelefone: '3833334444',
  suporteWhatsapp: '38999998888', suporteSite: 'https://ponte.com',
  termosUrl: 'https://ponte.com/termos', privacidadeUrl: 'https://ponte.com/privacidade',
};

describe('padroes da plataforma', () => {
  test('o padrao preenche o que o cliente deixou vazio', () => {
    const r = comPadrao({ suporteEmail: '', suporteSite: '' }, padroes);
    expect(r.suporteEmail).toBe('suporte@ponte.com');
    expect(r.suporteSite).toBe('https://ponte.com');
  });

  test('o padrao NUNCA sobrescreve o que o cliente tem', () => {
    // Um cliente com suporte proprio existe. Sobrepor mandaria o cliente final
    // ligar para a pessoa errada — o pior erro possivel numa tela de suporte.
    const r = comPadrao({ suporteEmail: 'dele@cliente.com' }, padroes);
    expect(r.suporteEmail).toBe('dele@cliente.com');
  });

  test('campo com espaco conta como vazio', () => {
    // Para quem le a tela, um espaco e vazio. Sem `trim`, ele venceria o padrao
    // e entregaria um contato em branco que parece configurado.
    expect(comPadrao({ suporteEmail: '   ' }, padroes).suporteEmail).toBe('suporte@ponte.com');
  });

  test('campo fora da lista nao e tocado', () => {
    const r = comPadrao({ corPrimaria: '#000', suporteEmail: '' }, padroes);
    expect(r.corPrimaria).toBe('#000');
  });

  test('apagar um padrao REMOVE a chave, em vez de gravar vazio', () => {
    // String vazia gravada continuaria "existindo" e venceria o `||` de quem
    // le, entregando um padrao em branco com cara de configurado.
    const fonte = ler('src', 'webapp', 'padroes-plataforma.ts');
    const fn = fonte.slice(fonte.indexOf('export async function gravarPadroes('));
    expect(fn.slice(0, 900)).toContain('DELETE FROM webapp_config WHERE chave = $1');
  });

  test('a heranca acontece na GERACAO do manifest, nao na tela', () => {
    // Aplicar na tela gravaria o valor herdado no cadastro do cliente — e
    // trocar o padrao depois nao alcancaria mais ninguem.
    const app = ler('src', 'webapp', 'app.ts');
    const fn = app.slice(app.indexOf('async function montarManifestDoCliente('));
    expect(fn.slice(0, 3000)).toContain('comPadrao(');
    expect(fn.slice(0, 3000)).toContain('lerPadroes(');
  });

  test('a aba existe no painel, com os seis campos', () => {
    const painel = ler('src', 'webapp', 'public', 'index.html');
    expect(painel).toContain("{ id: 'clientesapi-padroes', label: 'Padrões' }");
    expect(painel).toContain('id="tab-clientesapi-padroes"');
    for (const id of ['padEmail', 'padWhats', 'padFone', 'padSite', 'padTermos', 'padPriv']) {
      expect(painel).toContain(`id="${id}"`);
    }
    // E salvar confere a resposta — a familia de defeito mais repetida aqui.
    const fn = painel.slice(painel.indexOf('async function salvarPadroes('));
    expect(fn.slice(0, 900)).toContain('if (!r.ok)');
  });

  test('as rotas existem e exigem admin', () => {
    const app = ler('src', 'webapp', 'app.ts');
    for (const verbo of ['get', 'post']) {
      const i = app.indexOf(`app.${verbo}('/api/admin/padroes-plataforma'`);
      expect(i).toBeGreaterThan(-1);
      expect(app.slice(i, i + 200)).toContain('requireAdmin');
    }
  });

  test('a lista de campos e a mesma dos dois lados', () => {
    expect([...CAMPOS_DO_PADRAO].sort()).toEqual(Object.keys(padroes).sort());
  });
});
