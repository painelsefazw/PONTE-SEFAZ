import { gerarPersonalizacaoMd } from '../../src/webapp/personalizacao-md';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A marca cadastrada precisa CHEGAR no construtor.
 *
 * Ela já ia para o manifest, e o manifest já ia para o repositório. Só que o
 * construtor (Lovable) não lê o manifest — ele responde ao que se escreve no
 * chat dele. Então a personalização parava no arquivo: o site do cliente nascia
 * com as cores do modelo, e a conclusão natural de quem cadastrou a marca era
 * que o cadastro não servia para nada.
 *
 * Este documento fecha o vão. O que ele NÃO pode fazer é resumir: valor que
 * falta é valor que o construtor inventa, e aí o cliente recebe uma cor que
 * ninguém escolheu.
 */

const marcaCheia = {
  empresaCnpj: '66509026000178',
  nomePlataforma: 'Aliança Fiscal',
  nomeExibicao: 'Aliança',
  corPrimaria: '#0f766e',
  corSecundaria: '#134e4a',
  corDestaque: '#f59e0b',
  corBackground: '#f8fafc',
  corSurface: '#ffffff',
  corTexto: '#0f172a',
  corMuted: '#64748b',
  corBorda: '#e2e8f0',
  borderRadius: '12px',
  logoBase64: 'data:image/png;base64,' + 'A'.repeat(40000),
  faviconBase64: 'data:image/png;base64,AAAA',
  suporteEmail: 'suporte@alianca.com.br',
  suporteWhatsapp: '38999998888',
  termosUrl: 'https://alianca.com.br/termos',
  tema: 'light' as const,
};

const dados = {
  cnpj: '66509026000178',
  razaoSocial: 'ALIANCA ALIMENTOS DE JAIBA LTDA',
  fantasia: 'Aliança Alimentos',
  uf: 'MG',
  modulos: ['nfe'],
  apiBaseUrl: 'https://ponte-sefaz.vercel.app',
  marca: marcaCheia,
  geradoEm: new Date('2026-09-02T14:30:00Z'),
};

describe('personalizacao para o construtor', () => {
  const md = gerarPersonalizacaoMd(dados);

  test('cada cor cadastrada aparece com o valor exato', () => {
    for (const cor of ['#0f766e', '#134e4a', '#f59e0b', '#f8fafc', '#ffffff', '#0f172a', '#64748b', '#e2e8f0']) {
      expect(md).toContain(cor);
    }
    // E a instrucao que impede o construtor de "melhorar" a paleta — que e
    // exatamente o que ele faz quando recebe cores sem ordem em contrario.
    expect(md).toMatch(/não aproxime|Não aproxime/);
  });

  test('imagem entra como ponteiro, nunca colada no chat', () => {
    // Uma logo passa fácil de 100 KB em data URI. Colada num chat ela chega
    // cortada, e um data URI cortado renderiza como imagem quebrada — sem erro
    // nenhum, que é o pior jeito de falhar.
    expect(md).not.toContain('A'.repeat(200));
    expect(md).toContain('src/platform.manifest.json');
    expect(md).toContain('assets.logo');
    // E diz o tamanho, para o leitor entender por que não está ali.
    expect(md).toMatch(/~\d+ KB/);
  });

  test('campo vazio e dito como vazio, e nao omitido', () => {
    // Omitir faz o construtor preencher a lacuna sozinho. A frase "não
    // preenchido" e uma ordem, nao uma decoracao.
    expect(md).toContain('— (não preenchido)');
    expect(md).toMatch(/não invente|Não invente/);
  });

  test('so os documentos contratados entram', () => {
    const so = gerarPersonalizacaoMd({ ...dados, modulos: ['nfe'] });
    expect(so).toContain('- NFE');
    expect(so).not.toContain('- NFSE');
    // Sem servico nenhum, a ordem e nao montar tela de emissao — em vez de
    // deixar o construtor decidir.
    expect(gerarPersonalizacaoMd({ ...dados, modulos: [] }))
      .toContain('Não monte tela de emissão');
  });

  test('o endereco da ponte vem do manifest, e o documento repete isso', () => {
    // Foi um endereco cravado no codigo que mandou a plataforma de um cliente
    // falar com outra instalacao. Um documento que mandasse escrever endereco
    // no codigo reproduziria o mesmo defeito, agora pelo chat.
    expect(md).toContain('https://ponte-sefaz.vercel.app');
    expect(md).toContain('api.baseUrl');
    expect(md).toMatch(/Não escreva endereço de API no código/);
  });

  test('as credenciais sao nomeadas, e nunca o valor delas', () => {
    expect(md).toContain('FISCAL_API_KEY');
    expect(md).toContain('APP_ACCESS_PASSWORD');
    expect(md).toContain('VITE_');
    // O documento vai para um chat de terceiro: valor de credencial nao entra.
    expect(md).not.toMatch(/nfe_(test|live)_/);
  });

  test('a rota existe, exige admin e entrega como arquivo', () => {
    const app = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8');
    const rota = app.slice(app.indexOf("whitelabel/personalizacao.md'"));
    expect(rota.slice(0, 900)).toContain('requireAdmin');
    expect(rota.slice(0, 1800)).toContain('attachment; filename=');
    expect(rota.slice(0, 1800)).toContain('text/markdown; charset=utf-8');
  });
});
