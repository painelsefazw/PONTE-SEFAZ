import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

/**
 * Monta o repositorio pronto de um cliente: o modelo + o manifest dele.
 *
 * O codigo da plataforma e o MESMO para todo cliente e vive num repositorio so
 * (o modelo). O que muda de um para outro e um arquivo:
 * `src/platform.manifest.json`. Entao "gerar a plataforma do cliente" e baixar
 * o modelo e trocar esse arquivo — nao construir um sistema.
 *
 * **O modelo mora aqui, em `platform-template/`.** Nao e buscado em repositorio
 * nenhum, e a razao e concreta: a primeira versao puxava de um repositorio do
 * GitHub que, na pratica, era o projeto de um cliente — com secrets cadastrados
 * no construtor e vida propria. Depender dele significava que mexer naquele
 * projeto mudava o que todo cliente novo recebia, e que ler o modelo exigia
 * credencial de escrita na conta inteira.
 *
 * O medo de "duas copias que divergem" so existe quando ha DOIS modelos. Aqui ha
 * um: este. Ele e versionado junto com o gerador que o preenche, entao uma
 * mudanca no formato do manifest e a tela que a consome entram no mesmo commit —
 * que e justamente o que separava as duas coisas antes.
 */

/** Onde o modelo esta, relativo a raiz do projeto. */
const PASTA_MODELO = process.env['PLATFORM_TEMPLATE_DIR'] || 'platform-template';

/** Caminho do unico arquivo que difere entre clientes. */
export const CAMINHO_MANIFEST = 'src/platform.manifest.json';

/**
 * Arquivos que NAO se leva do modelo para o repositorio do cliente.
 *
 * `.lovable/project.json` identifica o projeto do cliente no construtor;
 * sobrescrever com o do modelo trocaria a identidade dele e o editor passaria a
 * apontar para outro lugar. Foi o cuidado que se tomou na mao nas duas
 * primeiras plataformas, e aqui vira regra.
 */
const NAO_COPIAR = new Set(['.lovable/project.json']);

/**
 * O `.env` de verdade nunca viaja no pacote.
 *
 * Ele nao deveria existir na pasta do modelo — mas existe assim que alguem roda
 * o projeto para conferir alguma coisa, e foi exatamente isso que aconteceu. O
 * `.gitignore` protege o repositorio; nao protege ESTA leitura, que e do disco
 * e nao do Git. Sem esta regra, uma conferida local vira a chave de API dentro
 * do repositorio de todo cliente gerado depois — e chave em Git de cliente nao
 * se apaga, so se revoga.
 *
 * `.env.example` continua indo: ele e a documentacao do formato, com os valores
 * em branco de proposito.
 */
function ehEnvDeVerdade(relativo: string): boolean {
  const nome = relativo.split('/').pop() ?? '';
  return (nome === '.env' || nome.startsWith('.env.')) && nome !== '.env.example';
}

/**
 * Le o modelo do disco e devolve os arquivos por caminho.
 *
 * Serverless nao tem o repositorio inteiro em disco: a Vercel embarca so o que o
 * `includeFiles` do `vercel.json` mandar. Por isso a busca tenta mais de uma
 * raiz — o cwd da funcao nao e o mesmo da maquina de quem desenvolve, e essa
 * diferenca so aparece depois de publicar.
 */
function raizDoModelo(pasta = PASTA_MODELO, marcador = CAMINHO_MANIFEST): string {
  const candidatos = [
    path.resolve(process.cwd(), pasta),
    path.resolve(__dirname, '..', '..', pasta),
    path.resolve('/var/task', pasta),
  ];
  const achou = candidatos.find((c) => fs.existsSync(path.join(c, marcador)));
  if (!achou) {
    throw new Error(
      `Modelo nao encontrado (procurei ${marcador} em: ${candidatos.join(', ')}). `
      + 'Confira se a pasta do modelo esta no `includeFiles` do vercel.json.',
    );
  }
  return achou;
}

/** Todos os arquivos do modelo, por caminho relativo. */
export async function baixarModelo(): Promise<Map<string, Buffer>> {
  return lerModeloDaPasta(PASTA_MODELO, CAMINHO_MANIFEST);
}

