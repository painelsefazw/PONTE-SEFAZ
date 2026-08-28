import * as fs from 'fs';
import * as path from 'path';

/**
 * A ponte inteira, empacotada para virar outra instalação.
 *
 * O que o painel já entregava era o kit do CLIENTE: a plataforma que fala com
 * esta ponte. Isto aqui é a ponte — o serviço que fala com a SEFAZ, emite,
 * guarda XML, cobra por chave de API e gera as plataformas dos clientes dele.
 *
 * A diferença prática entre os dois: o kit do cliente carrega UM arquivo
 * variável (o manifest) sobre um modelo fixo. O kit da instância carrega o
 * código inteiro e ZERO configuração — nenhuma credencial entra no pacote, e é
 * de propósito. Um repositório com banco e certificado dentro nasce vazado, e
 * no Git isso não se apaga: fica no histórico.
 *
 * ## O que NÃO vai junto, e por quê
 *
 * `danfe-service` são 50 MB de PHP com vendor inteiro, e o serviço não guarda
 * estado nenhum — só transforma XML em PDF. Duas instâncias podem apontar para
 * o mesmo, e é o que a instalação recomenda. Copiar seria carregar 50 MB para
 * hospedar de novo algo que já está de pé.
 *
 * `node_modules`, `dist`, `coverage` e as pastas de saída saem pelo mesmo
 * motivo de sempre: são derivados, e o `package-lock.json` os reconstrói.
 */

/** Pastas que formam a ponte. Tudo o que estiver fora daqui não viaja. */
export const PASTAS_DA_INSTANCIA = [
  'src',
  'api',
  'schemas',
  'schemas-nfse',
  'scripts',
  'tests',
  'database',
  // O modelo das plataformas dos clientes. Sem ele a instância nova nasce sem
  // conseguir gerar cliente nenhum — que é metade do produto.
  'platform-template',
  // E o console administrativo, pela mesma razão: a instância nova herda a
  // capacidade de entregar interface própria a quem a operar, em vez de ficar
  // presa ao painel embutido.
  'admin-template',
];

/**
 * Arquivos de raiz. O `vercel.json` viaja porque é ele que embarca o modelo.
 *
 * `domain_models.ts` esta aqui porque `src/domain/models.ts` reexporta ele —
 * um import que SOBE para fora de `src/`. Na Vercel de origem isso nunca doeu:
 * o bundler dela segue os imports e leva o arquivo junto, mesmo sem constar do
 * `includeFiles`. O kit copia por lista, entao o arquivo ficava para tras e a
 * instancia nova subia, buildava, e so morria na primeira requisicao com
 * `Cannot find module '../../domain_models'`.
 */
export const ARQUIVOS_DA_INSTANCIA = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'jest.config.js',
  'vercel.json',
  'Dockerfile',
  'domain_models.ts',
  // Mesmo caso: `src/webapp/app.ts` importa o wrapper do servico de DANFE, que
  // mora fora de `src/`. O PHP em volta dele fica de proposito no `.vercelignore`
  // — o app Node so precisa deste arquivo.
  'danfe-service/DanfePhpService.ts',
];

/** Nunca copiadas, em qualquer profundidade. */
const PASTAS_PROIBIDAS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'output', '.vercel',
  '.output', '.wrangler', '.tanstack', 'delivery', 'host_transition_pack',
]);

/**
 * Arquivos que nunca entram, nem por acidente.
 *
 * O `.env` está no `.gitignore` e não estaria numa varredura limpa — mas uma
 * cópia da pasta feita à mão pode trazê-lo, e aí ele iria para um repositório
 * do GitHub. Barrar por nome custa uma linha.
 */
const ARQUIVOS_PROIBIDOS = /^(\.env.*|.*\.pfx|.*\.p12|debug.*\.txt|velha\.txt)$/i;

/**
 * A unica excecao a regra do `.env`, e ela e por nome exato.
 *
 * `.env.example` existe justamente para que o `.env` de verdade nunca precise
 * viajar — ele lista as variaveis com os valores VAZIOS. Sem esta excecao, o
 * console dentro do pacote da instancia chegava sem o proprio exemplo, e quem
 * instalasse teria de descobrir os nomes lendo o codigo.
 *
 * Nome exato, e nao um prefixo: `.env.example.local` continua barrado.
 */
const EXEMPLO_PERMITIDO = '.env.example';

/**
 * Dentro de `src/` e `api/` este projeto e TypeScript puro — as unicas outras
 * extensoes sao um `.html` (o painel) e um `.sql`.
 *
 * Isso importa porque o servidor nao empacota a partir do repositorio: empacota
 * a partir do disco de onde ele roda, e ali convive o resultado da compilacao.
 * Sem esta regra o clone nascia com `.js` gerado ao lado de cada `.ts` — o
 * dobro dos arquivos, e um `npm run build` depois produzindo saida diferente do
 * que ja estava la.
 */
