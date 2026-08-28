/**
 * As variaveis que este console precisa para falar com a ponte.
 *
 * Faltar configuracao e o estado NORMAL de um projeto recem-copiado. Entao ela e
 * tratada como tela, nao como falha: a aplicacao diz quais faltam e para que
 * servem, em vez de estourar com "Empty password" da biblioteca de sessao — uma
 * frase que nao diz o que fazer, num lugar que nao parece ter relacao com
 * configuracao.
 *
 * Nenhuma tem valor padrao, de proposito. Inventar um segredo para "destravar o
 * preview" produz uma instalacao que parece pronta e nao esta — e ninguem
 * descobre, porque funciona.
 *
 * Esta lista fica FORA do modulo `.server`: a tela de pendencias roda no
 * navegador e precisa dos NOMES. Sao nomes, nao valores. Quem le `process.env` e
 * o `config.server.ts`, que nunca vai para o bundle do cliente.
 */
export const VARIAVEIS_OBRIGATORIAS = [
  {
    nome: "EMISSOR_API_URL",
    para: "Endereço da ponte fiscal que este console administra. Ex.: https://sua-ponte.vercel.app",
  },
  {
    nome: "EMISSOR_ADMIN_KEY",
    para: "A WEBAPP_SENHA da ponte. É a credencial de administrador dela — nunca vai para o navegador.",
  },
  {
    nome: "APP_ACCESS_PASSWORD",
    para: "Senha para entrar NESTE console. Separada da chave da ponte de propósito.",
  },
] as const;

/**
 * As que existem, mas quase nunca precisam ser cadastradas.
 *
 * Aparecem na tela de pendencias como informacao, nao como falta: quem abre
 * precisa saber que existem e de onde vem o valor, senao procura por que o login
 * aceita um usuario que ninguem configurou.
 */
export const VARIAVEIS_OPCIONAIS = [
  {
    nome: "APP_USER",
    para: "Usuário do console. Sem cadastrar, é `admin`.",
  },
  {
    nome: "SESSION_SECRET",
    para: "Assina o cookie. Sem cadastrar, é derivado da chave da ponte.",
  },
] as const;

/**
 * Por que a senha do console nao e a mesma chave da ponte.
 *
 * A chave administrativa da ponte abre TUDO: cadastro de cliente, certificado,
 * geracao de chave de API, publicacao de plataforma. Usar ela tambem como senha
 * de login significaria que toda pessoa que opera o console conhece a credencial
 * mestre — e uma credencial que varias pessoas conhecem nao se revoga sem parar
 * todo mundo.
 *
 * Separadas, trocar quem opera e trocar uma senha; trocar a chave da ponte
 * continua sendo um evento raro e deliberado.
 */
export const PORQUE_DUAS_SENHAS = true;
