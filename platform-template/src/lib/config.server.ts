import { createHmac } from "node:crypto";

import { VARIAVEIS_OBRIGATORIAS } from "./config";
import { manifest } from "./manifest";

/**
 * Nomes das obrigatorias que estao ausentes ou vazias.
 *
 * So o servidor le isto. String vazia conta como ausente: variavel cadastrada em
 * branco no provedor e o engano mais comum, e ela passa em `if (!process.env.X)`
 * quando alguem escreve a checagem na mao.
 */
export function faltamVariaveis(): string[] {
  return VARIAVEIS_OBRIGATORIAS
    .filter(({ nome }) => !String(process.env[nome] ?? "").trim())
    .map(({ nome }) => nome);
}

/**
 * Usuario do painel: o CNPJ da empresa.
 *
 * Nao precisa ser cadastrado — ele ja esta no manifest, e o CNPJ e publico de
 * qualquer forma (sai impresso na nota). Pedir que fosse digitado numa variavel
 * de ambiente era pedir para copiar de um arquivo do repositorio para outro
 * lugar, com a chance de errar um digito no meio.
 *
 * `APP_USER` continua valendo como sobrescrita, para a instalacao que precisar
 * de um usuario diferente do CNPJ.
 */
export function usuarioDoPainel(): string {
  return String(process.env["APP_USER"] ?? "").trim() || manifest.company.cnpj;
}

/**
 * Segredo que assina o cookie de sessao.
 *
 * Quando `SESSION_SECRET` nao vem, e DERIVADO da chave da API — que ja e um
 * segredo forte, ja esta cadastrada e so existe no servidor. Uma variavel a
 * menos para cadastrar, sem baixar a guarda: o valor continua sendo secreto,
 * porque nasce de outro segredo, e o HMAC nao permite voltar dele para a chave.
 *
 * Isto NAO e o mesmo que ter um padrao embutido no codigo. Um padrao fixo seria
 * publico — todo mundo que lesse o repositorio poderia assinar um cookie valido
 * para qualquer instalacao. Aqui, duas instalacoes com chaves diferentes tem
 * segredos de sessao diferentes, e ninguem que leia o codigo consegue derivar o
 * de ninguem.
 *
 * **O preco, para constar:** trocar a chave da API invalida as sessoes abertas e
 * todo mundo precisa entrar de novo. E o comportamento certo — chave rotacionada
 * costuma ser chave comprometida —, mas nao pode ser surpresa.
 *
 * `SESSION_SECRET` continua valendo como sobrescrita, e a sobrescrita e o que
 * mantem a sessao viva atravessando uma troca de chave.
 */
export function segredoDeSessao(): string {
  const explicito = String(process.env["SESSION_SECRET"] ?? "").trim();
  if (explicito) return explicito;

  const chave = String(process.env["FISCAL_API_KEY"] ?? "").trim();
  // Sem chave nao ha o que derivar. Quem barra este caso e a tela de
  // configuracao pendente, antes de a sessao ser aberta.
  if (!chave) return "";

  // O rotulo separa este uso de qualquer outro que venha a derivar da mesma
  // chave: dois segredos distintos nao podem sair do mesmo material sem ele.
  return createHmac("sha256", chave).update("sessao:v1").digest("base64url");
}