const EXTENSOES_DE_CODIGO = /\.(ts|tsx|html|sql|json)$/i;
const PASTAS_SO_DE_CODIGO = ['src/', 'api/'];

/**
 * Os lugares onde o codigo da ponte pode estar, na ordem em que se procura.
 *
 * Exportado para o diagnostico poder dizer QUAL deles venceu. O pacote e
 * montado a partir do disco, e ja aconteceu de o servidor rodar codigo novo e
 * empacotar arquivos velhos — a instancia gerada nascia com semanas de atraso
 * e nada na resposta dizia isso.
 */
export function candidatosDeRaiz(): string[] {
  return [process.cwd(), path.resolve(__dirname, '..', '..'), '/var/task'];
}

function raizDoProjeto(): string {
  const candidatos = [
    process.cwd(),
    path.resolve(__dirname, '..', '..'),
    '/var/task',
  ];
  const achou = candidatos.find((c) => fs.existsSync(path.join(c, 'src', 'webapp', 'app.ts')));
  if (!achou) {
    throw new Error(
      'Codigo da ponte nao encontrado no servidor (procurei src/webapp/app.ts em: '
      + `${candidatos.join(', ')}). Confira o includeFiles do vercel.json.`,
    );
  }
  return achou;
}

/** Lê o código da ponte do disco, por caminho relativo. */
export async function lerCodigoDaPonte(): Promise<Map<string, Buffer>> {
  const raiz = raizDoProjeto();
  const arquivos = new Map<string, Buffer>();

  /**
   * Pasta ou arquivo?
   *
   * `isDirectory()` responde FALSO para um link — junction do Windows, symlink
   * do Linux — e a varredura tentava entao ler a pasta como se fosse arquivo,
   * estourando `EISDIR` e derrubando o pacote inteiro. Um link para uma pasta de
   * dependencias no meio da arvore basta para isso acontecer, e aconteceu.
   */
  const ehPasta = (item: fs.Dirent, completo: string): boolean => {
    if (item.isDirectory()) return true;
    if (!item.isSymbolicLink()) return false;
    try {
      return fs.statSync(completo).isDirectory();
    } catch {
      // Link quebrado: nao e pasta nem arquivo legivel. Ignorar e melhor que
      // parar o pacote por causa de um atalho morto.
      return false;
    }
  };

  const varrer = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminhoDoItem = path.join(dir, item.name);
      if (ehPasta(item, caminhoDoItem)) {
        if (PASTAS_PROIBIDAS.has(item.name)) continue;
        varrer(caminhoDoItem);
        continue;
      }
      if (item.name !== EXEMPLO_PERMITIDO && ARQUIVOS_PROIBIDOS.test(item.name)) continue;
      const completo = caminhoDoItem;
      const relativo = path.relative(raiz, completo).split(path.sep).join('/');
      if (
        PASTAS_SO_DE_CODIGO.some((pasta) => relativo.startsWith(pasta))
        && !EXTENSOES_DE_CODIGO.test(relativo)
      ) continue;
      arquivos.set(relativo, fs.readFileSync(completo));
    }
  };

  for (const pasta of PASTAS_DA_INSTANCIA) {
    const completo = path.join(raiz, pasta);
    if (fs.existsSync(completo)) varrer(completo);
  }
  for (const arquivo of ARQUIVOS_DA_INSTANCIA) {
    const completo = path.join(raiz, arquivo);
    if (fs.existsSync(completo)) arquivos.set(arquivo, fs.readFileSync(completo));
  }

  if (!arquivos.has('src/webapp/app.ts')) {
    throw new Error('O pacote saiu sem src/webapp/app.ts — nao e uma ponte funcional.');
  }

  /**
   * Sem `vercel.json` a instancia sobe, e sobe errada.
   *
   * Ela nasce sem as rotas (`/` e `/api/*` apontam para `api/index.ts`), sem a
   * regiao `gru1`, sem `maxDuration` e sem os crons. O deploy nao falha: o
   * painel e que responde 404, e o motivo nao aparece em lugar nenhum.
   *
   * Aconteceu de verdade: o `includeFiles` nao listava o proprio `vercel.json`,
   * entao ele nao existia no disco do lambda, e a copia de raiz — que pula
   * arquivo ausente — o omitia sem dizer nada. O primeiro repositorio publicado
   * saiu com 415 arquivos e nenhum deles era a configuracao.
   */
  if (!arquivos.has('vercel.json')) {
    throw new Error(
      'O pacote saiu sem vercel.json — a instancia subiria sem rotas nem crons. '
      + 'A causa costuma ser o includeFiles do vercel.json nao listar ele mesmo, '
      + 'deixando o arquivo fora do disco de onde a ponte se empacota.',
    );
  }
  return arquivos;
}

// ---------------------------------------------------------------------------
// Documentos gerados
// ---------------------------------------------------------------------------

