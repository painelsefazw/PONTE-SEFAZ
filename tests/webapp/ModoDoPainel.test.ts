import * as fs from 'fs';
import * as path from 'path';
import { modoDoPainel } from '../../src/webapp/app';

/**
 * Uma ponte que so revende nao opera emissao: os clientes emitem pela API, cada
 * um com o seu certificado guardado no banco. Mostrar as abas de emissao,
 * empresas e cadastros ali nao e so ruido — sugere que ha algo a preencher, e
 * a instalacao nova nasce parecendo quebrada.
 */
describe('modo do painel', () => {
  test('sem emitente proprio, nasce em revenda — sem precisar de variavel', () => {
    // Toda instalacao nova cai aqui. Uma variavel a menos na tela de deploy e
    // uma a menos para errar.
    expect(modoDoPainel({ configurado: false })).toBe('revenda');
  });

  test('com emitente configurado, o painel vem inteiro', () => {
    expect(modoDoPainel({ configurado: true })).toBe('completo');
  });

  test('WEBAPP_MODO vence a deducao, nos dois sentidos', () => {
    // Quem revende E emite em nome proprio; e quem quer o painel inteiro antes
    // de cadastrar o certificado.
    expect(modoDoPainel({ explicito: 'revenda', configurado: true })).toBe('revenda');
    expect(modoDoPainel({ explicito: 'completo', configurado: false })).toBe('completo');
  });

  test('valor irreconhecivel cai na deducao, em vez de virar um terceiro modo', () => {
    expect(modoDoPainel({ explicito: 'qualquer', configurado: false })).toBe('revenda');
    expect(modoDoPainel({ explicito: '', configurado: true })).toBe('completo');
    expect(modoDoPainel({ explicito: '   ', configurado: true })).toBe('completo');
  });

  test('aceita a variavel com espaco e maiuscula, que e como se digita', () => {
    expect(modoDoPainel({ explicito: '  REVENDA ', configurado: true })).toBe('revenda');
  });
});

describe('o painel esconde as telas certas', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');
  const menu = html.slice(html.indexOf('id="mainTabBar"'), html.indexOf('id="subTabBar"'));

  test('Emissao, Consultas, Empresas, Cadastros, Operacoes e Configuracoes somem', () => {
    for (const grupo of ['emissao', 'consultas', 'empresas', 'cadastros', 'operacoes', 'config']) {
      const linha = menu.split('\n').find(l => l.includes(`showGroup('${grupo}')`));
      expect(linha).toBeDefined();
      expect(linha).toContain('escondido-na-revenda');
    }
  });

  test('Clientes API e Painel FICAM — sao o que a ponte opera', () => {
    // Se estes sumissem, sobraria uma tela vazia e nenhum jeito de gerar chave.
    for (const grupo of ['clientesapi', 'painel']) {
      const linha = menu.split('\n').find(l => l.includes(`showGroup('${grupo}')`));
      expect(linha).toBeDefined();
      expect(linha).not.toContain('escondido-na-revenda');
    }
  });

  test('o seletor de empresa e o selo de modo somem tambem', () => {
    // A ponte nao tem empresa propria: o seletor fica vazio e o selo CONTADOR
    // nao descreve nada.
    //
    // Eles moraram no `.topbar` ate a navegacao virar barra lateral. Numa
    // coluna de 248px nao cabem, e nao sao navegacao: sao o CONTEXTO do que se
    // opera. Passaram para a `.appbar`, no alto do conteudo — e e la que este
    // teste os procura agora. O que ele garante nao mudou: no modo revenda os
    // dois somem.
    const barra = html.slice(html.indexOf('<div class="appbar">'), html.indexOf('id="subTabBar"'));
    expect(barra).toBeTruthy();
    for (const marca of ['empresaSelWrap', 'modoBadge']) {
      const linha = barra.split(String.fromCharCode(10)).find(l => l.includes(marca));
      expect(linha).toBeDefined();
      expect(linha).toContain('escondido-na-revenda');
    }
  });

  test('nao ha titulo no topo para espremer', () => {
    // O `nowrap` original existia porque o titulo dividia uma faixa horizontal
    // com seletor, selo e botao, e quebrar ali empurrava tudo. A faixa saiu
    // inteira: ela gastava altura em toda tela para repetir o nome do sistema
    // em que a pessoa acabou de entrar. O nome vive na aba do navegador.
    expect(html).toMatch(/\.topbar \{ display: none/);
    expect(html).toContain('<title>Ponte SEFAZ</title>');
  });

  test('a sub-aba Templates some — ela duplica a de Clientes', () => {
    // As duas geram a plataforma do cliente. A de Clientes ainda amarra a
    // plataforma ao cliente certo; a de Templates e um caminho paralelo que
    // sobrou. Duas portas para o mesmo lugar so servem para escolher a errada.
    expect(html).toMatch(/id: 'clientesapi-templates'[^}]*soCompleto: true/);
    expect(html).toMatch(/modoDoPainel === 'revenda'[\s\S]{0,200}soCompleto/);
  });

  test('Clientes, Nova instancia e Auditoria continuam', () => {
    for (const id of ['clientesapi-lista', 'clientesapi-instancia', 'clientesapi-audit']) {
      const trecho = html.slice(html.indexOf(`id: '${id}'`), html.indexOf(`id: '${id}'`) + 90);
      expect(trecho).not.toContain('soCompleto');
    }
  });

  test('a regra de CSS que esconde existe', () => {
    expect(html).toMatch(/body\.modo-revenda \.escondido-na-revenda \{ display: none/);
  });

  test('o indicador da SEFAZ nao alarma no modo revenda', () => {
    // "Variavel de ambiente obrigatoria ausente: NFE_PFX_PATH" em vermelho
    // descreve um defeito que, numa ponte, nao existe.
    expect(html).toMatch(/modoDoPainel === 'revenda'[\s\S]{0,400}sem emitente próprio/);
  });
});
