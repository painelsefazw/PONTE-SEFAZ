import { manifest } from "./manifest";

/**
 * As variaveis que o servidor precisa para a plataforma funcionar.
 *
 * Sem elas, a biblioteca de sessao lanca **"Empty password"** e derruba a pagina
 * inteira — uma frase que nao diz o que fazer, num lugar que nao parece ter
 * relacao com configuracao. Foi o que apareceu na primeira vez que este modelo
 * abriu no construtor.
 *
 * Faltar configuracao e o estado NORMAL de um projeto recem-copiado. Entao ela
 * precisa ser tratada como tela, nao como falha: dizer quais faltam e para que
 * servem, em vez de estourar.
 *
 * **Sao duas, e nao quatro, de proposito.** Cada variavel a mais e uma chance a
 * mais de errar um digito copiando de um lugar para outro. O usuario do painel e
 * o CNPJ, que ja esta no manifest; o segredo de sessao e derivado da chave da
 * API, que ja e secreta. As duas que sobraram nao tem como sair de lugar nenhum:
 * uma e a credencial da API, a outra e a senha que o cliente escolhe.
 *
 * Nao existe valor padrao para nenhuma das duas, de proposito. Inventar um
 * segredo para "destravar o preview" produziria uma instalacao que parece pronta
 * e nao esta — e ninguem descobriria, porque funciona.
 *
 * Esta lista fica FORA do modulo `.server`: a tela de configuracao pendente roda
 * no navegador e precisa dos nomes. Sao nomes, nao valores — nenhum segredo
 * atravessa. Quem le `process.env` e o `config.server.ts`, que nunca vai ao
 * bundle do cliente.
 */
export const VARIAVEIS_OBRIGATORIAS = [
  {
    nome: "FISCAL_API_KEY",
    para: "Chave do cliente na API fiscal. Emite nota em nome da empresa.",
  },
  {
    nome: "APP_ACCESS_PASSWORD",
    para: "Senha de acesso ao painel.",
  },
] as const;

/**
 * As que existem, mas quase nunca precisam ser cadastradas.
 *
 * Aparecem na tela de configuracao como informacao, nao como pendencia: quem
 * abre o painel precisa saber que elas existem e de onde vem o valor, senao vai
 * procurar por que o login aceita um usuario que ninguem configurou.
 */
export const VARIAVEIS_OPCIONAIS = [
  {
    nome: "APP_USER",
    para: "Usuario do painel.",
    padrao: `o CNPJ da empresa (${manifest.company.cnpj})`,
  },
  {
    nome: "SESSION_SECRET",
    para: "Assina o cookie de sessao.",
    padrao: "derivado da chave da API — trocar a chave derruba as sessoes abertas",
  },
  {
    nome: "FISCAL_API_URL",
    // "usa o endereco padrao" nao dizia QUAL, e por muito tempo o padrao era um
    // dominio cravado no codigo: a plataforma de um cliente cadastrado numa
    // instalacao ia bater noutra, e a resposta era um 401 identico ao de chave
    // revogada. Hoje o padrao vem do manifest, e o valor aparece escrito aqui —
    // quem le sabe para onde as notas vao antes de emitir a primeira.
    para: "Endereco da ponte que emite para esta empresa.",
    padrao: manifest.api?.baseUrl || "NAO DEFINIDO — cadastre esta variavel",
  },
] as const;