/**
 * Toda variável que a ponte lê, com o que acontece se faltar.
 *
 * Escrito à mão e não extraído do código de propósito: o que interessa a quem
 * instala não é a lista de `process.env` — é saber quais quebram o serviço,
 * quais mudam comportamento e quais dá para ignorar.
 */
export const VARIAVEIS = {
  obrigatorias: [
    ['NFE_DB_URL', 'Postgres do Supabase. Sem ela nada persiste: nem nota, nem cliente, nem chave. Se preferir nao montar a URL a mao, deixe vazia e preencha as tres NFE_DB_* abaixo.'],
    ['NFE_DB_PASSWORD', 'ALTERNATIVA a NFE_DB_URL: so a senha do banco, sozinha. O codigo codifica os simbolos.'],
    ['NFE_DB_REF', 'ALTERNATIVA a NFE_DB_URL: a referencia do projeto Supabase (o pedaco do meio da URL do painel).'],
    ['NFE_DB_HOST', 'ALTERNATIVA a NFE_DB_URL: o host do pooler, ex. aws-0-us-west-2.pooler.supabase.com.'],
    ['WEBAPP_MODO', 'OPCIONAL. `revenda` mostra so Painel e Clientes API; `completo` mostra tudo. Sem ela, deduz-se: sem emitente proprio configurado, nasce em revenda.'],
    ['WEBAPP_SENHA', 'Senha do painel administrativo desta instancia.'],
    ['WEBAPP_MASTER_KEY', 'Cifra os certificados A1 guardados no banco. Trocar depois torna ilegiveis os ja enviados.'],
  ],
  /**
   * O emitente padrao — so necessario para a PONTE emitir em nome proprio.
   *
   * Cliente de API nao usa nada disto: cada um tem certificado e cadastro
   * fiscal proprios, guardados no banco. Uma ponte que so revende sobe sem
   * nenhuma destas e cadastra clientes normalmente.
   */
  emitentePadrao: [
    ['NFE_PFX_BASE64', 'Certificado A1 do emitente padrao, em base64.'],
    ['NFE_PFX_PASSWORD', 'Senha do certificado.'],
    ['NFE_CNPJ_EMITENTE', 'CNPJ do emitente padrao.'],
    ['NFE_RAZAO_SOCIAL', 'Razao social do emitente padrao.'],
    ['NFE_IE', 'Inscricao estadual do emitente padrao.'],
    ['NFE_UF', 'UF do emitente. Decide o endpoint da SEFAZ.'],
    ['NFE_LOGRADOURO', 'Endereco do emitente.'],
    ['NFE_NUMERO', 'Numero do endereco.'],
    ['NFE_BAIRRO', 'Bairro.'],
    ['NFE_COD_MUNICIPIO', 'Codigo IBGE do municipio (7 digitos). Errar aqui rejeita a nota.'],
    ['NFE_NOME_MUNICIPIO', 'Nome do municipio.'],
    ['NFE_CEP', 'CEP.'],
  ],
  recomendadas: [
    ['API_PUBLIC_URL', 'Endereco publico DESTA instancia. Sem ele as plataformas geradas apontam para o lugar errado.'],
    // Recomendada, e nao obrigatoria, porque a ponte emite sem ela — o que
    // muda e a CARA do PDF. Sem o servico, cai num gerador simplificado
    // proprio: a nota vale igual, mas nao e o desenho homologado e a logo do
    // emitente nao sai. Quem instala precisa saber que ha essa escolha.
    ['DANFE_SERVICE_URL', 'Servico que transforma XML no DANFE em layout oficial. '
      + 'Pode ser o mesmo da instancia existente: ele nao guarda estado. Em branco, a '
      + 'ponte usa um gerador simplificado — a nota vale igual, mas o PDF nao e o desenho '
      + 'homologado e a logo do emitente nao aparece.'],
    ['DANFE_KEY', 'Chave do servico de DANFE.'],
    ['NFE_AMBIENTE', '1 producao, 2 homologacao. Padrao 2 — comece por ele.'],
    ['NFE_CRT', 'Regime tributario do emitente padrao. 1 Simples, 3 Normal.'],
    ['CRON_SECRET', 'Protege as rotas de cron (reenvio de webhook, keepalive).'],
    ['GITHUB_TOKEN', 'So para publicar plataforma de cliente direto do painel. Fine-grained, com Contents read/write nos repositorios das plataformas.'],
  ],
  opcionais: [
    ['SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM', 'Envio de DANFE e XML por e-mail.'],
    ['NFE_FANTASIA', 'Nome fantasia.'],
    ['NFE_COMPLEMENTO', 'Complemento do endereco.'],
    ['NFE_FONE', 'Telefone.'],
    ['PLATAFORMA_LOGIN_PADRAO / PLATAFORMA_SENHA_PADRAO', 'Acesso padrao das plataformas geradas.'],
  ],
} as const;

