import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * A auditoria nao pode mostrar o nome tecnico da acao.
 *
 * Quem abre esta tela e quem atende — normalmente ja com o cliente na linha
 * dizendo que parou de emitir. Ver "client.updated" ou
 * "platform.repositorio_publicado" nao responde nada: exige saber o que o
 * codigo chama de que, que e exatamente o conhecimento que quem atende nao tem.
 *
 * O defeito nasceu de um dicionario ESCRITO A MAO com treze acoes, enquanto o
 * servidor registrava vinte e oito. As quinze de fora nao davam erro nenhum —
 * caiam na tela com o slug cru, e so quem olhasse a tela perceberia. Cada nova
 * acao registrada repetiria o problema calada.
 *
 * Por isso este teste varre as acoes pelo LADO DO SERVIDOR: toda string que
 * chega em `registrarAudit` tem que ter traducao no painel. Adicionar uma acao
 * nova sem traduzi-la quebra o teste, e nao a tela do cliente.
 */

const raiz = path.resolve(__dirname, '..', '..');
const painel = fs
  .readFileSync(path.join(raiz, 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');
const servidor = fs
  .readFileSync(path.join(raiz, 'src', 'webapp', 'app.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/** Toda acao que o servidor grava de fato. */
function acoesRegistradas(): string[] {
  const nomes = new Set<string>();
  const re = /registrarAudit\(\s*[^,]+,\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(servidor))) nomes.add(m[1]!);
  return [...nomes].sort();
}

/** O dicionario do painel, como o navegador o le. */
function dicionarioDoPainel(): Record<string, { g: string; t: string; e: string }> {
  const i = painel.indexOf('var ACOES_DA_AUDITORIA = {');
  expect(i).toBeGreaterThan(0);
  const fim = painel.indexOf('\n};', i);
  const corpo = painel.slice(i, fim + 3);

  const mapa: Record<string, { g: string; t: string; e: string }> = {};
  const re = /'([a-z0-9_.]+)':\s*\{\s*g:\s*'(\w+)',\s*t:\s*'([^']+)',\s*e:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo))) mapa[m[1]!] = { g: m[2]!, t: m[3]!, e: m[4]! };
  return mapa;
}

describe('Auditoria em portugues', () => {
  it('traduz TODA acao que o servidor registra', () => {
    const dicionario = dicionarioDoPainel();
    const semTraducao = acoesRegistradas().filter(a => !dicionario[a]);

    expect(semTraducao).toEqual([]);
  });

  it('nenhum titulo carrega o nome tecnico da acao', () => {
    const dicionario = dicionarioDoPainel();
    for (const [acao, texto] of Object.entries(dicionario)) {
      // Ponto ou underscore no titulo e o sintoma de slug vazando para a tela.
      expect(texto.t).not.toMatch(/[._]/);
      expect(texto.t.length).toBeGreaterThan(3);
      // A frase de apoio e o que torna a linha entendivel para quem nao e
      // tecnico; sem ela sobra so um rotulo curto, que era o problema antigo.
      expect(texto.e.length).toBeGreaterThan(15);
      expect(acao).toMatch(/[._]/);
    }
  });

  it('acao desconhecida vira frase, e nunca o slug cru', () => {
    const i = painel.indexOf('function descreverAcao(');
    expect(i).toBeGreaterThan(0);
    const corpo = painel.slice(i, painel.indexOf('\nfunction ', i + 10));

    // O caminho de saida troca ponto e underscore por espaco e marca a linha
    // como 'outro' — que e o cinza da legenda.
    expect(corpo).toMatch(/replace\(\/\[\._\]\/g, ' '\)/);
    expect(corpo).toContain("g: 'outro'");
  });

  it('cada grupo tem cor propria, nos dois temas', () => {
    const grupos = new Set(Object.values(dicionarioDoPainel()).map(v => v.g));
    grupos.add('outro');

    for (const g of grupos) {
      const regra = new RegExp(`\\.aud-g-${g}\\s*\\{[^}]*--aud-cor:\\s*var\\((--[\\w-]+)\\)`);
      const m = regra.exec(painel);
      expect(m).toBeTruthy();

      // A cor vem de token, e nao de hex escrito na regra: token existe nos
      // dois temas, hex fica ilegivel no escuro.
      const token = m![1]!;
      expect(painel).toMatch(new RegExp(`:root\\[data-tema="escuro"\\][\\s\\S]*?\\${''}${token}:`));
    }
  });

  it('o vermelho e so para o que tira acesso de alguem', () => {
    const dicionario = dicionarioDoPainel();
    const risco = Object.keys(dicionario).filter(a => dicionario[a]!.g === 'risco');

    // Nao e "acao importante": e acao que derruba quem esta emitindo agora.
    expect(risco.sort()).toEqual([
      'apikey.revoked',
      'client.deleted',
      'service.deactivated',
    ]);
  });

  it('a legenda deixa filtrar por assunto', () => {
    expect(painel).toContain('id="auditLegenda"');
    expect(painel).toContain('function filtrarAuditoria(');
    // Clicar de novo no mesmo assunto devolve a lista inteira.
    expect(painel).toMatch(/auditGrupoAtivo = auditGrupoAtivo === g \? '' : g;/);
  });

  it('a logo do DANFE fica no cliente, e nao em "Sistema"', () => {
    // O CNPJ ia no argumento do TIPO de entidade, e a empresa ficava vazia: os
    // dois eventos apareciam soltos, fora do cliente a que pertencem.
    const re = /registrarAudit\('admin', 'danfe\.marca\.(salva|removida)', '(\w+)', \{\s*empresaCnpj: emp\.cnpj/g;
    const achados = servidor.match(re) || [];
    expect(achados).toHaveLength(2);
  });
});

/**
 * O desenho, rodado de verdade.
 *
 * Conferir o codigo por texto pega dicionario faltando, mas nao pega um `+`
 * fora do lugar que derruba a tela inteira — e a auditoria e a UNICA aba sem
 * outro caminho: se ela nao desenha, a resposta e uma area em branco, sem erro
 * visivel. Aqui as funcoes do painel rodam num contexto de mentira, com um
 * `document` de faz de conta, e o HTML que sai e conferido.
 */
describe('Auditoria desenhada', () => {
  function desenhar(registros: unknown[]) {
    const ini = painel.indexOf('var ACOES_DA_AUDITORIA = {');
    const fim = painel.indexOf('</script>', ini);
    const guardado: Record<string, { innerHTML: string }> = {};
    const ctx: any = {
      Date, Math, String, Number, isNaN,
      document: {
        getElementById(id: string) {
          return (guardado[id] = guardado[id] || { innerHTML: '' });
        },
      },
      escapeHtml: (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    };
    vm.createContext(ctx);
    vm.runInContext(painel.slice(ini, fim), ctx);
    ctx.renderAuditLog(registros);
    return { ctx, lista: () => guardado['auditLogLista']!.innerHTML, legenda: () => guardado['auditLegenda']!.innerHTML };
  }

  const agora = Date.now();
  const minAtras = (n: number) => new Date(agora - n * 60000).toISOString();

  it('a suspensao diz de onde para onde, e sai vermelha', () => {
    const t = desenhar([{
      action: 'client.status_changed', actor: 'admin', empresaCnpj: '66509026000178',
      razaoSocial: 'D CARVALHO', before: { status: 'sandbox' }, after: { status: 'suspended' },
      createdAt: minAtras(3),
    }]);

    const html = t.lista();
    expect(html).toContain('aud-g-risco');
    expect(html).toContain('Cliente agora esta suspenso');
    expect(html).toContain('Passou de &quot;Em teste&quot; para &quot;Suspenso&quot;');
    expect(html).toContain('Nessa situacao ele NAO emite');
    expect(html).toContain('ha 3 min');
  });

  it('o servico liberado diz QUAL documento', () => {
    const html = desenhar([{
      action: 'service.activated', actor: 'admin', empresaCnpj: '66509026000178',
      after: { service: 'nfse' }, createdAt: minAtras(10),
    }]).lista();

    expect(html).toContain('Servico liberado: NFS-e');
    expect(html).not.toContain('service.activated');
  });

  it('acao nunca vista sai legivel e cinza', () => {
    const html = desenhar([{
      action: 'coisa.nova_que_ninguem_traduziu', actor: 'admin', createdAt: minAtras(10),
    }]).lista();

    expect(html).toContain('aud-g-outro');
    expect(html).toContain('Coisa nova que ninguem traduziu');
    expect(html).not.toContain('coisa.nova_que_ninguem_traduziu');
  });

  it('clicar na cor deixa so aquele assunto, e clicar de novo devolve tudo', () => {
    const t = desenhar([
      { action: 'apikey.revoked', actor: 'admin', empresaCnpj: '1', createdAt: minAtras(5) },
      { action: 'client.updated', actor: 'admin', empresaCnpj: '1', createdAt: minAtras(6) },
      { action: 'platform.generated', actor: 'admin', empresaCnpj: '1', createdAt: minAtras(7) },
    ]);

    expect((t.lista().match(/aud-linha/g) || [])).toHaveLength(3);

    t.ctx.filtrarAuditoria('risco');
    expect((t.lista().match(/aud-linha/g) || [])).toHaveLength(1);
    expect([...new Set(t.lista().match(/aud-g-\w+/g))]).toEqual(['aud-g-risco']);
    expect(t.legenda()).toContain('aud-chip aud-g-risco on');

    t.ctx.filtrarAuditoria('risco');
    expect((t.lista().match(/aud-linha/g) || [])).toHaveLength(3);
  });

  it('a legenda conta quantos ha de cada assunto', () => {
    const t = desenhar([
      { action: 'client.updated', actor: 'admin', empresaCnpj: '1', createdAt: minAtras(1) },
      { action: 'client.created', actor: 'admin', empresaCnpj: '1', createdAt: minAtras(2) },
      { action: 'apikey.revoked', actor: 'admin', empresaCnpj: '1', createdAt: minAtras(3) },
    ]);

    expect(t.legenda()).toContain('Cadastro<span class="aud-qtd">2</span>');
    expect(t.legenda()).toContain('Corta acesso<span class="aud-qtd">1</span>');
    // Assunto sem nenhum registro nao vira chip: legenda cheia de zeros e ruido.
    expect(t.legenda()).not.toContain('Plataforma');
  });

  it('lista vazia explica, em vez de so dizer que esta vazia', () => {
    const t = desenhar([]);
    expect(t.lista()).toContain('Assim que alguem mexer num cliente, aparece aqui');
    expect(t.legenda()).toBe('');
  });
});
