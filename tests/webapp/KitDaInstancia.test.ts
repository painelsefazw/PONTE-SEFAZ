import { montarKitDaInstancia, lerCodigoDaPonte, VARIAVEIS, ARQUIVOS_DA_INSTANCIA } from '../../src/webapp/kit-instancia';
import { montarZip, CAMINHO_MANIFEST } from '../../src/webapp/kit-plataforma';
import * as fs from 'fs';
import * as path from 'path';

/**
 * O pacote que vira outra instalacao da ponte.
 *
 * Dois riscos justificam estes testes, e os dois so aparecem depois — quando o
 * pacote ja foi publicado num repositorio do GitHub:
 *
 * **Segredo dentro.** Um `.env` ou um `.pfx` que entre no pacote vai para o
 * historico do Git, e ali nao se apaga: apagar num commit seguinte deixa o
 * valor visivel no anterior. Barrar na origem e a unica defesa que funciona.
 *
 * **Pacote incompleto.** Falta uma pasta e o clone parece pronto, instala, e so
 * quebra na hora de emitir — longe daqui, na frente de um cliente.
 */
describe('o pacote da ponte', () => {
  let arquivos: Map<string, Buffer>;

  beforeAll(async () => {
    arquivos = await montarKitDaInstancia({ marca: 'Ponte de Teste' });
  });

  it('leva o motor, o painel e as rotas', () => {
    for (const caminho of [
      'src/webapp/app.ts',
      'src/webapp/public/index.html',
      'src/domain/FiscalContext.ts',
      'src/infrastructure/crypto/Signer.ts',
      'src/infrastructure/soap/SoapClient.ts',
      'api/index.ts',
      'package.json',
      'vercel.json',
    ]) {
      expect(arquivos.has(caminho)).toBe(true);
    }
  });

  it('o vercel.json se inclui no proprio includeFiles', () => {
    /**
     * O teste acima exige `vercel.json` no pacote e passava — no disco de
     * desenvolvimento o arquivo esta la. Em producao nao estava: o pacote e
     * montado a partir do disco do LAMBDA, e o lambda so recebe o que o
     * `includeFiles` mandar. Como ele nao listava a si mesmo, o kit saia sem a
     * configuracao e a instancia nova subia sem rotas, sem regiao e sem cron.
     *
     * Por isso este teste olha para a configuracao, e nao para o resultado: e a
     * unica diferenca entre a maquina onde a suite roda e a maquina onde o
     * pacote de verdade e montado.
     */
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'vercel.json'), 'utf8'));
    const incluidos: string[] = config.builds[0].config.includeFiles;
    expect(incluidos).toContain('vercel.json');

    // O mesmo vale para todo arquivo de raiz que o kit promete levar.
    for (const arquivo of ARQUIVOS_DA_INSTANCIA) {
      expect(incluidos).toContain(arquivo);
    }
  });

  it('leva todo arquivo que o codigo importa de fora de src/ e api/', () => {
    /**
     * `src/domain/models.ts` reexporta `../../domain_models` — um import que
     * SOBE para fora de `src/`. Na Vercel de origem isso nunca deu problema: o
     * bundler dela segue os imports e leva o arquivo junto. O kit copia por
     * LISTA, entao o arquivo ficava para tras, o build passava, e a instancia
     * nova so morria na primeira requisicao:
     *
     *     Cannot find module '../../domain_models'
     *
     * Este teste procura a causa, e nao um nome: qualquer import futuro que
     * escape de `src/` ou `api/` cai aqui enquanto o arquivo nao entrar no
     * pacote. Sem isso, o proximo arquivo de raiz repete a historia.
     */
    const dentroDoPacote = (destino: string): boolean =>
      arquivos.has(destino)
      || arquivos.has(`${destino}.ts`)
      || arquivos.has(`${destino}.tsx`)
      || arquivos.has(`${destino}/index.ts`);

    const faltando: string[] = [];
    for (const [caminho, conteudo] of arquivos) {
      if (!/^(src|api)\/.*\.tsx?$/.test(caminho)) continue;
      const pasta = path.posix.dirname(caminho);

      for (const achado of conteudo.toString('utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
        const alvoDoImport = path.posix.normalize(path.posix.join(pasta, achado[1]!));
        // Import que continua dentro de src/ ou api/ ja viaja com a pasta.
        if (/^(src|api)\//.test(alvoDoImport)) continue;
        if (!dentroDoPacote(alvoDoImport)) faltando.push(`${caminho} -> ${achado[1]!}`);
      }
    }

    expect(faltando).toEqual([]);
  });

  it('leva o modelo das plataformas dos clientes', () => {
    // Sem isto a instancia nova instala, emite e nao consegue gerar cliente
    // nenhum — que e metade do produto, e a metade que se vende.
    expect(arquivos.has(`platform-template/${CAMINHO_MANIFEST}`)).toBe(true);
    expect(arquivos.has('platform-template/package.json')).toBe(true);
  });

  it('leva o console administrativo', () => {
    // Pela mesma razao do modelo das plataformas: a instancia nova herda a
    // capacidade de entregar interface propria a quem a operar.
    expect(arquivos.has('admin-template/src/lib/admin.functions.ts')).toBe(true);
    expect(arquivos.has('admin-template/package.json')).toBe(true);
  });

  it('leva o exemplo de variaveis do console tambem', () => {
    // Sem ele, quem instalasse o console a partir deste pacote teria de
    // descobrir os nomes das variaveis lendo o codigo.
    expect(arquivos.has('admin-template/.env.example')).toBe(true);
    const exemplo = arquivos.get('admin-template/.env.example')!.toString('utf8');
    for (const linha of exemplo.split(/\r?\n/)) {
      if (linha.startsWith('#') || !linha.includes('=')) continue;
      expect(linha.trim()).toMatch(/=$/);
    }
  });

  it('o exemplo diz o que acontece SEM o servico de DANFE', () => {
    // A variavel ja estava listada; o que faltava era a consequencia de
    // deixa-la em branco. Sem isso, quem instala escolhe sem saber que esta
    // escolhendo: a ponte emite certo e imprime um DANFE simplificado, sem a
    // logo do emitente, e nada na tela liga uma coisa a outra.
    const exemplo = arquivos.get('.env.example')!.toString('utf8');
    expect(exemplo).toContain('DANFE_SERVICE_URL');
    expect(exemplo).toMatch(/simplificado/i);
  });

  it('nao leva segredo nenhum', () => {
    for (const caminho of arquivos.keys()) {
      // `.env.example` e o unico permitido, e existe justamente para que o
      // `.env` de verdade nunca precise viajar.
      if (caminho.endsWith('.env.example')) continue;
      expect(caminho).not.toMatch(/(^|\/)\.env($|\.)/);
      expect(caminho).not.toMatch(/\.(pfx|p12)$/i);
    }
  });

  it('o .env.example vai com os campos VAZIOS', () => {
    // Um exemplo com valor de verdade dentro e pior que exemplo nenhum: ele
    // parece documentacao e e credencial publicada.
    const exemplo = arquivos.get('.env.example')!.toString('utf8');
    for (const linha of exemplo.split("\n")) {
      if (linha.startsWith('#') || !linha.includes('=')) continue;
      expect(linha.trim()).toMatch(/=$/);
    }
  });

  it('nao leva o que se reconstroi', () => {
    for (const caminho of arquivos.keys()) {
      expect(caminho.startsWith('node_modules/')).toBe(false);
      expect(caminho.includes('/node_modules/')).toBe(false);
      expect(caminho.startsWith('dist/')).toBe(false);
      expect(caminho.startsWith('coverage/')).toBe(false);
    }
  });

  it('nao leva o resultado da compilacao junto do codigo', () => {
    // O servidor nao empacota a partir do repositorio: empacota do disco de onde
    // ele roda, e ali convive a saida do build. Sem filtro, o clone nascia com
    // um `.js` gerado ao lado de cada `.ts` — o dobro dos arquivos, e um
    // `npm run build` depois produzindo saida diferente da que ja estava la.
    for (const caminho of arquivos.keys()) {
      if (!caminho.startsWith('src/') && !caminho.startsWith('api/')) continue;
      expect(caminho).toMatch(/\.(ts|tsx|html|sql|json)$/i);
    }
  });

  it('nao carrega os 50 MB do servico de DANFE, so o wrapper', () => {
    // Ele nao guarda estado: duas instancias apontam para o mesmo, e a
    // instalacao diz isso. Copiar seria hospedar de novo algo que ja esta de pe.
    //
    // A unica excecao e o wrapper em TypeScript, e ela nao e uma concessao: o
    // `src/webapp/app.ts` importa ele, entao sem ele a instancia nao sobe. O
    // que fica de fora e o PHP em volta — vendor, src, api, os ~50 MB.
    const permitido = 'danfe-service/DanfePhpService.ts';
    for (const caminho of arquivos.keys()) {
      if (caminho === permitido) continue;
      expect(caminho.startsWith('danfe-service/')).toBe(false);
    }
    expect(arquivos.has(permitido)).toBe(true);
  });

  it('explica como instalar, sem mandar procurar', () => {
    const leiaMe = arquivos.get('README.md')!.toString('utf8');
    const instalacao = arquivos.get('INSTALACAO.md')!.toString('utf8');
    const exemplo = arquivos.get('.env.example')!.toString('utf8');

    expect(leiaMe).toContain('Ponte de Teste');
    // O aviso que impede o erro mais caro possivel: a mesma empresa emitindo
    // por duas instalacoes, com dois contadores de numeracao.
    expect(leiaMe).toMatch(/nunca pode emitir por duas instala/i);
    expect(instalacao).toContain('preparar-banco');
    expect(instalacao).toContain('Supabase');

    // Toda variavel obrigatoria precisa estar no exemplo, senao quem instala
    // descobre a que faltou por um erro em producao.
    for (const [nome] of VARIAVEIS.obrigatorias) {
      expect(exemplo).toContain(`${nome}=`);
    }
  });

  it('traz o script que prepara o banco, apontando para o codigo real', () => {
    const script = arquivos.get('scripts/preparar-banco.ts')!.toString('utf8');
    // Importar os stores em vez de repetir o DDL: schema duplicado e schema que
    // diverge no primeiro ALTER TABLE.
    expect(script).toContain("from '../src/webapp/api-clients'");
    expect(script).toContain('NFE_DB_URL');
  });

  it('traz o contrato das rotas para um front end proprio', () => {
    const doc = arquivos.get('docs/API-CLIENTES.md')!.toString('utf8');
    expect(doc).toContain('/api/admin/clients');
    // O aviso que evita entregar o painel inteiro a quem abrir o DevTools.
    expect(doc).toMatch(/nunca pode ir para o navegador/i);
  });

  it('nasce com .gitignore', () => {
    // Sem ele o primeiro `npm install` do clone poe 40 mil arquivos no commit.
    const ignore = arquivos.get('.gitignore')!.toString('utf8');
    expect(ignore).toContain('node_modules/');
    expect(ignore).toContain('.env');
  });

  it('vira um zip que abre', () => {
    const zip = montarZip(arquivos);
    // Assinatura de arquivo local e do fim do diretorio central.
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.length).toBeGreaterThan(100_000);
  });

  it('a varredura crua e o pacote final veem o mesmo codigo', async () => {
    const cru = await lerCodigoDaPonte();
    expect(cru.has('src/webapp/app.ts')).toBe(true);
    // O pacote so acrescenta documentos; nunca remove codigo.
    for (const caminho of cru.keys()) {
      if (['README.md', '.gitignore', 'scripts/preparar-banco.ts'].includes(caminho)) continue;
      expect(arquivos.has(caminho)).toBe(true);
    }
  });
});