function blocoEnv(): string {
  const linha = ([nome, texto]: readonly [string, string]) => `# ${texto}\n${nome}=\n`;
  return '# Variaveis desta instancia da ponte fiscal.\n'
    + '# Copie para .env (desenvolvimento) ou cadastre no provedor (producao).\n'
    + '# NENHUMA delas vai para o repositorio.\n\n'
    + '# ── Obrigatorias ────────────────────────────────────────────────────────\n'
    + VARIAVEIS.obrigatorias.map(linha).join('\n')
    + '\n# ── Emitente padrao: so para a ponte emitir em NOME PROPRIO ─────────────\n'
    + '# Cliente de API nao usa nada disto: cada um tem certificado e cadastro\n'
    + '# fiscal proprios. Uma ponte que so revende sobe sem preencher nada aqui.\n'
    + VARIAVEIS.emitentePadrao.map(linha).join('\n')
    + '\n# ── Recomendadas ────────────────────────────────────────────────────────\n'
    + VARIAVEIS.recomendadas.map(linha).join('\n')
    + '\n# ── Opcionais ───────────────────────────────────────────────────────────\n'
    + VARIAVEIS.opcionais.map(linha).join('\n');
}

function tabela(linhas: readonly (readonly [string, string])[]): string {
  return '| Variavel | O que e |\n|---|---|\n'
    + linhas.map(([n, t]) => `| \`${n}\` | ${t} |`).join('\n');
}

function leiaMe(marca: string): string {
  return `# ${marca}

Ponte fiscal: o servico que fala com a SEFAZ e revende essa capacidade por API.

Isto e uma instalacao independente — banco proprio, certificado proprio,
clientes proprios. Nada e compartilhado com outra instancia, e essa separacao e
o ponto: **a mesma empresa nunca pode emitir por duas instalacoes ao mesmo
tempo.** A numeracao das notas vive no banco, com chave \`(cnpj, serie,
ambiente)\`; dois bancos sao dois contadores que nao se enxergam, e o resultado
e a SEFAZ recusando por duplicidade — ou pior, autorizando com buracos na
sequencia que o Fisco cobra na apuracao.

## O que ela faz

- **NF-e (modelo 55)** — emissao, cancelamento, carta de correcao, inutilizacao,
  consulta, DANFE em PDF, XML autorizado.
- **NFC-e (modelo 65)** — o cupom do balcao, com CSC e QR Code.
- **NFS-e** — emissao pelo Ambiente Nacional, cancelamento, DANFSE.
- **Documentos recebidos** — NF-e de fornecedores (Distribuicao DF-e) com
  manifestacao, e NFS-e recebidas do Ambiente Nacional.
- **Cadastros fiscais** — produtos com NCM/CST/origem, regras por NCM e UF,
  catalogo de servicos com NBS e retencoes federais.
- **Revenda por API** — clientes, chaves, escopos, limites por plano, webhooks,
  auditoria e log de requisicoes.
- **Plataformas white-label** — gera o repositorio pronto da plataforma de cada
  cliente a partir de \`platform-template/\`, com a marca dele.

## Instalacao

Leia [INSTALACAO.md](INSTALACAO.md). Sao quatro passos e nenhum exige migration
escrita a mao: o banco se cria sozinho.

## Front end

O painel administrativo ja vem pronto e funcionando, servido pela propria
aplicacao em \`/\`. Para construir outro por fora — em Lovable, por exemplo —
o contrato das rotas de clientes esta em
[docs/API-CLIENTES.md](docs/API-CLIENTES.md).

## Ao mexer

\`npm test\` antes de publicar. A suite cobre o que a SEFAZ rejeita, e cada
teste guarda o motivo pelo qual ele existe — geralmente uma nota recusada de
verdade.
`;
}

