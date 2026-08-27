import { create } from 'xmlbuilder2';

const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';

const CCE_COND_USO =
    'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, '
    + 'de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na '
    + 'emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis '
    + 'que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, '
    + 'quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique '
    + 'mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

export interface EventoInput {
    chaveAcesso: string;
    cnpj: string;
    cUF: string;
    ambiente: string;
    nSeqEvento: number;
    dhEvento: string;
}

export interface CancelamentoInput extends EventoInput {
    nProt: string;
    xJust: string;
}

export interface CartaCorrecaoInput extends EventoInput {
    xCorrecao: string;
}

export class EventXmlGenerator {

    private buildEnvEvento(
        input: EventoInput,
        tpEvento: string,
        descEvento: string,
        addDetFields: (detEvento: any) => void,
        loteId: string,
    ): string {
        const nSeqPadded = String(input.nSeqEvento).padStart(2, '0');

        const doc = create()
            .ele(SEFAZ_NS, 'envEvento', { versao: '1.00' });

        doc.ele('idLote').txt(loteId).up();

        const evento = doc.ele('evento', { versao: '1.00' });
        const infEvento = evento.ele('infEvento', {
            Id: `ID${tpEvento}${input.chaveAcesso}${nSeqPadded}`,
        });

        infEvento.ele('cOrgao').txt(input.cUF).up();
        infEvento.ele('tpAmb').txt(input.ambiente).up();
        infEvento.ele('CNPJ').txt(input.cnpj).up();
        infEvento.ele('chNFe').txt(input.chaveAcesso).up();
        infEvento.ele('dhEvento').txt(input.dhEvento).up();
        infEvento.ele('tpEvento').txt(tpEvento).up();
        // nSeqEvento no elemento vai SEM zero à esquerda (schema: [1-9][0-9]?);
        // só o Id usa o formato de 2 dígitos (nSeqPadded).
        infEvento.ele('nSeqEvento').txt(String(input.nSeqEvento)).up();
        infEvento.ele('verEvento').txt('1.00').up();

        const detEvento = infEvento.ele('detEvento', { versao: '1.00' });
        detEvento.ele('descEvento').txt(descEvento).up();
        addDetFields(detEvento);
        detEvento.up();

        infEvento.up();
        evento.up();

        return doc.end({ prettyPrint: false });
    }

    generateCancelamento(input: CancelamentoInput, loteId: string): string {
        return this.buildEnvEvento(
            input,
            '110111',
            'Cancelamento',
            (detEvento) => {
                detEvento.ele('nProt').txt(input.nProt).up();
                detEvento.ele('xJust').txt(input.xJust).up();
            },
            loteId,
        );
    }

    generateCartaCorrecao(input: CartaCorrecaoInput, loteId: string): string {
        return this.buildEnvEvento(
            input,
            '110110',
            'Carta de Correcao',
            (detEvento) => {
                detEvento.ele('xCorrecao').txt(input.xCorrecao).up();
                detEvento.ele('xCondUso').txt(CCE_COND_USO).up();
            },
            loteId,
        );
    }
}
