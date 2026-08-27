import { create } from 'xmlbuilder2';

/**
 * Pedido de registro de evento da NFS-e.
 *
 *   pedRegEvento[versao] → infPedReg[Id] + Signature
 *   infPedReg: tpAmb verAplic dhEvento (CNPJAutor|CPFAutor) chNFSe
 *              (e101101|e105102|e101103|...)
 *
 * A assinatura vai sobre `infPedReg`, como na DPS vai sobre `infDPS` e na NF-e
 * sobre `infNFe` — o mesmo Signer atende os três.
 *
 * ATENÇÃO — o schema em produção não é o publicado. Os pacotes XSD que a
 * Receita distribui (v1.00 de set/2025 e o v1.01 usado pelas bibliotecas)
 * descrevem o Id como `TSIdPedRefEvt` = `PRE[0-9]{59}` e trazem um elemento
 * `nPedRegEvento` entre `chNFSe` e o grupo do evento. O ambiente real
 * (SefinNacional 1.6.0) cobra `TSIdPedRegEvt`, recusa qualquer Id de 59
 * dígitos, e não conhece `nPedRegEvento` — a mensagem de erro lista os
 * elementos que ele aceita depois de `chNFSe`, e são só os grupos de evento.
 *
 * Levantado por tentativa contra a produção restrita: com o Id de 56 dígitos e
 * sem `nPedRegEvento`, o pedido passa na validação de schema. Se um dia o
 * ambiente for alinhado ao XSD publicado, isto aqui quebra — e o teste que
 * trava o formato é que vai apontar onde.
 */

const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse';
const VERSAO = '1.01';

/**
 * Justificativas aceitas no cancelamento (`TSCodJustCanc`).
 *
 * São só estas três: não há código para "cancelamento a pedido do cliente" nem
 * para devolução. O que não for erro de emissão ou serviço não prestado cai em
 * "Outros", e aí o texto do motivo é que explica.
 */
export const MOTIVOS_CANCELAMENTO = {
  '1': 'Erro na emissão',
  '2': 'Serviço não prestado',
  '9': 'Outros',
} as const;

export type MotivoCancelamento = keyof typeof MOTIVOS_CANCELAMENTO;

export interface CancelamentoInput {
  /** '1' produção, '2' produção restrita. */
  ambiente: '1' | '2';
  /** Chave de acesso da NFS-e — 50 dígitos. */
  chaveAcesso: string;
  /** CNPJ de quem pede o cancelamento (normalmente o prestador). */
  cnpjAutor: string;
  motivo: MotivoCancelamento;
  /** Texto livre explicando. Mínimo de 15 caracteres. */
  justificativa: string;
  /** Data e hora do evento, ISO 8601 com fuso. */
  dataEvento: string;
  versaoAplicativo?: string;
}

/**
 * Justificativas da substituição de NFS-e (`TSCodJustSubst`).
 *
 * Note que aqui os códigos têm **dois dígitos** ('01', '02', …), enquanto os do
 * cancelamento comum têm um ('1', '2', '9'). São tabelas diferentes com
 * formatos diferentes, no mesmo documento.
 *
 * Usados no grupo `subst` da DPS, não em evento: a SEFIN recusa o pedido de
 * evento e105102 com E1861 ("não é aceito pelo método POST da API Eventos").
 * Quem gera o evento é o Sistema Nacional, ao autorizar a nota substituta.
 */
export const MOTIVOS_SUBSTITUICAO = {
  '01': 'Desenquadramento de NFS-e do Simples Nacional',
  '02': 'Enquadramento de NFS-e no Simples Nacional',
  '03': 'Inclusão retroativa de imunidade ou isenção',
  '04': 'Exclusão retroativa de imunidade ou isenção',
  '05': 'Rejeição pelo tomador ou intermediário responsável pelo recolhimento',
  '99': 'Outros',
} as const;

export type MotivoSubstituicao = keyof typeof MOTIVOS_SUBSTITUICAO;

/**
 * Motivos da solicitação de análise fiscal (`TSCodJustAnaliseFiscalCanc`).
 *
 * A documentação do XSD lista "3 - Outros", mas a enumeração aceita `1 2 9` —
 * o "outros" é 9, como no cancelamento comum. Vale a enumeração.
 */
export const MOTIVOS_ANALISE_FISCAL = {
  '1': 'Erro na emissão',
  '2': 'Serviço não prestado',
  '9': 'Outros',
} as const;

