/**
 * O que fazer com uma rejeicao da SEFAZ.
 *
 * A SEFAZ devolve `cStat` e `xMotivo`, e o `xMotivo` descreve o SINTOMA sem
 * dizer o que fazer — as vezes apontando para o lugar errado. O caso que
 * originou este arquivo: uma empresa CREDENCIADA, com IE ativa, recebeu
 *
 *     178 — CNPJ [...] do emitente nao cadastrado na Receita Federal
 *
 * em homologacao. Lido ao pe da letra, manda conferir a Receita Federal, onde
 * nao ha nada errado. A causa real e outra: a base de homologacao da SEFAZ e
 * sintetica e nao tem todos os CNPJs reais.
 *
 * Cada dica desta lista custou uma investigacao. Sem elas, o cliente liga.
 *
 * DUAS REGRAS que este arquivo nao pode quebrar:
 *
 * 1. A dica ACOMPANHA o `xMotivo`, nunca o substitui. A SEFAZ e a fonte; se a
 *    dica estiver desatualizada, o texto oficial continua na tela ao lado.
 * 2. Codigo desconhecido devolve `null`. Inventar uma causa provavel errada e
 *    pior do que nao dar nenhuma — manda procurar no lugar errado com
 *    confianca, e foi exatamente o que o `xMotivo` do 178 fez.
 */

export interface DicaDeRejeicao {
  /** O que de fato aconteceu, quando o `xMotivo` nao deixa claro. */
  causa: string;
  /** A acao concreta, na ordem de quem vai executar. */
  comoResolver: string;
}

const DICAS: Record<string, DicaDeRejeicao> = {
  178: {
    causa: 'Em HOMOLOGACAO a SEFAZ usa uma base de cadastro sintetica, que nao '
      + 'tem todos os CNPJs reais. Uma empresa perfeitamente regular aparece ali '
      + 'como "nao cadastrada".',
    comoResolver: 'Confirme o credenciamento real em '
      + '`GET /api/empresas/{cnpj}/credenciamento` — ele consulta o cadastro de '
      + 'PRODUCAO, que e o que vale. Se responder CREDENCIADA, nao ha o que '
      + 'corrigir: esta empresa so consegue emitir em producao.',
  },
  204: {
    causa: 'Ja existe nota autorizada com este numero e serie para este emitente.',
    comoResolver: 'Consulte a chave em `/api/consultar` antes de reemitir: se a '
      + 'anterior foi autorizada, use o XML dela em vez de gerar outra. Se o '
      + 'contador local ficou para tras, o proximo numero livre vem de '
      + '`/api/proximo-numero`.',
  },
  209: {
    causa: 'A Inscricao Estadual do EMITENTE nao confere com a que a SEFAZ tem '
      + 'para este CNPJ. Derruba toda emissao da empresa, e a mensagem nao diz '
      + 'qual e a certa.',
    comoResolver: 'Rode `POST /api/empresas/{cnpj}/sincronizar-ie`: ele le a IE '
      + 'direto da SEFAZ e corrige o cadastro. Nao e palpite — ou os numeros '
      + 'batem, ou o da SEFAZ e o correto.',
  },
  210: {
    causa: 'A Inscricao Estadual do DESTINATARIO nao confere, ou foi informada '
      + 'para quem nao e contribuinte.',
    comoResolver: 'Para consumidor final sem inscricao, use `indIEDest: "9"` e '
      + 'NAO envie `ie`. Mandar IE junto de "nao contribuinte" e o erro mais '
      + 'comum aqui.',
  },
  228: {
    causa: 'A data de emissao esta atrasada demais para a SEFAZ aceitar.',
    comoResolver: 'Emita com a data de hoje. Nota de dias atras nao entra: o '
      + 'prazo e curto e contado pela SEFAZ, nao pelo sistema.',
  },
  252: {
    causa: 'O ambiente do XML nao e o ambiente do servico chamado — nota de '
      + 'homologacao indo para producao, ou o contrario.',
    comoResolver: 'Mande `ambiente` explicito no corpo ("1" producao, "2" '
      + 'homologacao). Sem ele, vale o cadastro da empresa, que pode divergir do '
      + 'que voce esperava.',
  },
  280: {
    causa: 'O certificado digital foi recusado pela SEFAZ.',
    comoResolver: 'Confira a validade e reenvie o A1 no cadastro do cliente. '
      + 'Certificado vencido rejeita TUDO, e o sintoma aparece na emissao, longe '
      + 'da causa.',
  },
  281: {
    causa: 'O certificado esta fora do prazo de validade.',
    comoResolver: 'Renove o A1 com a certificadora e reenvie no cadastro. '
      + 'A ponte avisa o vencimento antes — vale olhar os alertas.',
  },
  283: {
    causa: 'O CNPJ do certificado nao e o CNPJ do emitente da nota.',
    comoResolver: 'Confira se o certificado enviado e o da empresa certa. '
      + 'Certificado de matriz nao assina nota de filial com CNPJ diferente.',
  },
  286: {
    causa: 'O certificado foi REVOGADO pela certificadora.',
    comoResolver: 'Nao ha ajuste possivel no sistema: e preciso emitir um novo '
      + 'certificado. Revogacao costuma ser por comprometimento da chave.',
  },
  297: {
    causa: 'A assinatura digital do XML nao confere.',
    comoResolver: 'Quase sempre e o certificado errado ou corrompido no envio. '
      + 'Reenvie o A1; se persistir, o arquivo .pfx pode ter sido truncado no '
      + 'upload.',
  },
  539: {
    causa: 'Ja existe nota com este numero e serie, mas com CHAVE diferente — '
      + 'ou seja, com conteudo diferente do que voce esta mandando agora.',
    comoResolver: 'Nao reemita: consulte a chave anterior e decida se ela vale. '
      + 'Se nao valer, cancele-a e emita com o PROXIMO numero, nunca com o '
      + 'mesmo.',
  },
  610: {
    causa: 'O total da nota nao bate com a soma dos itens.',
    comoResolver: 'Confira arredondamento: quantidade com 4 casas e valor '
      + 'unitario com 2 podem fechar um total que a SEFAZ recalcula diferente. '
      + 'O total tem de ser a soma exata dos itens.',
  },
  656: {
    causa: 'Consumo indevido na distribuicao de documentos. A SEFAZ bloqueia '
      + 'quem consulta seguidamente a partir do mesmo NSU sem trazer nota nova.',
    comoResolver: 'Espere 1 hora SEM tentar de novo. Cada nova tentativa dentro '
      + 'da janela reinicia o relogio — insistir e o que transforma o aviso em '
      + 'bloqueio permanente.',
  },
  778: {
    causa: 'O NCM informado nao existe na tabela oficial.',
    comoResolver: 'Confira o NCM em `/api/ncm/buscar`. Codigo com digito trocado '
      + 'e a causa mais comum; NCM antigo que saiu da tabela e a segunda.',
  },
};

/**
 * A dica para uma rejeicao, ou `null` quando nao ha uma confiavel.
 *
 * `null` e resposta legitima e frequente: sao centenas de codigos, e a maioria
 * o `xMotivo` ja explica. A lista so cresce com caso visto de verdade.
 */
export function dicaDaRejeicao(cStat: string | number | undefined | null): DicaDeRejeicao | null {
  const codigo = String(cStat ?? '').trim();
  return DICAS[codigo] ?? null;
}

/** Quantas rejeicoes a lista cobre — usado pelo manual e pelos testes. */
export function rejeicoesComDica(): string[] {
  return Object.keys(DICAS).sort();
}
