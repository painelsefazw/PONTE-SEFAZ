import dados from "../platform.manifest.json";

/**
 * Tudo que muda de um cliente para outro mora em `src/platform.manifest.json`.
 *
 * Este arquivo NAO tem valor de cliente nenhum, e e assim de proposito: o
 * modelo e um so, e cada instalacao troca UM arquivo. Antes cada plataforma era
 * gerada inteira do zero, entao duas instalacoes do mesmo sistema tinham codigo
 * diferente — e correcao feita numa nunca chegava nas outras.
 *
 * Quem gera o manifest e o painel do Emissor (Clientes API > Gerar plataforma).
 * Nao edite valores aqui a mao: eles voltam no proximo `git pull` do modelo.
 *
 * **Segredo nao entra aqui.** Este arquivo vai para o repositorio e para o
 * bundle do navegador. Chave de API, senha e segredo de sessao ficam so nas
 * variaveis de ambiente do servidor — veja `.env.example`.
 */
export interface PlatformManifest {
  schemaVersion: string;
  project: { type: string; template: string; templateVersion: string };
  company: {
    id: string;
    name: string;
    brandName: string;
    cnpj: string;
    /** UF do emitente: define operacao interna (CFOP 5xxx) ou interestadual (6xxx). */
    uf: string;
  };
  /** Cores da marca. Ausente = o tema padrao do modelo, que ja e neutro. */
  branding?: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
    background?: string | null;
    surface?: string | null;
    text?: string | null;
    muted?: string | null;
    border?: string | null;
    radius?: string | null;
    theme?: string | null;
    logoUrl?: string | null;
    logoDarkUrl?: string | null;
    faviconUrl?: string | null;
  };
  /**
   * Modulos e features sao listados por NOME, nao como `Record<string, boolean>`.
   *
   * Com indice generico o TypeScript exige `manifest.modules["nfe"]` e, pior,
   * aceita `manifest.modules.nfse` escrito errado como `nfe`, `nsfe` ou
   * qualquer coisa — sem erro, sempre `undefined`, e a aba some da tela do
   * cliente sem ninguem entender por que.
   */
  /**
   * Logo e favicon do cliente, embutidos como data URI.
   *
   * Vao dentro do manifest, e nao como link para a nossa API, porque a
   * plataforma e do cliente: um link nosso viraria dependencia externa do site
   * dele e quebraria no dia em que o dominio mudasse.
   */
  assets?: { logo?: string | null; logoDark?: string | null; favicon?: string | null };
  modules: { nfe: boolean; nfce: boolean; nfse: boolean; cte?: boolean; mdfe?: boolean };
  features: { dashboard: boolean; users: boolean; reports: boolean; support: boolean };
  /**
   * Os blocos existem sempre (o gerador os escreve); os campos dentro e que
   * podem faltar — e faltam como `null`, nao como ausentes.
   *
   * A diferenca nao e teoria: o gerador monta o manifest a partir de colunas do
   * banco, e coluna vazia vira `null` no JSON. Tipar so como opcional fazia o
   * `tsc` reprovar o manifest de um cliente REAL — o primeiro que gerei tinha
   * `phone`, `site` e as duas URLs legais nulas. O modelo compilava com o
   * exemplo e quebrava com o cliente.
   */
  support: { email?: string | null; whatsapp?: string | null; phone?: string | null; site?: string | null };
  legal?: { termsUrl?: string | null; privacyUrl?: string | null };
  ui: { browserTitle?: string | null; loginMessage?: string | null; footer?: string | null };
}

export const manifest = dados as PlatformManifest;

/** Nome curto da marca. E o que aparece na tela; `company.name` e a razao social. */
export const marca = manifest.ui?.browserTitle || manifest.company.brandName;

/**
 * Prefixo dos dados guardados no navegador e do cookie de sessao.
 *
 * Era um nome fixo, o que so funcionava enquanto existia UMA instalacao. Em
 * dominios diferentes nao colide, mas na pre-visualizacao do construtor — onde
 * varias plataformas vivem sob o mesmo dominio — colide: um cliente abre com o
 * tema e os destinatarios do outro.
 */
export const escopo = manifest.company.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Titulo de aba, sempre com a marca no fim.
 *
 * Existe para as 10 telas nao repetirem a mesma concatenacao — era assim que o
 * nome do cliente anterior sobrava numa aba quando alguem copiava o projeto.
 */
export function tituloDaPagina(secao?: string): string {
  return secao ? `${secao} | ${marca}` : `${marca} | Console de clientes`;
}

export function formatCnpj(cnpj: string) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * O cliente contratou este documento?
 *
 * O menu era uma lista fixa: NF-e e NFS-e apareciam para todo mundo. Cliente que
 * so contratou produto via uma aba de servico que nao emite nada — e a primeira
 * noticia disso era ele clicando e recebendo erro, ou pior, ligando para
 * perguntar por que "o sistema dele tem uma tela que nao funciona".
 *
 * Quem decide e o manifest, nao o codigo. E o que permite UM modelo servir as
 * tres combinacoes — so produto, so servico, ou os dois — sem manter tres
 * copias do mesmo sistema, que divergem no primeiro conserto.
 */
export function moduloAtivo(nome: "nfe" | "nfce" | "nfse"): boolean {
  return manifest.modules?.[nome] === true;
}