export type MotivoAnaliseFiscal = keyof typeof MOTIVOS_ANALISE_FISCAL;

/**
 * Eventos que o contribuinte pode registrar, além do cancelamento.
 *
 * Ficaram de fora, por natureza, os que só o fisco ou o próprio sistema
 * emitem — e dá para saber quais são pela estrutura: a anulação de rejeição
 * (`e205208`) exige `CPFAgTrib`, o CPF do agente da administração tributária;
 * o deferimento e o indeferimento (`e105104`, `e105105`) são a resposta do
 * fisco a este `e101103`; os de ofício (`e305101` a `e305103`) são do
 * município; e a confirmação tácita (`e205204`) vem do decurso de prazo.
 *
 * Ficaram de fora, **por impedimento**, os seis de manifestação: confirmação
 * (`e202201`, `e203202`, `e204203`) e rejeição (`e202205`, `e203206`,
 * `e204207`) do prestador, tomador e intermediário. O `xDesc` deles é
 * enumeração fechada e o ambiente real recusa o texto do XSD publicado; nove
 * grafias foram testadas contra a produção restrita — com e sem acento, com
 * "de" no lugar de "do", em caixa alta, com "de Serviço" no fim — e todas
 * falharam, sem que a mensagem de erro enumere o valor aceito. Implementá-los
 * às cegas entregaria um caminho que rejeita sempre.
 *
 * O `xDesc` do `e101103` abaixo é o **acentuado**, ao contrário do que o XSD
 * publicado traz — mesma inversão do cancelamento por substituição.
 */
const EVENTOS: Record<string, { tipo: string; xDesc: string; payload?: 'analiseFiscal' }> = {
  e101103: {
    tipo: '101103',
    xDesc: 'Solicitação de Análise Fiscal para Cancelamento de NFS-e',
    payload: 'analiseFiscal',
  },
};

export type TipoEventoContribuinte = keyof typeof EVENTOS;

export interface EventoInput {
  ambiente: '1' | '2';
  chaveAcesso: string;
  cnpjAutor: string;
  dataEvento: string;
  /** Obrigatório na análise fiscal. */
  motivo?: string;
  /** Obrigatório na análise fiscal. */
  justificativa?: string;
  versaoAplicativo?: string;
}

/** O Id do infPedReg é 'PRE' + chave (50) + tipo do evento (6). */
const TIPO_EVENTO_CANCELAMENTO = '101101';

/** Mínimo do `TSMotivo` no XSD. Textos curtos como "erro" são recusados. */
const JUSTIFICATIVA_MIN = 15;
const JUSTIFICATIVA_MAX = 255;

export class EventoNfseXmlGenerator {
  /** Id do pedido: 'PRE' + chave (50) + tipo do evento (6). */
  static montarId(chaveAcesso: string, tipoEvento = TIPO_EVENTO_CANCELAMENTO): string {
    return 'PRE' + chaveAcesso.replace(/\D/g, '') + tipoEvento;
  }

  /** Monta o pedido de cancelamento, pronto para assinar. */
  gerarCancelamento(input: CancelamentoInput): string {
    const chave = validarChave(input.chaveAcesso);
    const justificativa = validarJustificativa(input.justificativa, true);

    if (!MOTIVOS_CANCELAMENTO[input.motivo]) {
      throw new Error(
        `NFSE_MOTIVO_INVALIDO: "${input.motivo}" — use 1 (erro na emissão), `
        + '2 (serviço não prestado) ou 9 (outros).',
      );
    }

    const { doc, inf } = this.envelope(input, chave, TIPO_EVENTO_CANCELAMENTO);

    // xDesc é enumeração fechada no XSD: o texto tem que ser exatamente este.
    const ev = inf.ele('e101101');
    ev.ele('xDesc').txt('Cancelamento de NFS-e').up();
    ev.ele('cMotivo').txt(input.motivo).up();
    ev.ele('xMotivo').txt(justificativa!).up();
    ev.up();

    inf.up();
    return doc.end({ prettyPrint: false });
  }

