import { PlatformTemplateStore, type PlatformTemplate } from '../../src/webapp/platform-templates';
import type { WhiteLabelConfig } from '../../src/webapp/white-label';

/**
 * O contrato entre o Emissor e o modelo de plataforma.
 *
 * Ate agora a garantia de que um cliente novo nascia completo vivia no TEXTO da
 * especificacao — `PadraoDoGerador.test.ts` trava os 15 grupos do padrao naquele
 * texto. Isso fazia sentido enquanto a plataforma era construida por IA a partir
 * dele.
 *
 * Agora o codigo vem pronto, do modelo, e o que viaja do Emissor para o cliente
 * e UM arquivo: o `platform.manifest.json`. Entao a garantia muda de lugar — o
 * que precisa ser travado e que esse arquivo carregue tudo que o modelo consome.
 * Campo que o gerador esquecer nao aparece como erro: aparece como plataforma do
 * cliente com o nome errado, sem logo, ou com uma aba a menos.
 *
 * A lista abaixo e literalmente o que `src/lib/manifest.ts` do modelo le.
 */

// `gerarManifest` nao toca no banco: e mapeamento puro. O pool falso existe so
// para o construtor.
const store = new PlatformTemplateStore({} as any);

const template: PlatformTemplate = {
  id: 1,
  name: 'Plataforma Fiscal',
  slug: 'fiscal-platform',
  version: '1.0',
  status: 'published',
  supportedModules: ['nfe', 'nfse'],
  manifestSchemaVersion: '1.0',
  content: '',
};

const branding: WhiteLabelConfig = {
  empresaCnpj: '12345678000195',
  nomePlataforma: 'Distribuidora Teste',
  corPrimaria: '#b91c1c',
  corSecundaria: '#7f1d1d',
  corDestaque: '#f59e0b',
  corBackground: '#ffffff',
  corSurface: '#f9fafb',
  corTexto: '#111827',
  corMuted: '#6b7280',
  logoBase64: 'data:image/svg+xml;base64,PHN2Zy8+',
  logoDarkBase64: 'data:image/svg+xml;base64,PHN2Zy8+',
  faviconBase64: 'data:image/png;base64,iVBORw0KGgo=',
  suporteEmail: 'suporte@exemplo.com.br',
  suporteWhatsapp: '5511999998888',
  mensagemLogin: 'Acesse sua plataforma',
  tituloNavegador: 'Distribuidora Teste',
  rodape: '© 2026 Distribuidora Teste.',
  tema: 'light',
};

const gerar = (mudanca: Partial<Parameters<typeof store.gerarManifest>[0]> = {}) =>
  store.gerarManifest({
    empresa: {
      cnpj: '12345678000195',
      razaoSocial: 'DISTRIBUIDORA TESTE LTDA',
      fantasia: 'Distribuidora',
      uf: 'sp',
    },
    branding,
    modules: ['nfe', 'nfse'],
    template,
    apiBaseUrl: 'https://nfe-emissor.vercel.app',
    clientId: 'CLI_12345678',
    ...mudanca,
  });

describe('o que o modelo le da empresa', () => {
  test('identificacao completa', () => {
    const m = gerar();
    expect(m.company.id).toBe('CLI_12345678');
    expect(m.company.name).toBe('DISTRIBUIDORA TESTE LTDA');
    expect(m.company.brandName).toBe('Distribuidora Teste');
    expect(m.company.cnpj).toBe('12345678000195');
  });

  test('a UF sai em maiuscula', () => {
    // Ela decide operacao interna (CFOP 5xxx) ou interestadual (6xxx), e a
    // comparacao com a UF do destinatario e literal: 'sp' e 'SP' seriam estados
    // diferentes, e a nota sairia com o CFOP do lado errado.
    expect(gerar().company.uf).toBe('SP');
  });

  test('CNPJ vai so com digitos', () => {
    // O modelo formata para exibir e compara por digitos no login. Pontuacao
    // aqui atravessaria para a chave de acesso e para o cabecalho da API.
    expect(gerar().company.cnpj).toMatch(/^\d{14}$/);
  });
});

describe('marca', () => {
  test('as cores que viram variaveis CSS', () => {
    const b = gerar().branding;
    expect(b.primary).toBe('#b91c1c');
    expect(b.secondary).toBe('#7f1d1d');
    expect(b.accent).toBe('#f59e0b');
  });

  test('logo e favicon viajam DENTRO do manifest', () => {
    // Como imagem embutida, nao como link para a nossa API: a plataforma e do
    // cliente, e um link nosso viraria dependencia externa do site dele.
    const a = gerar().assets;
    expect(a?.logo).toMatch(/^data:/);
    expect(a?.logoDark).toMatch(/^data:/);
    expect(a?.favicon).toMatch(/^data:/);
  });

  test('cliente sem logo nao ganha um bloco vazio', () => {
    // `assets: {}` faria o modelo tentar renderizar uma imagem sem src — que e
    // pior que o icone padrao, porque aparece como imagem quebrada.
    const semImagens = { ...branding };
    delete semImagens.logoBase64;
    delete semImagens.logoDarkBase64;
    delete semImagens.faviconBase64;
    expect(gerar({ branding: semImagens }).assets).toBeUndefined();
  });
});

describe('modulos e textos', () => {
  test('so o contratado vem ligado', () => {
    const m = gerar({ modules: ['nfe'] });
    expect(m.modules['nfe']).toBe(true);
    expect(m.modules['nfce']).toBe(false);
    expect(m.modules['nfse']).toBe(false);
  });

  test('os cinco modulos aparecem, mesmo desligados', () => {
    // O modelo le `modules.nfce` por nome. Ausente e `undefined`, que e falso
    // por acidente — e o dia em que a chave mudar de nome ninguem percebe.
    const m = gerar({ modules: [] });
    for (const nome of ['nfe', 'nfce', 'nfse', 'cte', 'mdfe']) {
      expect(typeof m.modules[nome]).toBe('boolean');
    }
  });

  test('textos da interface e contatos de suporte', () => {
    const m = gerar();
    expect(m.ui?.loginMessage).toBe('Acesse sua plataforma');
    expect(m.ui?.browserTitle).toBe('Distribuidora Teste');
    expect(m.ui?.footer).toBe('© 2026 Distribuidora Teste.');
    expect(m.support?.email).toBe('suporte@exemplo.com.br');
    expect(m.support?.whatsapp).toBe('5511999998888');
  });
});

describe('o manifest vai para o repositorio do cliente', () => {
  test('nenhum segredo de verdade atravessa', () => {
    // Este e o teste que permite commitar o arquivo. `api.secret` existe no
    // leiaute do manifest, e o dia em que alguem o preencher com a chave real,
    // ela vai para o Git do cliente — onde nao se apaga.
    const texto = JSON.stringify(gerar());
    expect(gerar().api.secret).toMatch(/^\{\{.*\}\}$/);
    expect(texto).not.toMatch(/nfe_live_/);
    expect(texto).not.toMatch(/nfe_test_/);
  });

  test('o endereco da API e o dominio estavel, nao o do deploy', () => {
    // URL de deploy especifico muda a cada publicacao e responde 302 atras da
    // protecao de deploy — a plataforma do cliente ficaria apontando para um
    // endereco que morre no proximo push.
    expect(gerar().api.baseUrl).toBe('https://nfe-emissor.vercel.app');
    expect(gerar().api.baseUrl).not.toMatch(/-[a-z0-9]{9,}-/);
  });
});