function instalacao(): string {
  return `# Instalacao

Quatro passos. Nenhum exige rodar migration a mao.

## 1. O banco

Crie um projeto no Supabase e copie a **connection string** do Postgres
(Settings > Database > Connection string). E ela que vai em \`NFE_DB_URL\`.

**Escolha a do POOLER, nao a "Direct connection".** A direta responde so em IPv6
no plano gratuito, e provedor serverless nao alcanca — o sintoma e um erro de
conexao que nao menciona IPv6 em lugar nenhum. O pooler tambem segura melhor o
padrao serverless, em que cada requisicao pode abrir conexao propria.

### Na Vercel, prefira a integracao a copiar a mao

A Vercel tem integracao com o Supabase (Integrations > Supabase > Connect). Ela
escreve \`POSTGRES_URL\` sozinha, ja apontando para o pooler e com a senha
codificada — e a ponte aceita esse nome quando \`NFE_DB_URL\` esta vazia.

Vale a pena porque essa linha e a etapa que mais quebra numa instalacao nova, e
os erros dela nao apontam para a causa:

| O que aconteceu | O que o log diz |
|---|---|
| Sobrou um espaco no meio | \`ENOTFOUND\` de um host que voce nunca escreveu |
| A senha tem \`@\`, \`#\`, \`%\`, \`+\` ou \`/\` | \`password authentication failed\` — como se a senha estivesse errada |
| Copiou de uma pagina traduzida pelo navegador | palavra em portugues no meio da URL |

Se copiar a mao mesmo assim: desligue a traducao automatica da pagina do
Supabase antes, e use uma senha so de letras e numeros — assim nao ha nada para
codificar.

Se a senha tiver caracteres especiais, codifique-os na URL (\`@\` vira \`%40\`).

O schema **nao precisa ser criado**: as 30 tabelas nascem sozinhas na primeira
chamada, com \`CREATE TABLE IF NOT EXISTS\`. Para conferir antes de publicar, e
ver o erro de conexao na sua maquina em vez de num log de producao:

\`\`\`bash
npm install
NFE_DB_URL="postgres://..." npx ts-node scripts/preparar-banco.ts
\`\`\`

Ele conecta, cria tudo e lista o que criou.

## 2. As variaveis

Copie \`.env.example\` para \`.env\` e preencha. As obrigatorias:

${tabela(VARIAVEIS.obrigatorias)}

Recomendadas:

${tabela(VARIAVEIS.recomendadas)}

Duas observacoes que economizam tempo:

- \`WEBAPP_MASTER_KEY\` cifra os certificados dos clientes guardados no banco.
  Escolha uma e **nao troque depois**: os certificados ja enviados ficam
  ilegiveis, e nao ha como recuperar sem reenviar.
- \`DANFE_SERVICE_URL\` pode apontar para o servico que ja existe. Ele so
  transforma XML em PDF e nao guarda nada, entao duas instancias compartilham
  sem interferencia.

## 3. Publicar

Qualquer provedor que rode Node. Na Vercel o \`vercel.json\` ja esta pronto:
importe o repositorio, cadastre as variaveis em **Production** e publique.

Variavel de ambiente **so vale em deploy criado depois dela**. Cadastre
primeiro, publique depois — ou publique de novo apos cadastrar.

## 4. O primeiro cliente

No painel, em **Clientes API**:

1. **+ Novo Cliente API** com CNPJ e razao social.
2. **Cadastro fiscal** — IE, regime, UF e municipio (o codigo IBGE, 7 digitos).
3. **Certificado A1** — o .pfx do cliente e a senha.
4. **+ Adicionar servico** — NF-e, NFC-e, NFS-e, conforme o contratado.
5. **Gerar chave** — e a credencial que ele usa na API.
6. **Gerar plataforma** — devolve o repositorio pronto da plataforma dele, com
   a marca aplicada. So aparecem as abas dos servicos contratados.

## Conferindo que subiu certo

- \`GET /api/health\` responde sem erro.
- O painel abre em \`/\` e aceita a \`WEBAPP_SENHA\`.
- **Emita uma nota em homologacao antes de qualquer coisa em producao.** E o
  unico teste que prova certificado, banco, numeracao e SEFAZ de uma vez.
`;
}