  /**
   * Monta qualquer evento do contribuinte além do cancelamento.
   *
   * Hoje só a solicitação de análise fiscal — ver o comentário de EVENTOS
   * sobre os de manifestação. A forma é orientada a tabela porque todos têm a
   * mesma casca e mudam só no que vai dentro do grupo do evento.
   */
  gerarEvento(tipo: TipoEventoContribuinte, input: EventoInput): string {
    const def = EVENTOS[tipo];
    if (!def) {
      throw new Error(
        `NFSE_EVENTO_NAO_SUPORTADO: "${tipo}" — o contribuinte pode registrar ${
          Object.keys(EVENTOS).join(', ')} e o cancelamento (e101101, use gerarCancelamento). `
        + 'Os demais são do fisco ou gerados pelo próprio sistema.',
      );
    }

    const chave = validarChave(input.chaveAcesso);
    const { doc, inf } = this.envelope(input, chave, def.tipo);
    const ev = inf.ele(tipo);
    ev.ele('xDesc').txt(def.xDesc).up();

    if (def.payload === 'analiseFiscal') {
      if (!(String(input.motivo) in MOTIVOS_ANALISE_FISCAL)) {
        throw new Error(
          `NFSE_MOTIVO_ANALISE_INVALIDO: "${input.motivo}" — use ${
            Object.entries(MOTIVOS_ANALISE_FISCAL).map(([k, d]) => `${k} (${d})`).join(', ')}. `
          + 'A documentação do XSD cita um "3", mas a enumeração não o aceita.',
        );
      }
      // Aqui a justificativa é obrigatória, ao contrário da rejeição.
      const texto = validarJustificativa(input.justificativa, true);
      ev.ele('cMotivo').txt(String(input.motivo)).up();
      ev.ele('xMotivo').txt(texto!).up();
    }

    ev.up();
    inf.up();
    return doc.end({ prettyPrint: false });
  }

  /** Tipo numérico do evento, para montar o Id do pedido. */
  static tipoDe(evento: TipoEventoContribuinte): string {
    return EVENTOS[evento]?.tipo ?? TIPO_EVENTO_CANCELAMENTO;
  }

  /** Cabeçalho comum a todos os pedidos de evento. */
  private envelope(
    input: { ambiente: '1' | '2'; cnpjAutor: string; dataEvento: string; versaoAplicativo?: string },
    chave: string,
    tipoEvento: string,
  ): { doc: any; inf: any } {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('pedRegEvento', { xmlns: NFSE_NS, versao: VERSAO });

    const inf = doc.ele('infPedReg', { Id: EventoNfseXmlGenerator.montarId(chave, tipoEvento) });
    inf.ele('tpAmb').txt(input.ambiente).up();
    inf.ele('verAplic').txt(input.versaoAplicativo || 'NFeEngine-1.0').up();
    inf.ele('dhEvento').txt(input.dataEvento).up();
    inf.ele('CNPJAutor').txt(input.cnpjAutor.replace(/\D/g, '')).up();
    inf.ele('chNFSe').txt(chave).up();

    return { doc, inf };
  }
}

/** A chave da NFS-e tem 50 dígitos; a da NF-e tem 44 e é o erro comum. */
function validarChave(valor: string, campo = 'chaveAcesso'): string {
  const chave = String(valor ?? '').replace(/\D/g, '');
  if (chave.length !== 50) {
    throw new Error(
      `NFSE_CHAVE_INVALIDA: ${campo} = "${valor}" — a chave da NFS-e tem 50 dígitos `
      + `(a da NF-e tem 44; não são o mesmo formato). Recebida com ${chave.length}.`,
    );
  }
  return chave;
}

function validarJustificativa(valor: string | undefined, obrigatoria: boolean): string | undefined {
  const texto = (valor || '').trim();
  if (!texto) {
    if (!obrigatoria) return undefined;
    throw new Error(
      `NFSE_JUSTIFICATIVA_CURTA: a justificativa tem 0 caracteres e o mínimo é ${JUSTIFICATIVA_MIN}. `
      + 'Descreva o motivo por extenso.',
    );
  }
  if (texto.length < JUSTIFICATIVA_MIN) {
    throw new Error(
      `NFSE_JUSTIFICATIVA_CURTA: a justificativa tem ${texto.length} caracteres e o `
      + `mínimo é ${JUSTIFICATIVA_MIN}. Descreva o motivo por extenso.`,
    );
  }
  if (texto.length > JUSTIFICATIVA_MAX) {
    throw new Error(
      `NFSE_JUSTIFICATIVA_LONGA: a justificativa tem ${texto.length} caracteres e o `
      + `máximo é ${JUSTIFICATIVA_MAX}.`,
    );
  }
  return texto;
}
