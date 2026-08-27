import { Signer } from '../infrastructure/crypto/Signer';
import { SefinClient, SefinMensagem } from '../infrastructure/nfse/SefinClient';
import { DpsXmlGenerator, gerarDhEmiDps } from '../infrastructure/nfse/DpsXmlGenerator';
import {
  EventoNfseXmlGenerator, CancelamentoInput, MotivoCancelamento, MotivoAnaliseFiscal,
} from '../infrastructure/nfse/EventoNfseXmlGenerator';
import { NfseAutorizada, parseNfse } from '../infrastructure/nfse/NfseParser';
import { DpsContextInput } from '../domain/nfse/DpsContext';

/**
 * Emissão, consulta e cancelamento de NFS-e no Sistema Nacional.
 *
 * O desenho segue os casos de uso da NF-e, mas o transporte é outro: a SEFIN é
 * REST e síncrona, então não há lote nem protocolo a consultar depois — a nota
 * volta autorizada na própria resposta do POST.
 */

export interface NfseResultado {
  sucesso: boolean;
  chaveAcesso?: string;
  idDps?: string;
  /** XML da NFS-e autorizada, para guardar. */
  xmlNfse?: string;
  /** XML do DPS assinado que foi enviado. */
  xmlEnviado: string;
  nota?: NfseAutorizada;
  erros?: SefinMensagem[];
  alertas?: SefinMensagem[];
  httpStatus?: number;
}

export interface NfseCancelamentoResultado {
  sucesso: boolean;
  chaveAcesso: string;
  xmlEnviado: string;
  xmlEvento?: string;
  erros?: SefinMensagem[];
  httpStatus?: number;
}

export class NfseUseCase {
  constructor(private readonly deps: {
    signer: Signer;
    client: SefinClient;
    ambiente: '1' | '2';
  }) {}

  /**
   * Emite a NFS-e.
   *
   * Antes de enviar, pergunta se já existe nota para aquele Id de DPS. Isso
   * cobre o caso de um timeout na tentativa anterior ter deixado a nota
   * autorizada do outro lado sem que soubéssemos — reenviar às cegas geraria
   * duplicata, que só se resolve cancelando.
   */
  async emitir(input: DpsContextInput): Promise<NfseResultado> {
    const contexto: DpsContextInput = {
      ...input,
      ambiente: input.ambiente || this.deps.ambiente,
      dataEmissao: input.dataEmissao || gerarDhEmiDps(),
    };

    const id = DpsXmlGenerator.montarId(contexto);
    const xml = new DpsXmlGenerator().gerar(contexto);
    const assinado = this.deps.signer.sign(xml, id);

    if (await this.jaEmitidaComSeguranca(id)) {
      const chave = await this.deps.client.consultarPorDps(id);
      if (chave) {
        const consulta = await this.deps.client.consultar(chave);
        return {
          sucesso: true,
          chaveAcesso: chave,
          idDps: id,
          xmlNfse: consulta.nfseXml,
          xmlEnviado: assinado,
          nota: consulta.nfseXml ? parseNfse(consulta.nfseXml) : undefined,
          alertas: [{
            codigo: 'NFSE_JA_EMITIDA',
            descricao: 'Já existia NFS-e para este DPS. Devolvida a nota existente, sem emitir outra.',
          }],
        };
      }
    }

    const res = await this.deps.client.emitir(assinado);

    return {
      sucesso: res.sucesso,
      chaveAcesso: res.chaveAcesso,
      idDps: res.idDps ?? id,
      xmlNfse: res.nfseXml,
      xmlEnviado: assinado,
      nota: res.nfseXml ? parseNfse(res.nfseXml) : undefined,
      erros: res.erros,
      alertas: res.alertas,
      httpStatus: res.httpStatus,
    };
  }

  /**
   * A verificação de duplicata não pode derrubar a emissão: se ela falhar por
   * rede, seguir e emitir é melhor do que recusar uma nota que provavelmente
   * não existe.
   */
  private async jaEmitidaComSeguranca(id: string): Promise<boolean> {
    try {
      return await this.deps.client.jaEmitida(id);
    } catch {
      return false;
    }
  }

  /** Consulta a NFS-e pela chave de acesso. */
  async consultar(chaveAcesso: string): Promise<{ sucesso: boolean; nota?: NfseAutorizada; xmlNfse?: string }> {
    const r = await this.deps.client.consultar(chaveAcesso.replace(/\D/g, ''));
    return {
      sucesso: r.sucesso,
      xmlNfse: r.nfseXml,
      nota: r.nfseXml ? parseNfse(r.nfseXml) : undefined,
    };
  }