function contratoDaApi(): string {
  return `# Rotas de clientes — contrato para um front end proprio

O painel que acompanha a instancia ja atende. Este documento existe para quem
vai construir outro por fora (Lovable, Next, o que for) e precisa do contrato
sem ter de ler o servidor.

## Autenticacao

Rotas \`/api/admin/*\` exigem a senha administrativa **no mesmo header das chaves
de cliente**:

\`\`\`
x-api-key: <WEBAPP_SENHA>
\`\`\`

Nao ha header proprio de admin: o servidor compara o \`x-api-key\` recebido com a
\`WEBAPP_SENHA\` e, batendo, trata a requisicao como administrativa. Se nao bater,
tenta validar como chave de cliente.

**Essa senha nunca pode ir para o navegador.** Um front end que a coloque em
codigo de cliente entrega o painel inteiro a quem abrir o DevTools. O caminho
correto e o mesmo do template das plataformas: as chamadas passam por uma
funcao de servidor, e so ela conhece a senha.

## Clientes

| Metodo | Rota | O que faz |
|---|---|---|
| GET | \`/api/admin/clients\` | Lista. Aceita \`?status=\` e \`?q=\` |
| POST | \`/api/admin/clients\` | Cria. Corpo: \`{ empresaCnpj, razaoSocial, fantasia?, plano?, responsavel?, emailTecnico? }\` |
| GET | \`/api/admin/clients/:cnpj\` | Detalhe, com servicos, limites e divergencia de plano |
| PATCH | \`/api/admin/clients/:cnpj\` | Atualiza cadastro |
| POST | \`/api/admin/clients/:cnpj/status\` | Muda status: \`draft\`, \`sandbox\`, \`active\`, \`suspended\`, \`past_due\`, \`cancelled\` |
| DELETE | \`/api/admin/clients/:cnpj\` | Remove |
| GET | \`/api/admin/clients/:cnpj/resumo\` | Painel do cliente: uso, ultimas notas, eventos |

## Dados fiscais e certificado

| Metodo | Rota | O que faz |
|---|---|---|
| POST | \`/api/admin/clients/:cnpj/fiscal\` | IE, IM, CRT, UF, endereco com codigo IBGE |
| POST | \`/api/admin/clients/:cnpj/certificado\` | \`.pfx\` em base64 + senha. Guardado cifrado |

## Chaves de API

| Metodo | Rota | O que faz |
|---|---|---|
| GET | \`/api/admin/clients/:cnpj/keys\` | Lista (so o prefixo — o valor nao e recuperavel) |
| POST | \`/api/admin/clients/:cnpj/keys\` | Gera. **A chave completa aparece uma unica vez, nesta resposta** |
| DELETE | \`/api/admin/clients/:cnpj/keys/:id\` | Revoga |

O corpo aceita \`ambiente\`: \`homologacao\`, \`producao\` ou \`ambos\`. Omitir
faz a chave herdar o ambiente do cadastro da empresa — e uma chave que emite em
teste sem ninguem perceber.

## Servicos contratados

| Metodo | Rota | O que faz |
|---|---|---|
| GET | \`/api/admin/clients/:cnpj/services\` | Lista |
| POST | \`/api/admin/clients/:cnpj/services\` | Ativa: \`{ service: "nfe" | "nfce" | "nfse" }\` |
| DELETE | \`/api/admin/clients/:cnpj/services/:service\` | Desativa |

E dessa lista que saem as abas da plataforma do cliente. Ativar servico que o
plano nao cobre — ou deixar de ativar o que ele cobre — aparece como
\`divergenciaPlano\` no detalhe.

## Plataforma white-label

| Metodo | Rota | O que faz |
|---|---|---|
| POST | \`/api/admin/clients/:cnpj/generate-platform\` | Gera o manifest e as credenciais |
| GET | \`/api/admin/clients/:cnpj/kit.zip\` | O repositorio pronto, em zip |
| POST | \`/api/admin/clients/:cnpj/publicar-repositorio\` | Publica num repositorio do GitHub. Corpo: \`{ repositoryUrl }\` |
| POST | \`/api/admin/github/verificar\` | Testa se o token alcanca o repositorio. Nao escreve nada |
| GET | \`/api/admin/clients/:cnpj/white-label\` | Marca, cores, logo |
| POST | \`/api/admin/clients/:cnpj/white-label\` | Salva a marca |

## Webhooks e auditoria

| Metodo | Rota | O que faz |
|---|---|---|
| GET/POST | \`/api/admin/clients/:cnpj/webhooks\` | Endpoints de notificacao |
| GET | \`/api/admin/audit\` | Log de auditoria |
| GET | \`/api/admin/requests\` | Log de requisicoes da API |

## Do lado do cliente

O que a plataforma dele consome, com \`x-api-key\` e \`x-empresa-cnpj\`:
\`/api/emitir\`, \`/api/emitir-nfce\`, \`/api/nfse/emitir\`, \`/api/cancelar\`,
\`/api/historico\`, \`/api/consultar\`, \`/api/nota/:chave/xml\`,
\`/api/nota/:chave/danfe\`, \`/api/nfe/distribuicao\`, \`/api/nfse/distribuicao\`,
\`/api/manifestar\`, \`/api/produtos\`, \`/api/nfse/servicos\`.

A lista viva, com corpo e exemplo de cada uma, esta em \`/api/docs\` da propria
instancia depois que ela subir.
`;
}