/** Quantos documentos este cliente emite. Zero e cadastro incompleto, nao um caso de uso. */
export const modulosContratados = (["nfe", "nfce", "nfse"] as const).filter(moduloAtivo);

/**
 * Mensagem do topo do login.
 *
 * O campo e opcional no cadastro e chega vazio na maioria dos clientes — o
 * primeiro cliente real gerado veio assim. Sem padrao, o titulo da tela de login
 * renderizava um `<h1>` VAZIO: nao dava erro, nao aparecia em teste nenhum, e a
 * plataforma abria com um buraco no lugar da saudacao.
 */
export const mensagemDeLogin = manifest.ui?.loginMessage?.trim() || "Bem-vindo";

/**
 * Rodape. Mesmo caso: vazio no cadastro, rodape em branco na tela.
 *
 * O ano sai da data de hoje em vez de ser fixo no texto — rodape com ano velho e
 * o tipo de coisa que ninguem percebe em janeiro e todo visitante percebe.
 */
export const rodape =
  manifest.ui?.footer?.trim() ||
  `© ${new Date().getFullYear()} ${marca}. Todos os direitos reservados.`;

/**
 * Numero de WhatsApp pronto para o link `wa.me`, ou nada.
 *
 * O `wa.me` exige DDI. O cadastro guarda o que a pessoa digitou, e digitar sem o
 * 55 e o normal — foi o que veio no primeiro cliente real: "38998215816", que
 * gera um link para um numero que nao existe. E numero errado e PIOR que numero
 * nenhum, porque manda o cliente falar com um desconhecido.
 *
 * 10 ou 11 digitos e telefone brasileiro sem DDI (fixo ou celular com o 9);
 * 12 ou 13 ja vem com ele. Fora dessas faixas nao ha o que deduzir com seguranca,
 * entao devolve nada e o cartao de WhatsApp simplesmente nao aparece.
 */
export function whatsappDoSuporte(): string | undefined {
  const digitos = String(manifest.support?.whatsapp ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return digitos;
  return undefined;
}

/**
 * Logo do cliente, ou nada.
 *
 * Nada e um resultado legitimo: sem logo, quem chama desenha o icone padrao. A
 * alternativa — uma imagem quebrada onde deveria estar a marca — e pior que o
 * icone generico, e e o que acontece quando se assume que o campo sempre vem.
 *
 * `assets.logo` (imagem embutida) vence `branding.logoUrl` (link) porque a
 * plataforma e do cliente: um link para a nossa API viraria dependencia externa
 * do site dele.
 */
export function logoDaMarca(): string | undefined {
  return manifest.assets?.logo || manifest.branding?.logoUrl || undefined;
}

/** Versao para fundo escuro; cai na normal quando o cliente so mandou uma. */
export function logoEscura(): string | undefined {
  return manifest.assets?.logoDark || manifest.branding?.logoDarkUrl || logoDaMarca();
}

/**
 * Favicon do cliente.
 *
 * Sem ele fica o `/favicon.ico` do modelo — que e o icone do CONSTRUTOR, nao o
 * do cliente. Numa aba com dez sistemas abertos, e por ele que a pessoa acha o
 * seu.
 */
export function faviconDaMarca(): string | undefined {
  return manifest.assets?.favicon || manifest.branding?.faviconUrl || undefined;
}

/**
 * CSS da marca, para ir INLINE no `<head>`, depois da folha de estilo.
 *
 * Podia ser um `useEffect` pintando as variaveis no cliente, e nao e: assim a
 * pagina nasceria com o tema neutro do modelo e trocaria para a cor da marca no
 * primeiro quadro. E o mesmo flash que o script de tema existe para evitar.
 *
 * **A separacao entre os dois blocos e deliberada.**
 *
 * As cores de MARCA (primaria, secundaria, destaque e o anel de foco, que e a
 * mesma cor do destaque) valem nos dois temas: a marca do cliente nao muda
 * porque anoiteceu.
 *
 * Ja fundo, superficie, texto e borda entram SO no tema claro. A paleta escura
 * do modelo foi desenhada para ser escura; deixar um `background` claro do
 * white-label vencer ali produziria texto claro sobre fundo claro — ilegivel, e
 * so para quem usa o tema escuro, que e justamente quem menos reporta.
 *
 * Sem `branding` no manifest, devolve string vazia e o tema neutro do modelo
 * vale inteiro.
 */
export function cssDaMarca(): string {
  const b = manifest.branding;
  if (!b) return "";

  // Aceita null porque e assim que coluna vazia do banco chega no JSON.
  const linha = (nome: string, valor?: string | null) => (valor ? `${nome}:${valor};` : "");

  const marcaNosDoisTemas =
    linha("--primary", b.primary) +
    linha("--secondary", b.secondary) +
    linha("--accent", b.accent) +
    linha("--ring", b.accent) +
    linha("--radius", b.radius);

  const soNoTemaClaro =
    linha("--background", b.background) +
    linha("--card", b.surface) +
    linha("--popover", b.surface) +
    linha("--foreground", b.text) +
    linha("--muted-foreground", b.muted) +
    linha("--border", b.border) +
    linha("--input", b.border);

  const partes: string[] = [];
  if (marcaNosDoisTemas) partes.push(`:root,.dark{${marcaNosDoisTemas}}`);
  if (soNoTemaClaro) partes.push(`:root{${soNoTemaClaro}}`);
  return partes.join("");
}