/**
 * Le um modelo qualquer do disco — o da plataforma do cliente ou o do console.
 *
 * As duas pastas seguem as MESMAS regras: nada de `node_modules`, nada de saida
 * de build, e o `.lovable/project.json` do destino preservado. Duplicar a
 * varredura para o console teria duplicado tambem cada uma dessas decisoes, e
 * elas so foram descobertas doendo.
 */
export async function lerModeloDaPasta(
  pasta: string,
  marcador: string,
): Promise<Map<string, Buffer>> {
  const raiz = raizDoModelo(pasta, marcador);
  const arquivos = new Map<string, Buffer>();

  const varrer = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, item.name);
      const relativo = path.relative(raiz, completo).split(path.sep).join('/');
      if (NAO_COPIAR.has(relativo) || ehEnvDeVerdade(relativo)) continue;
      // node_modules e build nunca entram: o cliente instala do package.json.
      if (item.isDirectory()) {
        if (['node_modules', '.git', '.output', '.wrangler', '.tanstack'].includes(item.name)) continue;
        varrer(completo);
      } else {
        arquivos.set(relativo, fs.readFileSync(completo));
      }
    }
  };
  varrer(raiz);

  if (!arquivos.has(marcador)) {
    // Sem isto, um modelo reorganizado geraria kits silenciosamente sem manifest
    // — e o cliente receberia a plataforma com a marca de exemplo.
    throw new Error(
      `O modelo em ${raiz} nao tem ${marcador}. `
      + 'O kit nao pode ser montado sem saber onde a marca do cliente entra.',
    );
  }
  return arquivos;
}

// ---------------------------------------------------------------------------
// zip — escrita
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]!) & 0xFF]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Monta um .zip sem compressao (metodo "store").
 *
 * Sem compressao de proposito: o conteudo pesado do kit e a logo do cliente, que
 * ja e uma imagem comprimida dentro do manifest — deflate ali gasta CPU do
 * serverless para ganhar quase nada. O resto e texto e o download e local.
 */
export function montarZip(arquivos: Map<string, Buffer>): Buffer {
  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [caminho, dados] of [...arquivos.entries()].sort()) {
    const nome = Buffer.from(caminho, 'utf8');
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      // versao necessaria
    local.writeUInt16LE(0x0800, 6);  // nomes em UTF-8
    local.writeUInt16LE(0, 8);       // metodo: store
    local.writeUInt32LE(0, 10);      // hora/data: zeradas
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, dados);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(dados.length, 20);
    dir.writeUInt32LE(dados.length, 24);
    dir.writeUInt16LE(nome.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nome);

    offset += 30 + nome.length + dados.length;
  }

  const corpo = Buffer.concat(locais);
  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.size, 8);
  fim.writeUInt16LE(arquivos.size, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(corpo.length, 16);

  return Buffer.concat([corpo, diretorio, fim]);
}

// ---------------------------------------------------------------------------
// GitHub — publicacao
// ---------------------------------------------------------------------------

/**
 * De onde sai o token desta operacao: do corpo do pedido, ou do servidor.
 *
 * Existe porque token fine-grained NAO atravessa conta. O `GITHUB_TOKEN`
 * guardado no servidor serve a uma conta so — publicar num repositorio de outra
 * pessoa seria impossivel por desenho, e nenhuma permissao resolveria.
 *
 * O token do corpo e **de uso unico**: vale para aquela requisicao e some. Nao
 * e guardado, nao vai para log, nao entra na auditoria. Quem publica num
 * repositorio de outra conta cola o token daquela conta na hora, e pronto.
 *
 * O do corpo VENCE o do servidor quando os dois existem: se alguem se deu ao
 * trabalho de colar um, e porque o do servidor nao serve para aquele destino.
 */
export function escolherToken(
  doCorpo: unknown,
  doAmbiente: string | undefined,
): { token: string; origem: 'corpo' | 'servidor' } | null {
  const colado = typeof doCorpo === 'string' ? doCorpo.trim() : '';
  if (colado) return { token: colado, origem: 'corpo' };

  const guardado = (doAmbiente ?? '').trim();
  if (guardado) return { token: guardado, origem: 'servidor' };

  return null;
}

/**
 * A resposta de quem tentou publicar sem token nenhum.
 *
 * Uma so, para os tres lugares que publicam — a plataforma do cliente, a ponte
 * e o console. Tres textos diferentes para a mesma falta so criam tres versoes
 * da mesma duvida.
 */