function scriptDoBanco(): string {
  return `/**
 * Cria o schema desta instancia no banco configurado.
 *
 * Nao e uma migration: sao os mesmos \`init()\` que a aplicacao chama sozinha na
 * primeira requisicao. Rodar aqui serve para ver o erro de conexao NA SUA
 * MAQUINA, com a mensagem inteira, em vez de descobrir por um 500 no log de
 * producao — que foi como se descobriu, uma vez, que a senha do Postgres tinha
 * um "@" nao codificado.
 *
 *   NFE_DB_URL="postgres://..." npx ts-node scripts/preparar-banco.ts
 */
import { createStorage } from '../src/webapp/storage';
import { ApiClientStore } from '../src/webapp/api-clients';
import { ApiKeyStore } from '../src/webapp/apikeys';
import { AuditStore } from '../src/webapp/audit';
import { ClientServiceStore } from '../src/webapp/client-services';
import { EmpresaStore } from '../src/webapp/empresas';
import { NfseStore } from '../src/webapp/nfse';
import { NfeRecebidaStore } from '../src/webapp/nfe-recebidas';
import { PlatformTemplateStore } from '../src/webapp/platform-templates';
import { ProdutoStore } from '../src/webapp/produtos';
import { WhiteLabelStore } from '../src/webapp/white-label';
import { WebhookStore } from '../src/webapp/webhooks';

async function main() {
  const url = process.env.NFE_DB_URL;
  if (!url) {
    console.error('Faltou NFE_DB_URL. Exemplo:');
    console.error('  NFE_DB_URL="postgres://usuario:senha@host:5432/postgres" npx ts-node scripts/preparar-banco.ts');
    process.exit(1);
  }

  const etapas: [string, () => Promise<unknown>][] = [
    ['notas e numeracao', () => createStorage(url).init()],
    ['empresas emitentes', () => new EmpresaStore(url).init()],
    ['clientes de API', () => new ApiClientStore(url).init()],
    ['chaves de API', () => new ApiKeyStore(url).init()],
    ['servicos contratados', () => new ClientServiceStore(url).init()],
    ['produtos e regras fiscais', () => new ProdutoStore(url).init()],
    ['NFS-e e catalogo de servicos', () => new NfseStore(url).init()],
    ['NF-e recebidas (DF-e)', () => new NfeRecebidaStore(url).init()],
    ['white-label', () => new WhiteLabelStore(url).init()],
    ['modelos de plataforma', () => new PlatformTemplateStore(url).init()],
    ['webhooks', () => new WebhookStore(url).init()],
    ['auditoria', () => new AuditStore(url).init()],
  ];

  for (const [nome, executar] of etapas) {
    process.stdout.write(\`  \${nome}... \`);
    await executar();
    console.log('ok');
  }

  console.log('\\nBanco pronto. Publique a aplicacao e abra o painel.');
  process.exit(0);
}

main().catch((erro) => {
  console.error('\\nFalhou:', erro instanceof Error ? erro.message : erro);
  console.error('\\nSe for erro de autenticacao, confira se a senha do Postgres tem caractere');
  console.error('especial sem codificar na URL — "@" precisa virar "%40".');
  process.exit(1);
});
`;
}

/**
 * Monta o pacote completo da instância.
 *
 * `marca` só troca o título do README. O código é o mesmo — não existe versão
 * "de outra instância" do motor fiscal, e não deve existir: correção feita aqui
 * tem de servir para lá também.
 */
export async function montarKitDaInstancia(opts: { marca?: string } = {}): Promise<Map<string, Buffer>> {
  const marca = (opts.marca || '').trim() || 'Ponte Fiscal';
  const arquivos = await lerCodigoDaPonte();

  const texto = (s: string) => Buffer.from(s, 'utf8');
  arquivos.set('README.md', texto(leiaMe(marca)));
  arquivos.set('INSTALACAO.md', texto(instalacao()));
  arquivos.set('.env.example', texto(blocoEnv()));
  arquivos.set('docs/API-CLIENTES.md', texto(contratoDaApi()));
  arquivos.set('scripts/preparar-banco.ts', texto(scriptDoBanco()));
  // Sem isto, o primeiro `npm install` do clone cria node_modules e o primeiro
  // commit leva 40 mil arquivos junto.
  arquivos.set('.gitignore', texto(
    'node_modules/\ndist/\n.env\n*.pfx\n*.p12\ndebug/\noutput/\ncoverage/\n.vercel\n',
  ));

  return arquivos;
}


// ---------------------------------------------------------------------------
// Botao de deploy: subir esta ponte em QUALQUER conta da Vercel
// ---------------------------------------------------------------------------

/**
 * As variaveis que a Vercel vai pedir na tela de deploy, nesta ordem.
 *
 * Sao as PARTES do banco, e nao `NFE_DB_URL`, de proposito. Montar a
 * connection string a mao quebrou seis vezes numa instalacao real: um espaco
 * perdido virava `ENOTFOUND` de um host que ninguem escreveu, e um simbolo na
 * senha virava `password authentication failed` — que parece senha errada e
 * leva a resetar a senha, sendo que a nova tem outro simbolo.
 *
 * Em campos separados nao existe sintaxe para quebrar: a senha vai sozinha e o
 * codigo a codifica.
 */
export const VARIAVEIS_DO_BOTAO = [
  'NFE_DB_PASSWORD',
  'NFE_DB_REF',
  'NFE_DB_HOST',
  'WEBAPP_SENHA',
  'WEBAPP_MASTER_KEY',
];

/** Aceita `dono/repo`, a URL do GitHub, com ou sem `.git` no fim. */
function donoERepo(entrada: string): string {
  const limpo = String(entrada ?? '').trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  // Dono e repositorio do GitHub aceitam letra, numero, ponto, hifen e
  // sublinhado — e nada mais. Barra a mais significa caminho para dentro do
  // repositorio (uma branch, um arquivo), que nao serve para clonar.
  if (!/^[\w.-]+\/[\w.-]+$/.test(limpo)) {
    throw new Error(
      `Repositorio invalido: "${entrada}". Use dono/repositorio ou a URL do GitHub.`,
    );
  }
  return limpo;
}

