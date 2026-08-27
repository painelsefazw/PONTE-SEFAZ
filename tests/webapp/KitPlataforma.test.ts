import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { montarZip, lerUrlDoRepositorio, baixarModelo, CAMINHO_MANIFEST } from '../../src/webapp/kit-plataforma';

/**
 * O kit e o repositorio do cliente pronto: o modelo + o manifest dele.
 *
 * O `.zip` e escrito a mao (sem dependencia) porque este servico roda serverless
 * e cada pacote a mais e peso no bundle. Formato escrito a mao pede teste que
 * ABRA o arquivo, nao que confira bytes: zip que "parece certo" e recusado pelo
 * descompactador do sistema operacional na frente do cliente.
 */

describe('o .zip abre de verdade', () => {
  const arquivos = new Map<string, Buffer>([
    ['package.json', Buffer.from('{"name":"plataforma"}\n', 'utf8')],
    ['src/lib/manifest.ts', Buffer.from('export const manifest = {};\n', 'utf8')],
    [CAMINHO_MANIFEST, Buffer.from(JSON.stringify({ company: { brandName: 'Teste' } }), 'utf8')],
    // Acento e caminho fundo: os dois quebram implementacao de zip descuidada.
    ['src/routes/_painel.configuracoes.tsx', Buffer.from('// configuração\n', 'utf8')],
    // Binario: nao pode passar por conversao de texto no caminho.
    ['public/favicon.ico', Buffer.from([0, 0, 1, 0, 255, 254, 0, 10])],
  ]);

  let dir: string;
  let zipPath: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
    zipPath = path.join(dir, 'kit.zip');
    fs.writeFileSync(zipPath, montarZip(arquivos));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('o descompactador do sistema aceita o arquivo', () => {
    // Se o zip estiver malformado, isto lanca — que e exatamente o que o
    // usuario veria ao dar duplo clique.
    const saida = execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Add-Type -A System.IO.Compression.FileSystem;`
      + `$z=[IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/\\/g, '\\\\')}');`
      + `$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()`,
    ], { encoding: 'utf8' });

    const nomes = saida.split(/\r?\n/).map(s => s.trim()).filter(Boolean).sort();
    expect(nomes).toEqual([...arquivos.keys()].sort());
  });

  test('o conteudo sai identico ao que entrou', () => {
    const destino = path.join(dir, 'aberto');
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath.replace(/\\/g, '\\\\')}' -DestinationPath '${destino.replace(/\\/g, '\\\\')}' -Force`,
    ]);

    for (const [caminho, esperado] of arquivos) {
      const lido = fs.readFileSync(path.join(destino, caminho));
      expect(lido.equals(esperado)).toBe(true);
    }
  });
});

describe('o modelo embutido', () => {
  test('esta no lugar e tem o manifest', async () => {
    // Se a pasta sumir ou for renomeada, o kit para de sair — e o erro
    // apareceria so na hora de gerar a plataforma de um cliente.
    const arquivos = await baixarModelo();
    expect(arquivos.has(CAMINHO_MANIFEST)).toBe(true);
    expect(arquivos.size).toBeGreaterThan(50);
  });

  test('traz a plataforma inteira, nao so a configuracao', async () => {
    const arquivos = await baixarModelo();
    for (const esperado of [
      'package.json',
      'src/routes/__root.tsx',
      'src/routes/_painel.dashboard.tsx',
      'src/lib/manifest.ts',
      'src/lib/fiscal.server.ts',
      '.env.example',
    ]) {
      expect(arquivos.has(esperado)).toBe(true);
    }
  });

  test('nao leva o projeto do construtor nem dependencia instalada', async () => {
    // `.lovable/project.json` identifica o projeto do CLIENTE no construtor:
    // sobrescrever trocaria a identidade dele. `node_modules` o cliente instala.
    const caminhos = [...(await baixarModelo()).keys()];
    expect(caminhos.some((c) => c.startsWith('.lovable/'))).toBe(false);
    expect(caminhos.some((c) => c.startsWith('node_modules/'))).toBe(false);
    expect(caminhos.some((c) => c === '.env')).toBe(false);
  });

  test('nenhuma credencial viaja dentro do modelo', async () => {
    // O kit vai para o repositorio do cliente. Chave que entrasse aqui ficaria
    // no Git dele para sempre.
    const arquivos = await baixarModelo();
    for (const [caminho, dados] of arquivos) {
      if (caminho === '.env.example') continue; // documenta o formato, sem valor
      expect(dados.toString('utf8')).not.toMatch(/nfe_(live|test)_[A-Za-z0-9_-]{20,}/);
    }
  });

  test('traz os tres documentos, nao so a NF-e', async () => {
    // O modelo e um so e serve as combinacoes pelo manifest. Se as telas de um
    // documento saissem do modelo, o cliente que o contratasse receberia um
    // sistema sem aba nenhuma para ele — e o Emissor nao teria como avisar,
    // porque para ele o servico esta contratado.
    const caminhos = [...(await baixarModelo()).keys()];
    for (const documento of ['nfe', 'nfce', 'nfse']) {
      expect(caminhos.some((c) => c.includes(`_painel.${documento}.emitir.tsx`))).toBe(true);
      expect(caminhos.some((c) => c.includes(`_painel.${documento}.index.tsx`))).toBe(true);
    }
  });

  test('o manifest embutido e neutro, nao de um cliente', async () => {
    // Kit gerado sem trocar o manifest tem de sair com a marca de exemplo — e
    // nunca com o nome de outra empresa.
    const m = JSON.parse((await baixarModelo()).get(CAMINHO_MANIFEST)!.toString('utf8'));
    expect(m.company.cnpj).toMatch(/^0+$/);
    expect(m.company.brandName).toMatch(/sua empresa/i);
  });
});

describe('URL do repositorio', () => {
  test('aceita as formas que se copia do GitHub', () => {
    for (const url of [
      'https://github.com/dono/repo',
      'https://github.com/dono/repo.git',
      'https://github.com/dono/repo/',
      'git@github.com:dono/repo.git',
    ]) {
      expect(lerUrlDoRepositorio(url)).toEqual({ dono: 'dono', repo: 'repo' });
    }
  });

  test('recusa dizendo o que se esperava', () => {
    // Colar o link do projeto no construtor em vez do repositorio e o engano
    // natural — a mensagem tem de mostrar o formato certo, nao so "invalido".
    expect(() => lerUrlDoRepositorio('https://lovable.dev/projects/abc-123'))
      .toThrow(/github\.com\/dono\/repositorio/);
    expect(() => lerUrlDoRepositorio('')).toThrow(/nao reconhecida/);
  });
});