export const SEM_TOKEN = {
  erro: 'Nenhum token do GitHub disponivel para publicar.',
  comoResolver: 'Cole um token no campo "Token do GitHub" — ele vale so para esta publicacao '
    + 'e nao fica guardado. Para o caminho fixo, cadastre GITHUB_TOKEN no servidor e publique '
    + 'um deploy novo. Lembre que token fine-grained so alcanca repositorios da propria conta: '
    + 'para repositorio de OUTRA conta, o token tem de ser dela.',
} as const;

/** `https://github.com/dono/repo.git` -> `{ dono, repo }`. */
export function lerUrlDoRepositorio(url: string): { dono: string; repo: string } {
  const m = String(url || '').trim()
    .match(/github\.com[/:]([^/]+)\/([^/.\s]+)(?:\.git)?\/?$/i);
  if (!m) {
    throw new Error(
      `URL de repositorio nao reconhecida: "${url}". `
      + 'Use o endereco do GitHub, como https://github.com/dono/repositorio',
    );
  }
  return { dono: m[1]!, repo: m[2]! };
}

/** Texto puro cabe direto na arvore; binario precisa virar blob antes. */
function ehTexto(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
}

/**
 * Acrescenta um commit com o modelo + o manifest no repositorio do cliente.
 *
 * **Acrescenta**, nunca reescreve. O repositorio e criado e conectado pelo
 * construtor, que avisa em todo projeto: reescrever historico publicado apaga o
 * historico do projeto do lado dele. Por isso o commit entra por cima do que
 * existe (`base_tree` + `parents`), e nao ha force em lugar nenhum.
 */