/**
 * O link que sobe esta ponte numa conta da Vercel qualquer.
 *
 * A tela que ele abre faz, de uma vez, o que antes eram quatro etapas manuais:
 * cria o repositorio na conta de quem clicou, cria o projeto, PERGUNTA as
 * variaveis uma a uma — com a explicacao que vai em `envDescription` — e faz o
 * deploy. Nenhuma delas depende de quem publicou.
 *
 * ⚠️ O repositorio de origem precisa ser PUBLICO. A Vercel de quem clica le o
 * codigo com as credenciais DE QUEM CLICA, e num repositorio privado de outra
 * conta ela recebe 404 — o erro nao diz "sem permissao", diz que nao existe.
 */
export function urlDeDeployNaVercel(opts: { repositorio: string; nome?: string }): string {
  const caminho = donoERepo(opts.repositorio);
  const nome = (opts.nome ?? caminho.split('/')[1] ?? 'ponte-fiscal')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52)
    || 'ponte-fiscal';

  const parametros = new URLSearchParams({
    'repository-url': `https://github.com/${caminho}`,
    'project-name': nome,
    'repository-name': nome,
    env: VARIAVEIS_DO_BOTAO.join(','),
    envDescription:
      'NFE_DB_* sao o banco: senha do Postgres do Supabase, a referencia do projeto '
      + '(o pedaco do meio da URL do painel) e o host do POOLER. WEBAPP_SENHA e a senha '
      + 'de administrador desta instalacao. WEBAPP_MASTER_KEY cifra os certificados dos '
      + 'clientes no banco — trocar depois torna ilegiveis os ja enviados.',
    envLink: `https://github.com/${caminho}/blob/main/INSTALACAO.md`,
  });

  return `https://vercel.com/new/clone?${parametros.toString()}`;
}


// ---------------------------------------------------------------------------
// O console sai sabendo de qual ponte ele e
// ---------------------------------------------------------------------------

/**
 * Preenche `EMISSOR_API_URL` no `.env.example` do console com o endereco da
 * ponte que o gerou.
 *
 * Sem isso o console nasce generico e quem instala tem que digitar o endereco
 * a mao — e digitar endereco a mao foi, nesta semana, a etapa que mais quebrou
 * instalacao. Aqui nao ha desculpa para pedir: a ponte SABE o proprio endereco,
 * porque ele chega em cada requisicao.
 *
 * So esta variavel: `EMISSOR_ADMIN_KEY` e `APP_ACCESS_PASSWORD` sao segredos e
 * continuam vazias. Endereco nao e segredo — e publico por definicao, ja que e
 * para onde os clientes apontam.
 */
export function amarrarConsoleNaPonte(
  arquivos: Map<string, Buffer>,
  enderecoDaPonte: string,
): Map<string, Buffer> {
  const endereco = String(enderecoDaPonte ?? '').trim().replace(/\/+$/, '');
  const exemplo = arquivos.get('.env.example');
  if (!endereco || !exemplo) return arquivos;

  const quebra = /\r?\n/;
  const linhas = exemplo.toString('utf8').split(quebra);
  const preenchidas = linhas.map((linha) => (
    linha.trim() === 'EMISSOR_API_URL=' ? `EMISSOR_API_URL=${endereco}` : linha
  ));

  arquivos.set('.env.example', Buffer.from(preenchidas.join('\n'), 'utf8'));
  return arquivos;
}


/**
 * O disco de onde o pacote sai esta atrasado em relacao ao processo?
 *
 * O servidor RODA a partir de um bundle compilado e EMPACOTA a partir do disco.
 * Numa plataforma que reaproveita cache de build os dois divergem: a funcao e
 * recompilada do codigo novo, e as copias de arquivo continuam as antigas.
 *
 * O estrago e silencioso e convincente: o commit sai novo, a contagem de
 * arquivos bate, a publicacao responde sucesso — e a instancia gerada nasce com
 * o codigo de dias atras. Custou quatro publicacoes seguidas antes de alguem
 * comparar byte a byte o que tinha ido parar no repositorio.
 *
 * A prova e auto-referente: procura-se no arquivo do disco uma marca que existe
 * no codigo que esta EXECUTANDO agora. Marca escolhida a dedo envelhece — a
 * primeira versao disto procurava um nome de funcao e passou a aprovar disco
 * velho tres commits depois.
 */
export function discoEstaAtrasado(marcaDoProcesso: string): boolean {
  try {
    const raiz = raizDoProjeto();
    const conteudo = fs.readFileSync(path.join(raiz, 'src', 'webapp', 'app.ts'), 'utf8');
    return !conteudo.includes(marcaDoProcesso);
  } catch {
    // Sem conseguir ler, nao ha o que afirmar. `montarKitDaInstancia` falha
    // logo em seguida com uma mensagem melhor do que um palpite daqui.
    return false;
  }
}