  /** Consulta pelo Id do DPS, quando não se guardou a chave. */
  async consultarPorDps(idDps: string): Promise<{ sucesso: boolean; chaveAcesso?: string; nota?: NfseAutorizada }> {
    const chave = await this.deps.client.consultarPorDps(idDps);
    if (!chave) return { sucesso: false };
    const r = await this.consultar(chave);
    return { sucesso: r.sucesso, chaveAcesso: chave, nota: r.nota };
  }

  /**
   * Cancela a NFS-e.
   *
   * O prazo de cancelamento é do município, não do Sistema Nacional: cada um
   * define o seu, e a recusa por prazo vencido vem da SEFIN na hora. Quando
   * isso acontece, o caminho é `substituir()`.
   */
  async cancelar(entrada: {
    chaveAcesso: string;
    cnpjAutor: string;
    motivo: MotivoCancelamento;
    justificativa: string;
  }): Promise<NfseCancelamentoResultado> {
    const input: CancelamentoInput = {
      ambiente: this.deps.ambiente,
      chaveAcesso: entrada.chaveAcesso,
      cnpjAutor: entrada.cnpjAutor,
      motivo: entrada.motivo,
      justificativa: entrada.justificativa,
      dataEvento: gerarDhEmiDps(),
    };

    const xml = new EventoNfseXmlGenerator().gerarCancelamento(input);
    const chave = entrada.chaveAcesso.replace(/\D/g, '');
    const assinado = this.deps.signer.sign(xml, EventoNfseXmlGenerator.montarId(chave));

    const res = await this.deps.client.registrarEvento(chave, assinado);

    return {
      sucesso: res.sucesso,
      chaveAcesso: chave,
      xmlEnviado: assinado,
      xmlEvento: res.nfseXml,
      erros: res.erros,
      httpStatus: res.httpStatus,
    };
  }

  /**
   * Substitui uma NFS-e por outra.
   *
   * É o caminho quando o prazo de cancelamento do município já venceu. Não é um
   * evento: emite-se uma **nota nova** declarando qual substitui, e o Sistema
   * Nacional cancela a antiga ao autorizar. Tentar pelo POST de eventos é
   * recusado com E1861.
   *
   * Por isso a assinatura aqui é a de uma emissão: recebe o DPS completo da
   * nota correta, mais a identificação da que sai de circulação.
   */
  async substituir(
    notaNova: DpsContextInput,
    substituicao: { chaveSubstituida: string; motivo: string; descricaoMotivo?: string },
  ): Promise<NfseResultado> {
    return this.emitir({ ...notaNova, substituicao });
  }

  /**
   * Pede análise fiscal para cancelar a nota.
   *
   * É o recurso quando o prazo de cancelamento do município venceu e a
   * substituição não serve — por exemplo, quando o serviço não foi prestado e
   * não há nota correta para colocar no lugar. O fisco responde com o
   * deferimento (`e105104`) ou o indeferimento (`e105105`), que aparecem na
   * consulta de eventos.
   */
  async solicitarAnaliseFiscal(entrada: {
    chaveAcesso: string;
    cnpjAutor: string;
    motivo: MotivoAnaliseFiscal;
    justificativa: string;
  }): Promise<NfseCancelamentoResultado> {
    const xml = new EventoNfseXmlGenerator().gerarEvento('e101103', {
      ambiente: this.deps.ambiente,
      chaveAcesso: entrada.chaveAcesso,
      cnpjAutor: entrada.cnpjAutor,
      dataEvento: gerarDhEmiDps(),
      motivo: entrada.motivo,
      justificativa: entrada.justificativa,
    });

    const chave = entrada.chaveAcesso.replace(/\D/g, '');
    const assinado = this.deps.signer.sign(
      xml,
      EventoNfseXmlGenerator.montarId(chave, EventoNfseXmlGenerator.tipoDe('e101103')),
    );
    const res = await this.deps.client.registrarEvento(chave, assinado);

    return {
      sucesso: res.sucesso,
      chaveAcesso: chave,
      xmlEnviado: assinado,
      xmlEvento: res.nfseXml,
      erros: res.erros,
      httpStatus: res.httpStatus,
    };
  }

  /**
   * Eventos registrados sobre a nota, direto na SEFIN.
   *
   * O status guardado aqui só reflete o que passou por este sistema. Município
   * cancelando de ofício ou tomador rejeitando a nota não aparecem — por isso a
   * consulta existe.
   */
  async consultarEvento(chaveAcesso: string, tipoEvento: string, numSeqEvento = 1) {
    return this.deps.client.consultarEvento(
      chaveAcesso.replace(/\D/g, ''), tipoEvento, numSeqEvento,
    );
  }
}