export async function publicarNoGitHub(opts: {
  arquivos: Map<string, Buffer>;
  urlRepositorio: string;
  token: string;
  mensagem: string;
}): Promise<{ commit: string; branch: string; arquivos: number; primeiroCommit?: boolean }> {
  const { dono, repo } = lerUrlDoRepositorio(opts.urlRepositorio);
  const api = axios.create({
    baseURL: `https://api.github.com/repos/${dono}/${repo}`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    timeout: 45000,
  });

  // O construtor cria em `main`; repositorio antigo pode estar em `master`.
  //
  // E existe o terceiro caso, que a propria tela manda acontecer: **repositorio
  // recem-criado, sem commit nenhum.** Ali nao ha branch para consultar — o
  // GitHub responde "Git Repository is empty" — e nao ha commit pai para
  // referenciar. Este era o unico caminho que faltava, e era justamente o que a
  // instrucao "crie o repositorio vazio, cole aqui e publique" produzia.
  let branch = 'main';
  let refAtual: string | null = null;
  for (const candidato of ['main', 'master']) {
    try {
      refAtual = (await api.get(`/git/ref/heads/${candidato}`)).data.object.sha;
      branch = candidato;
      break;
    } catch { /* nao existe; tenta o proximo, e no fim assume repositorio vazio */ }
  }

  const repositorioVazio = refAtual === null;
  if (repositorioVazio) {
    // Repositorio vazio: o nome do branch vem do que o dono configurou como
    // padrao. Assumir `main` funcionaria hoje e quebraria em conta que ainda usa
    // `master` como padrao — e o erro apareceria so no fim, depois de subir
    // todos os arquivos.
    try {
      const info = await api.get('');
      branch = info.data?.default_branch || 'main';
    } catch { /* sem info, `main` e o padrao do GitHub desde 2020 */ }

    /**
     * Repositorio sem nenhum commit nao tem banco de dados Git ainda.
     *
     * Nao e so a falta de branch: `/git/blobs`, `/git/trees` e `/git/commits`
     * TAMBEM respondem `409 Git Repository is empty` ali. A primeira correcao
     * tratou so a consulta do branch e o erro voltou identico, agora vindo da
     * criacao da arvore — o que fez parecer que nada tinha mudado.
     *
     * A API de CONTEUDO funciona em repositorio vazio, e criar um arquivo por
     * ela inicializa o repositorio: nasce o commit, nasce o branch, e a partir
     * dai o resto da API passa a existir. Semeia-se o README porque o pacote
     * traz um proprio e o sobrescreve no commit seguinte — nada de arquivo
     * tecnico sobrando na raiz do cliente.
     */
    /**
     * Sem `branch` de proposito.
     *
     * Informar o branch faz o GitHub tentar RESOLVE-LO antes de criar o
     * arquivo — e num repositorio sem nenhum commit ele nao existe ainda,
     * entao a resposta e o mesmo 409 "Git Repository is empty" que se estava
     * tentando contornar. O erro chega identico ao da consulta de ref, o que
     * faz parecer que a semeadura nem rodou.
     *
     * Omitido, o GitHub cria o arquivo no branch padrao do repositorio, que e
     * exatamente onde ele tem que nascer.
     */
    const semente = await api.put('/contents/README.md', {
      message: 'Inicializa o repositorio',
      content: Buffer.from('# Ponte fiscal\n\nInicializando...\n', 'utf8').toString('base64'),
    });
    refAtual = semente.data?.commit?.sha ?? null;
    // O branch real e o que o GitHub acabou de usar, e nao o que se supos.
    branch = semente.data?.content?.url?.match(/[?&]ref=([^&]+)/)?.[1] ?? branch;
    if (!refAtual) {
      throw new Error(
        'O GitHub aceitou o primeiro arquivo mas nao devolveu o commit. '
        + 'Tente publicar de novo: o repositorio ja nao esta mais vazio.',
      );
    }
  }

  const commitAtual = (await api.get(`/git/commits/${refAtual}`)).data;

  // Binarios viram blob antes: a arvore so aceita conteudo como texto.
  const entradas: Array<Record<string, string>> = [];
  for (const [caminho, dados] of opts.arquivos) {
    if (ehTexto(dados)) {
      entradas.push({ path: caminho, mode: '100644', type: 'blob', content: dados.toString('utf8') });
    } else {
      const blob = await api.post('/git/blobs', {
        content: dados.toString('base64'),
        encoding: 'base64',
      });
      entradas.push({ path: caminho, mode: '100644', type: 'blob', sha: blob.data.sha });
    }
  }

  // `base_tree` preserva o que ja existe e nao veio no modelo — e o que mantem
  // o `.lovable/project.json` do cliente intacto. Em repositorio vazio nao ha o
  // que preservar, e mandar `base_tree` com sha inexistente seria erro.
  const arvore = await api.post('/git/trees', {
    base_tree: commitAtual.tree.sha,
    tree: entradas,
  });
  const commit = await api.post('/git/commits', {
    message: opts.mensagem,
    tree: arvore.data.sha,
    parents: [refAtual],
  });
  await api.patch(`/git/refs/heads/${branch}`, { sha: commit.data.sha, force: false });

  return {
    commit: commit.data.sha,
    branch,
    arquivos: entradas.length,
    ...(repositorioVazio ? { primeiroCommit: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// GitHub — verificacao de acesso
// ---------------------------------------------------------------------------

/**
 * O que o token consegue fazer neste repositorio, agora.
 *
 * Sao estados diferentes que produzem a MESMA sensacao para quem opera ("nao
 * publicou") e exigem consertos em lugares diferentes: um na Vercel, outro no
 * GitHub, outro na URL digitada. Descobrir qual deles e tentando publicar custa
 * caro — foi assim que se gastou uma tarde inteira aqui: a variavel estava
 * cadastrada com valor em branco, e depois o token existia mas nascera com
 * acesso a "Public repositories" e permissao nenhuma.
 */
export type EstadoDoAcesso =
  | 'sem-variavel'
  | 'vazia'
  | 'credencial-recusada'
  | 'fora-do-escopo'
  | 'somente-leitura'
  | 'escrita-nao-testavel'
  | 'outra-conta'
  | 'indisponivel'
  | 'ok';

export interface VerificacaoDeAcesso {
  estado: EstadoDoAcesso;
  /** Publicar agora daria certo? E a unica pergunta que a tela precisa fazer. */
  podePublicar: boolean;
  mensagem: string;
  comoResolver?: string;
  branchPadrao?: string;
}

/** O que o GitHub respondeu, traduzido — sem rede, para poder ser testado. */
export function classificarAcesso(
  resposta:
    | { tipo: 'sem-variavel' }
    | { tipo: 'vazia' }
    | { tipo: 'erro'; status?: number; mensagem?: string }
    | {
      tipo: 'repositorio';
      podeEscrever: boolean;
      /** Falso em repositorio vazio: nao ha banco Git onde sondar a escrita. */
      escritaTestavel?: boolean;
      privado?: boolean;
      branchPadrao?: string;
      /** Dono do repositorio e dono do token, quando deu para saber. */
      donoDoRepositorio?: string;
      donoDoToken?: string;
    },
): VerificacaoDeAcesso {
  switch (resposta.tipo) {
    case 'sem-variavel':
      return {
        estado: 'sem-variavel',
        podePublicar: false,
        mensagem: 'A variavel GITHUB_TOKEN nao existe no servidor.',
        comoResolver: 'Cadastre GITHUB_TOKEN na Vercel (ambiente Production) e publique um deploy NOVO — '
          + 'variavel nao entra em deploy que ja existia.',
      };
    case 'vazia':
      return {
        estado: 'vazia',
        podePublicar: false,
        mensagem: 'A variavel GITHUB_TOKEN existe, mas esta vazia.',
        comoResolver: 'Abra a variavel na Vercel, cole o token no campo de valor e salve. '
          + 'Confira que o texto aparece na caixa antes de salvar: a Vercel aceita salvar em branco.',
      };
    case 'repositorio': {
      const dono = (resposta.donoDoRepositorio ?? '').toLowerCase();
      const donoDoToken = (resposta.donoDoToken ?? '').toLowerCase();
      const deOutraConta = Boolean(dono && donoDoToken && dono !== donoDoToken);

      if (!resposta.podeEscrever && deOutraConta) {
        // Este caso passava por "somente leitura", e a frase mandava para o
        // lugar errado: marcar Contents no token nao resolve, porque token
        // fine-grained NAO atravessa conta. E o token so enxerga o repositorio
        // por ele ser publico — todo token le repositorio publico, sempre.
        return {
          estado: 'outra-conta',
          podePublicar: false,
          mensagem: `Este repositorio e da conta "${resposta.donoDoRepositorio}", `
            + `e o token e da conta "${resposta.donoDoToken}".`,
          comoResolver: 'Token fine-grained so alcanca repositorios da propria conta — nenhuma '
            + 'permissao resolve isso. Ou crie o repositorio na conta do token, ou baixe o .zip '
            + 'e publique pela sua maquina, logado na outra conta.',
          ...(resposta.branchPadrao ? { branchPadrao: resposta.branchPadrao } : {}),
        };
      }

      if (!resposta.podeEscrever && resposta.escritaTestavel === false) {
        // Repositorio vazio nao tem banco Git, entao nao da para provar escrita
        // sem escrever de verdade — e um botao chamado "Testar" nao pode
        // escrever. Dizer "somente leitura" aqui seria inventar um diagnostico.
        return {
          estado: 'escrita-nao-testavel',
          podePublicar: false,
          mensagem: 'O token enxerga o repositorio, mas ele esta VAZIO: nao da para testar '
            + 'escrita sem escrever.',
          comoResolver: 'Publique — o primeiro commit e que vai dizer. Se o token nao tiver '
            + 'Contents: Read and write, a publicacao responde "Resource not accessible by '
            + 'personal access token" e nada e criado.',
          ...(resposta.branchPadrao ? { branchPadrao: resposta.branchPadrao } : {}),
        };
      }

      if (!resposta.podeEscrever) {
        return {
          estado: 'somente-leitura',
          podePublicar: false,
          mensagem: 'O token enxerga o repositorio, mas so para leitura.',
          comoResolver: 'No GitHub, no token: Permissions > Repository > Contents = Read and write. '
            + 'A secao de permissoes de repositorio so aparece depois de escolher '
            + '"Only select repositories" ou "All repositories". Se o repositorio for publico, '
            + 'a leitura vem de graca e nao prova nada sobre a escrita.',
          ...(resposta.branchPadrao ? { branchPadrao: resposta.branchPadrao } : {}),
        };
      }
      return {
        estado: 'ok',
        podePublicar: true,
        mensagem: 'Token cadastrado, com acesso de escrita a este repositorio.',
        ...(resposta.branchPadrao ? { branchPadrao: resposta.branchPadrao } : {}),
      };
    }
    case 'erro':
    default: {
      const status = 'status' in resposta ? resposta.status : undefined;
      if (status === 401) {
        return {
          estado: 'credencial-recusada',
          podePublicar: false,
          mensagem: 'O GitHub recusou a credencial: token invalido, revogado ou vencido.',
          comoResolver: 'Gere um token novo no GitHub e substitua o valor de GITHUB_TOKEN na Vercel.',
        };
      }
      if (status === 404 || status === 403) {
        // 404 aqui quase nunca e "nao existe": o GitHub responde 404 em vez de
        // 403 para repositorio privado fora do escopo, justamente para nao
        // revelar que ele existe.
        return {
          estado: 'fora-do-escopo',
          podePublicar: false,
          mensagem: 'O token nao enxerga este repositorio.',
          comoResolver: 'No GitHub, no token: Repository access > Only select repositories > inclua este '
            + 'repositorio. Se o endereco estiver errado a resposta e a mesma — confira o dono e o nome.',
        };
      }
      return {
        estado: 'indisponivel',
        podePublicar: false,
        mensagem: `Nao foi possivel falar com o GitHub${status ? ` (HTTP ${status})` : ''}.`,
        ...('mensagem' in resposta && resposta.mensagem ? { comoResolver: resposta.mensagem } : {}),
      };
    }
  }
}

/**
 * Pergunta ao GitHub o que o token alcanca — sem criar commit nenhum.
 *
 * `GET /repos/{dono}/{repo}` e uma leitura pura: se falhar, nada aconteceu no
 * repositorio do cliente. E o que permite oferecer um botao de teste que a
 * pessoa aperta a vontade.
 */
export async function verificarAcessoAoRepositorio(opts: {
  token: string | undefined;
  urlRepositorio: string;
}): Promise<VerificacaoDeAcesso> {
  if (opts.token === undefined) return classificarAcesso({ tipo: 'sem-variavel' });
  if (!opts.token.trim()) return classificarAcesso({ tipo: 'vazia' });

  const { dono, repo } = lerUrlDoRepositorio(opts.urlRepositorio);
  try {
    const cabecalhos = {
      Authorization: `Bearer ${opts.token.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const r = await axios.get(`https://api.github.com/repos/${dono}/${repo}`, {
      headers: cabecalhos, timeout: 20000,
    });
    /**
     * A escrita e SONDADA, e nao lida de `permissions.push`.
     *
     * Aquele campo diz o que a CONTA autenticada pode fazer no repositorio —
     * nao o que o TOKEN pode. Para o dono do repositorio ele vem `true`
     * mesmo com um token somente-leitura, e o teste respondia "tem acesso de
     * escrita" para um token que a publicacao recusava em seguida com
     * `Resource not accessible by personal access token`. Aconteceu de
     * verdade: o teste passou, o publicar falhou, e a mensagem mandava
     * procurar no repositorio errado.
     *
     * A sonda cria um BLOB solto. Ele exige exatamente a permissao que a
     * publicacao exige (Contents: write) e nao aparece em lugar nenhum: sem
     * arvore nem commit apontando para ele, fica inalcancavel e o proprio
     * GitHub o recolhe depois. E o teste mais barato que nao mente.
     */
    let podeEscrever = false;
    let escritaTestavel = true;
    try {
      await axios.post(`https://api.github.com/repos/${dono}/${repo}/git/blobs`,
        { content: 'sonda de permissao', encoding: 'utf-8' },
        { headers: cabecalhos, timeout: 20000 });
      podeEscrever = true;
    } catch (erroDaSonda: any) {
      // 409 = repositorio vazio: o banco de dados Git ainda nao existe, entao
      // nao ha onde criar blob. Nao e falta de permissao, e nao pode ser
      // relatado como se fosse.
      if (erroDaSonda?.response?.status === 409) escritaTestavel = false;
    }

    // De quem e o token — perguntado SO quando falta escrita, que e quando a
    // resposta muda o conselho. Repositorio de outra conta nao se resolve com
    // permissao nenhuma; da mesma conta, sim.
    let donoDoToken: string | undefined;
    if (!podeEscrever) {
      try {
        const eu = await axios.get('https://api.github.com/user', {
          headers: cabecalhos, timeout: 15000,
        });
        donoDoToken = eu.data?.login;
      } catch { /* sem identidade, cai no conselho generico */ }
    }

    return classificarAcesso({
      tipo: 'repositorio',
      podeEscrever,
      escritaTestavel,
      privado: !!r.data?.private,
      branchPadrao: r.data?.default_branch,
      donoDoRepositorio: r.data?.owner?.login ?? dono,
      ...(donoDoToken ? { donoDoToken } : {}),
    });
  } catch (err: any) {
    return classificarAcesso({
      tipo: 'erro',
      status: err?.response?.status,
      mensagem: err?.response?.data?.message || err?.message,
    });
  }
}
