import * as fs from 'fs';
import * as path from 'path';
import { PLANOS, planoDe } from '../../src/webapp/planos';

/**
 * O plano de um cliente ja cadastrado tem que poder mudar.
 *
 * Ele so era escolhido no assistente de cadastro. Depois disso nao havia
 * caminho nenhum na tela: um cliente que crescia ficava com o teto de quando
 * entrou, e "resolver" era excluir e cadastrar de novo — levando junto a chave
 * de API, o certificado e o historico de notas.
 *
 * E a tela precisa dizer a VERDADE sobre qual plano vale. Quando os planos
 * viraram BETA/PRO/MAX, o painel ficou com a traducao antiga: `free` aparecia
 * como PRO na lista enquanto o servidor cobrava o teto do BETA. Ninguem ve esse
 * tipo de erro olhando — os dois lugares estao em arquivos diferentes.
 */

const raiz = path.resolve(__dirname, '..', '..');
const painel = fs
  .readFileSync(path.join(raiz, 'src', 'webapp', 'public', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');
const servidor = fs
  .readFileSync(path.join(raiz, 'src', 'webapp', 'app.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/**
 * O corpo de uma funcao do painel.
 *
 * Corta na primeira chave de fechamento na coluna zero, e nao na proxima
 * palavra `function`: entre uma funcao e a seguinte ha blocos de comentario, e
 * cortar la adiante trazia o corpo do vizinho junto — uma asercao de AUSENCIA
 * entao falhava por causa de codigo que nem pertence a funcao examinada.
 */
function corpo(nome: string): string {
  for (const chave of [`async function ${nome}(`, `function ${nome}(`]) {
    const i = painel.indexOf(chave);
    if (i < 0) continue;
    const fim = painel.indexOf('\n}\n', i);
    return painel.slice(i, fim < 0 ? i + 3000 : fim + 3);
  }
  return '';
}

/** So o codigo: comentario que EXPLICA uma remocao costuma citar o removido. */
function semComentarios(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Um mapa `{ chave: valor }` escrito no painel, lido como objeto. */
function mapaDoPainel(nome: string): Record<string, string> {
  const i = painel.indexOf('var ' + nome + ' = {');
  expect(i).toBeGreaterThan(0);
  const bloco = painel.slice(i, painel.indexOf('\n};', i));
  const mapa: Record<string, string> = {};
  const re = /(\w+):\s*(?:'([\w-]+)'|\{\s*nome:\s*'([\w-]+)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloco))) mapa[m[1]!] = (m[2] || m[3])!;
  return mapa;
}

describe('O plano que a tela mostra e o que o servidor cobra', () => {
  it('todo identificador conhecido cai no MESMO plano nos dois lados', () => {
    const selo = mapaDoPainel('PLANO_SELO');
    const antigo = mapaDoPainel('PLANO_ANTIGO');

    const divergencias: string[] = [];
    for (const id of [...Object.keys(selo), ...Object.keys(antigo)]) {
      const naTela = selo[id] || selo[antigo[id]!];
      const noServidor = planoDe(id).nome;
      if (naTela !== noServidor) divergencias.push(`${id}: tela=${naTela} servidor=${noServidor}`);
    }

    expect(divergencias).toEqual([]);
  });

  it('plano desconhecido cai no mais restrito, e nao no melhor', () => {
    // O fallback antigo era PRO: um identificador com erro de digitacao
    // aparecia como plano melhor do que o que valia de fato.
    const fn = corpo('seloPlano');
    expect(fn).toContain('PLANO_SELO.beta');
    expect(planoDe('coisa-que-nao-existe').id).toBe(PLANOS[0]!.id);
  });

  it('a lista de reserva do assistente tem os planos que existem hoje', () => {
    const i = painel.indexOf('var WZ_PLANOS = [');
    const bloco = painel.slice(i, painel.indexOf('\n];', i));
    const ids = [...bloco.matchAll(/id:\s*'([\w-]+)'/g)].map(m => m[1]!);

    // Ela ja ficou para tras uma vez, oferecendo PREMIUM depois que o catalogo
    // mudou — e o cliente nascia com um plano que o servidor nao conhece.
    expect(ids).toEqual(PLANOS.map(p => p.id));
  });

  it('o painel nao le campos que sairam do catalogo', () => {
    // `documentos`, `escolheUm` e `limiteNotas` sumiram quando o plano virou so
    // volume. Ler o que nao existe nao da erro: dava "sem teto" nos tres
    // planos, e a tela dizia que o BETA nao tem limite.
    for (const fn of ['carregarPlanos', 'painelSuporteHtml']) {
      expect(corpo(fn)).not.toMatch(/plano\.limiteNotas|p\.limiteNotas/);
    }
    expect(corpo('carregarPlanos')).toContain('limitePorServico');
    expect(corpo('painelSuporteHtml')).toContain('limitePorServico');
  });
});

describe('Mudar o plano depois do cadastro', () => {
  it('existe o caminho, e ele parte da ficha do cliente', () => {
    expect(corpo('mudarPlanoDoCliente')).not.toBe('');
    // Dois caminhos de proposito: o selo do plano e clicavel, e ha um botao na
    // grade de acoes para quem procura por lista.
    const detalhe = corpo('renderDetalheCliente') + corpo('painelSuporteHtml');
    expect(detalhe).toContain("mudarPlanoDoCliente(");
    expect(detalhe).toContain("acaoDoCliente('mudarPlanoDoCliente'");
  });

  it('grava, e nao aceita a falha calada', () => {
    const fn = corpo('confirmarMudancaDePlano');
    expect(fn).toMatch(/method:\s*'PATCH'/);
    expect(fn).toContain("'/api/admin/clients/'");
    expect(fn).toMatch(/JSON\.stringify\(\{\s*plano:/);
    // `fetch` nao rejeita em 400: sem `r.ok`, a tela recarregaria mostrando o
    // plano antigo como se a troca tivesse pegado.
    expect(fn).toMatch(/if \(!r\.ok\)/);
  });

  it('avisa antes quando o novo teto ja foi estourado no mes', () => {
    const fn = corpo('mudarPlanoDoCliente');
    expect(fn).toContain('porServico');
    expect(fn).toContain('passa do teto');
  });
});

describe('O servidor confere o plano antes de gravar', () => {
  function rota(): string {
    const i = servidor.indexOf("app.patch('/api/admin/clients/:cnpj', ");
    expect(i).toBeGreaterThan(0);
    return servidor.slice(i, servidor.indexOf('\napp.', i + 10));
  }

  it('recusa identificador que nao existe no catalogo', () => {
    const r = rota();
    expect(r).toContain('CATALOGO_PLANOS.some');
    expect(r).toContain('res.status(400)');
  });

  it('normaliza antes de gravar', () => {
    // 'PRO' com maiuscula gravado cru faz `planoDe` nao encontrar o plano e
    // rebaixar o cliente ao mais restrito, calado.
    expect(rota()).toMatch(/String\(planoPedido\)\.trim\(\)\.toLowerCase\(\)/);
  });

  it('a troca de plano vira um registro proprio na auditoria', () => {
    const r = rota();
    expect(r).toContain("'client.plano_changed'");
    expect(r).toMatch(/before: \{ plano: planoAntes \}/);
    // O painel tem que saber traduzir o que o servidor grava.
    expect(painel).toContain("'client.plano_changed'");
  });
});

describe('Os contadores gigantes sairam', () => {
  it('nao ha mais bloco de resumo no topo das listas', () => {
    for (const id of ['clientesApiResumo-api', 'clientesApiResumo-plataforma']) {
      expect(painel).not.toContain(id);
    }
    expect(painel).not.toContain('renderClientesDashboard');
    expect(painel).not.toContain('function cardMini');
  });

  it('a lista deixou de pedir o dashboard a cada tecla digitada', () => {
    // A busca chama `loadClientesApi` a cada `input`. Enquanto os contadores
    // existiam, cada letra disparava DUAS chamadas.
    //
    // Sem os comentarios: o proprio comentario que explica a remocao cita a
    // rota removida, e uma asercao de ausencia tropeca nele.
    expect(semComentarios(corpo('loadClientesApi'))).not.toContain('/api/admin/dashboard');
  });
});
