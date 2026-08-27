import { create } from 'xmlbuilder2';
import {
    NFe,
    Endereco,
    DetalheItem,
    TipoICMS,
    ICMSUFDest_Props,
    TipoIPI,
    TipoPIS,
    TipoCOFINS,
    ImpostoIBSCBS,
    RedIbsCbs,
} from '../../domain/models';

const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';

export class XmlGenerator {

    /**
     * Adds an XML element only when the value is defined, not null, and not empty.
     */
    private addOpt(parent: any, name: string, value: string | undefined | null): void {
        if (value !== undefined && value !== null && value !== '') {
            parent.ele(name).txt(value).up();
        }
    }

    /**
     * Serializes an Endereco into the current parent element.
     */
    private addEndereco(parent: any, end: Endereco): void {
        this.addOpt(parent, 'xLgr', end.xLgr);
        this.addOpt(parent, 'nro', end.nro);
        this.addOpt(parent, 'xCpl', end.xCpl);
        this.addOpt(parent, 'xBairro', end.xBairro);
        this.addOpt(parent, 'cMun', end.cMun);
        this.addOpt(parent, 'xMun', end.xMun);
        this.addOpt(parent, 'UF', end.UF);
        this.addOpt(parent, 'CEP', end.CEP);
        this.addOpt(parent, 'cPais', end.cPais);
        this.addOpt(parent, 'xPais', end.xPais);
        this.addOpt(parent, 'fone', end.fone);
    }

    /**
     * Serializes ICMS discriminated union into an <ICMS> element.
     */
    private addICMS(parent: any, icms: TipoICMS): void {
        const icmsEl = parent.ele('ICMS');

        // Os grupos abaixo seguem a ordem de campos do XSD. Ela nao e a ordem
        // "logica" — em varios deles a base da ST vem antes da aliquota — e
        // trocar rende rejeicao de schema (cStat 225), que nao diz o campo.

        if ('ICMS30' in icms) {
            const d = icms.ICMS30;
            const el = icmsEl.ele('ICMS30');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            el.ele('modBCST').txt(d.modBCST).up();
            this.addOpt(el, 'pMVAST', d.pMVAST);
            this.addOpt(el, 'pRedBCST', d.pRedBCST);
            el.ele('vBCST').txt(d.vBCST).up();
            el.ele('pICMSST').txt(d.pICMSST).up();
            el.ele('vICMSST').txt(d.vICMSST).up();
            this.addOpt(el, 'vICMSDeson', d.vICMSDeson);
            this.addOpt(el, 'motDesICMS', d.motDesICMS);
            el.up();
        } else if ('ICMS51' in icms) {
            const d = icms.ICMS51;
            const el = icmsEl.ele('ICMS51');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            this.addOpt(el, 'modBC', d.modBC);
            this.addOpt(el, 'pRedBC', d.pRedBC);
            this.addOpt(el, 'vBC', d.vBC);
            this.addOpt(el, 'pICMS', d.pICMS);
            this.addOpt(el, 'vICMSOp', d.vICMSOp);
            this.addOpt(el, 'pDif', d.pDif);
            this.addOpt(el, 'vICMSDif', d.vICMSDif);
            this.addOpt(el, 'vICMS', d.vICMS);
            el.up();
        } else if ('ICMS90' in icms) {
            const d = icms.ICMS90;
            const el = icmsEl.ele('ICMS90');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            this.addOpt(el, 'modBC', d.modBC);
            this.addOpt(el, 'vBC', d.vBC);
            this.addOpt(el, 'pRedBC', d.pRedBC);
            this.addOpt(el, 'pICMS', d.pICMS);
            this.addOpt(el, 'vICMS', d.vICMS);
            this.addOpt(el, 'modBCST', d.modBCST);
            this.addOpt(el, 'pMVAST', d.pMVAST);
            this.addOpt(el, 'pRedBCST', d.pRedBCST);
            this.addOpt(el, 'vBCST', d.vBCST);
            this.addOpt(el, 'pICMSST', d.pICMSST);
            this.addOpt(el, 'vICMSST', d.vICMSST);
            el.up();
        } else if ('ICMSSN101' in icms) {
            const d = icms.ICMSSN101;
            const el = icmsEl.ele('ICMSSN101');
            el.ele('orig').txt(d.orig).up();
            el.ele('CSOSN').txt(d.CSOSN).up();
            el.ele('pCredSN').txt(d.pCredSN).up();
            el.ele('vCredICMSSN').txt(d.vCredICMSSN).up();
            el.up();
        } else if ('ICMSSN202' in icms) {
            const d = icms.ICMSSN202;
            const el = icmsEl.ele('ICMSSN202');
            el.ele('orig').txt(d.orig).up();
            el.ele('CSOSN').txt(d.CSOSN).up();
            el.ele('modBCST').txt(d.modBCST).up();
            this.addOpt(el, 'pMVAST', d.pMVAST);
            this.addOpt(el, 'pRedBCST', d.pRedBCST);
            el.ele('vBCST').txt(d.vBCST).up();
            el.ele('pICMSST').txt(d.pICMSST).up();
            el.ele('vICMSST').txt(d.vICMSST).up();
            el.up();
        } else if ('ICMSSN900' in icms) {
            const d = icms.ICMSSN900;
            const el = icmsEl.ele('ICMSSN900');
            el.ele('orig').txt(d.orig).up();
            el.ele('CSOSN').txt(d.CSOSN).up();
            this.addOpt(el, 'modBC', d.modBC);
            this.addOpt(el, 'vBC', d.vBC);
            this.addOpt(el, 'pRedBC', d.pRedBC);
            this.addOpt(el, 'pICMS', d.pICMS);
            this.addOpt(el, 'vICMS', d.vICMS);
            this.addOpt(el, 'modBCST', d.modBCST);
            this.addOpt(el, 'pMVAST', d.pMVAST);
            this.addOpt(el, 'pRedBCST', d.pRedBCST);
            this.addOpt(el, 'vBCST', d.vBCST);
            this.addOpt(el, 'pICMSST', d.pICMSST);
            this.addOpt(el, 'vICMSST', d.vICMSST);
            this.addOpt(el, 'pCredSN', d.pCredSN);
            this.addOpt(el, 'vCredICMSSN', d.vCredICMSSN);
            el.up();
        } else if ('ICMS02' in icms) {
            const d = icms.ICMS02;
            const el = icmsEl.ele('ICMS02');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            this.addOpt(el, 'qBCMono', d.qBCMono);
            el.ele('adRemICMS').txt(d.adRemICMS).up();
            el.ele('vICMSMono').txt(d.vICMSMono).up();
            el.up();
        } else if ('ICMS15' in icms) {
            const d = icms.ICMS15;
            const el = icmsEl.ele('ICMS15');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            this.addOpt(el, 'qBCMono', d.qBCMono);
            el.ele('adRemICMS').txt(d.adRemICMS).up();
            el.ele('vICMSMono').txt(d.vICMSMono).up();
            this.addOpt(el, 'qBCMonoReten', d.qBCMonoReten);
            el.ele('adRemICMSReten').txt(d.adRemICMSReten).up();
            el.ele('vICMSMonoReten').txt(d.vICMSMonoReten).up();
            this.addOpt(el, 'pRedAdRem', d.pRedAdRem);
            this.addOpt(el, 'motRedAdRem', d.motRedAdRem);
            el.up();
        } else if ('ICMS53' in icms) {
            const d = icms.ICMS53;
            const el = icmsEl.ele('ICMS53');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            this.addOpt(el, 'qBCMono', d.qBCMono);
            this.addOpt(el, 'adRemICMS', d.adRemICMS);
            this.addOpt(el, 'vICMSMonoOp', d.vICMSMonoOp);
            this.addOpt(el, 'pDif', d.pDif);
            this.addOpt(el, 'vICMSMonoDif', d.vICMSMonoDif);
            this.addOpt(el, 'vICMSMono', d.vICMSMono);
            el.up();
        } else if ('ICMS61' in icms) {
            const d = icms.ICMS61;
            const el = icmsEl.ele('ICMS61');
            el.ele('orig').txt(d.orig).up();
            el.ele('CST').txt(d.CST).up();
            this.addOpt(el, 'qBCMonoRet', d.qBCMonoRet);
            el.ele('adRemICMSRet').txt(d.adRemICMSRet).up();
            el.ele('vICMSMonoRet').txt(d.vICMSMonoRet).up();
            el.up();
        } else if ('ICMS00' in icms) {
            const el = icmsEl.ele('ICMS00');
            el.ele('orig').txt(icms.ICMS00.orig).up();
            el.ele('CST').txt(icms.ICMS00.CST).up();
            el.ele('modBC').txt(icms.ICMS00.modBC).up();
            el.ele('vBC').txt(icms.ICMS00.vBC).up();
            el.ele('pICMS').txt(icms.ICMS00.pICMS).up();
            el.ele('vICMS').txt(icms.ICMS00.vICMS).up();
            this.addOpt(el, 'pFCP', icms.ICMS00.pFCP);
            this.addOpt(el, 'vFCP', icms.ICMS00.vFCP);
            el.up();
        } else if ('ICMS10' in icms) {
            const el = icmsEl.ele('ICMS10');
            el.ele('orig').txt(icms.ICMS10.orig).up();
            el.ele('CST').txt(icms.ICMS10.CST).up();
            el.ele('modBC').txt(icms.ICMS10.modBC).up();
            el.ele('vBC').txt(icms.ICMS10.vBC).up();
            el.ele('pICMS').txt(icms.ICMS10.pICMS).up();
            el.ele('vICMS').txt(icms.ICMS10.vICMS).up();
            el.ele('modBCST').txt(icms.ICMS10.modBCST).up();
            this.addOpt(el, 'pMVAST', icms.ICMS10.pMVAST);
            this.addOpt(el, 'pRedBCST', icms.ICMS10.pRedBCST);
            el.ele('vBCST').txt(icms.ICMS10.vBCST).up();
            el.ele('pICMSST').txt(icms.ICMS10.pICMSST).up();
            el.ele('vICMSST').txt(icms.ICMS10.vICMSST).up();
            el.up();
        } else if ('ICMS20' in icms) {
            const el = icmsEl.ele('ICMS20');
            el.ele('orig').txt(icms.ICMS20.orig).up();
            el.ele('CST').txt(icms.ICMS20.CST).up();
            el.ele('modBC').txt(icms.ICMS20.modBC).up();
            el.ele('pRedBC').txt(icms.ICMS20.pRedBC).up();
            el.ele('vBC').txt(icms.ICMS20.vBC).up();
            el.ele('pICMS').txt(icms.ICMS20.pICMS).up();
            el.ele('vICMS').txt(icms.ICMS20.vICMS).up();
            this.addOpt(el, 'vICMSDeson', icms.ICMS20.vICMSDeson);
            this.addOpt(el, 'motDesICMS', icms.ICMS20.motDesICMS);
            el.up();
        } else if ('ICMS40' in icms) {
            const el = icmsEl.ele('ICMS40');
            el.ele('orig').txt(icms.ICMS40.orig).up();
            el.ele('CST').txt(icms.ICMS40.CST).up();
            this.addOpt(el, 'vICMSDeson', icms.ICMS40.vICMSDeson);
            this.addOpt(el, 'motDesICMS', icms.ICMS40.motDesICMS);
            el.up();
        } else if ('ICMS60' in icms) {
            const el = icmsEl.ele('ICMS60');
            el.ele('orig').txt(icms.ICMS60.orig).up();
            el.ele('CST').txt(icms.ICMS60.CST).up();
            this.addOpt(el, 'vBCSTRet', icms.ICMS60.vBCSTRet);
            this.addOpt(el, 'vICMSSTRet', icms.ICMS60.vICMSSTRet);
            this.addOpt(el, 'vICMSSubstituto', icms.ICMS60.vICMSSubstituto);
            el.up();
        } else if ('ICMS70' in icms) {
            const el = icmsEl.ele('ICMS70');
            el.ele('orig').txt(icms.ICMS70.orig).up();
            el.ele('CST').txt(icms.ICMS70.CST).up();
            el.ele('modBC').txt(icms.ICMS70.modBC).up();
            el.ele('pRedBC').txt(icms.ICMS70.pRedBC).up();
            el.ele('vBC').txt(icms.ICMS70.vBC).up();
            el.ele('pICMS').txt(icms.ICMS70.pICMS).up();
            el.ele('vICMS').txt(icms.ICMS70.vICMS).up();
            el.ele('modBCST').txt(icms.ICMS70.modBCST).up();
            this.addOpt(el, 'pMVAST', icms.ICMS70.pMVAST);
            this.addOpt(el, 'pRedBCST', icms.ICMS70.pRedBCST);
            el.ele('vBCST').txt(icms.ICMS70.vBCST).up();
            el.ele('pICMSST').txt(icms.ICMS70.pICMSST).up();
            el.ele('vICMSST').txt(icms.ICMS70.vICMSST).up();
            this.addOpt(el, 'vICMSDeson', icms.ICMS70.vICMSDeson);
            this.addOpt(el, 'motDesICMS', icms.ICMS70.motDesICMS);
            el.up();
        } else if ('ICMSSN102' in icms) {
            const el = icmsEl.ele('ICMSSN102');
            el.ele('orig').txt(icms.ICMSSN102.orig).up();
            el.ele('CSOSN').txt(icms.ICMSSN102.CSOSN).up();
            el.up();
        } else if ('ICMSSN201' in icms) {
            const el = icmsEl.ele('ICMSSN201');
            el.ele('orig').txt(icms.ICMSSN201.orig).up();
            el.ele('CSOSN').txt(icms.ICMSSN201.CSOSN).up();
            el.ele('modBCST').txt(icms.ICMSSN201.modBCST).up();
            this.addOpt(el, 'pMVAST', icms.ICMSSN201.pMVAST);
            this.addOpt(el, 'pRedBCST', icms.ICMSSN201.pRedBCST);
            el.ele('vBCST').txt(icms.ICMSSN201.vBCST).up();
            el.ele('pICMSST').txt(icms.ICMSSN201.pICMSST).up();
            el.ele('vICMSST').txt(icms.ICMSSN201.vICMSST).up();
            this.addOpt(el, 'pCredSN', icms.ICMSSN201.pCredSN);
            this.addOpt(el, 'vCredICMSSN', icms.ICMSSN201.vCredICMSSN);
            el.up();
        } else if ('ICMSSN500' in icms) {
            const el = icmsEl.ele('ICMSSN500');
            el.ele('orig').txt(icms.ICMSSN500.orig).up();
            el.ele('CSOSN').txt(icms.ICMSSN500.CSOSN).up();
            this.addOpt(el, 'vBCSTRet', icms.ICMSSN500.vBCSTRet);
            this.addOpt(el, 'vICMSSTRet', icms.ICMSSN500.vICMSSTRet);
            el.up();
        }

        icmsEl.up();
    }

    private addICMSUFDest(parent: any, d: ICMSUFDest_Props): void {
        const el = parent.ele('ICMSUFDest');
        el.ele('vBCUFDest').txt(d.vBCUFDest).up();
        this.addOpt(el, 'vBCFCPUFDest', d.vBCFCPUFDest);
        this.addOpt(el, 'pFCPUFDest', d.pFCPUFDest);
        el.ele('pICMSUFDest').txt(d.pICMSUFDest).up();
        el.ele('pICMSInter').txt(d.pICMSInter).up();
        el.ele('pICMSInterPart').txt(d.pICMSInterPart).up();
        this.addOpt(el, 'vFCPUFDest', d.vFCPUFDest);
        el.ele('vICMSUFDest').txt(d.vICMSUFDest).up();
        el.ele('vICMSUFRemet').txt(d.vICMSUFRemet).up();
        el.up();
    }

    /**
     * Serializes IPI discriminated union into an <IPI> element.
     */
    private addIPI(parent: any, ipi: TipoIPI): void {
        const ipiEl = parent.ele('IPI');

        if ('IPITrib' in ipi) {
            ipiEl.ele('cEnq').txt(ipi.IPITrib.cEnq).up();
            const el = ipiEl.ele('IPITrib');
            el.ele('CST').txt(ipi.IPITrib.CST).up();
            this.addOpt(el, 'vBC', ipi.IPITrib.vBC);
            this.addOpt(el, 'pIPI', ipi.IPITrib.pIPI);
            this.addOpt(el, 'vIPI', ipi.IPITrib.vIPI);
            el.up();
        } else if ('IPINT' in ipi) {
            ipiEl.ele('cEnq').txt(ipi.IPINT.cEnq).up();
            const el = ipiEl.ele('IPINT');
            el.ele('CST').txt(ipi.IPINT.CST).up();
            el.up();
        }

        ipiEl.up();
    }

    /**
     * Serializes PIS discriminated union into a <PIS> element.
     */
    private addPIS(parent: any, pis: TipoPIS): void {
        const pisEl = parent.ele('PIS');

        if ('PISAliq' in pis) {
            const el = pisEl.ele('PISAliq');
            el.ele('CST').txt(pis.PISAliq.CST).up();
            el.ele('vBC').txt(pis.PISAliq.vBC).up();
            el.ele('pPIS').txt(pis.PISAliq.pPIS).up();
            el.ele('vPIS').txt(pis.PISAliq.vPIS).up();
            el.up();
        } else if ('PISNT' in pis) {
            // Não tributado: o grupo carrega apenas o CST.
            const el = pisEl.ele('PISNT');
            el.ele('CST').txt(pis.PISNT.CST).up();
            el.up();
        } else if ('PISOutr' in pis) {
            const el = pisEl.ele('PISOutr');
            el.ele('CST').txt(pis.PISOutr.CST).up();
            this.addOpt(el, 'vBC', pis.PISOutr.vBC);
            this.addOpt(el, 'pPIS', pis.PISOutr.pPIS);
            this.addOpt(el, 'vPIS', pis.PISOutr.vPIS);
            el.up();
        }

        pisEl.up();
    }

    /**
     * Grupo UB (IBS/CBS) do item — Reforma Tributaria, NT 2025.002.
     * Ordem dos elementos segue TCIBS_NFe do XSD: vBC, gIBSUF, gIBSMun, vIBS, gCBS.
     * Trocar a ordem faz a SEFAZ rejeitar por erro de schema (cStat 225).
     */
    private addIBSCBS(parent: any, ibscbs: ImpostoIBSCBS): void {
        const el = parent.ele('IBSCBS');
        el.ele('CST').txt(ibscbs.CST).up();
        el.ele('cClassTrib').txt(ibscbs.cClassTrib).up();

        const g = el.ele('gIBSCBS');
        g.ele('vBC').txt(ibscbs.gIBSCBS.vBC).up();

        const gUF = g.ele('gIBSUF');
        gUF.ele('pIBSUF').txt(ibscbs.gIBSCBS.gIBSUF.pIBSUF).up();
        this.addRedIbsCbs(gUF, ibscbs.gIBSCBS.gIBSUF.gRed);
        gUF.ele('vIBSUF').txt(ibscbs.gIBSCBS.gIBSUF.vIBSUF).up();
        gUF.up();

        const gMun = g.ele('gIBSMun');
        gMun.ele('pIBSMun').txt(ibscbs.gIBSCBS.gIBSMun.pIBSMun).up();
        this.addRedIbsCbs(gMun, ibscbs.gIBSCBS.gIBSMun.gRed);
        gMun.ele('vIBSMun').txt(ibscbs.gIBSCBS.gIBSMun.vIBSMun).up();
        gMun.up();

        g.ele('vIBS').txt(ibscbs.gIBSCBS.vIBS).up();

        const gCBS = g.ele('gCBS');
        gCBS.ele('pCBS').txt(ibscbs.gIBSCBS.gCBS.pCBS).up();
        this.addRedIbsCbs(gCBS, ibscbs.gIBSCBS.gCBS.gRed);
        gCBS.ele('vCBS').txt(ibscbs.gIBSCBS.gCBS.vCBS).up();
        gCBS.up();

        g.up();
        el.up();
    }

    /**
     * Grupo gRed (TRed) — a redução de alíquota do cClassTrib.
     *
     * Vai entre a alíquota e o valor dentro de gIBSUF/gIBSMun/gCBS; é essa a
     * posição do XSD, e ela não é intuitiva (o natural seria depois do valor).
     */
    private addRedIbsCbs(parent: any, gRed: RedIbsCbs | undefined): void {
        if (!gRed) return;
        const el = parent.ele('gRed');
        el.ele('pRedAliq').txt(gRed.pRedAliq).up();
        el.ele('pAliqEfet').txt(gRed.pAliqEfet).up();
        el.up();
    }

    /**
     * Serializes COFINS discriminated union into a <COFINS> element.
     */
    private addCOFINS(parent: any, cofins: TipoCOFINS): void {
        const cofinsEl = parent.ele('COFINS');

        if ('COFINSAliq' in cofins) {
            const el = cofinsEl.ele('COFINSAliq');
            el.ele('CST').txt(cofins.COFINSAliq.CST).up();
            el.ele('vBC').txt(cofins.COFINSAliq.vBC).up();
            el.ele('pCOFINS').txt(cofins.COFINSAliq.pCOFINS).up();
            el.ele('vCOFINS').txt(cofins.COFINSAliq.vCOFINS).up();
            el.up();
        } else if ('COFINSNT' in cofins) {
            // Não tributado: o grupo carrega apenas o CST.
            const el = cofinsEl.ele('COFINSNT');
            el.ele('CST').txt(cofins.COFINSNT.CST).up();
            el.up();
        } else if ('COFINSOutr' in cofins) {
            const el = cofinsEl.ele('COFINSOutr');
            el.ele('CST').txt(cofins.COFINSOutr.CST).up();
            this.addOpt(el, 'vBC', cofins.COFINSOutr.vBC);
            this.addOpt(el, 'pCOFINS', cofins.COFINSOutr.pCOFINS);
            this.addOpt(el, 'vCOFINS', cofins.COFINSOutr.vCOFINS);
            el.up();
        }

        cofinsEl.up();
    }

    /**
     * Serializes a single <det> item element.
     */
    private addDetalheItem(parent: any, item: DetalheItem): void {
        const det = parent.ele('det', { nItem: item.nItem });

        // <prod>
        const prod = det.ele('prod');
        prod.ele('cProd').txt(item.prod.cProd).up();
        prod.ele('cEAN').txt(item.prod.cEAN).up();
        prod.ele('xProd').txt(item.prod.xProd).up();
        prod.ele('NCM').txt(item.prod.NCM).up();
        this.addOpt(prod, 'CEST', item.prod.CEST);
        // Depois do CEST é onde o leiaute põe o cBenef — não dentro do ICMS.
        this.addOpt(prod, 'cBenef', item.prod.cBenef);
        prod.ele('CFOP').txt(item.prod.CFOP).up();
        prod.ele('uCom').txt(item.prod.uCom).up();
        prod.ele('qCom').txt(item.prod.qCom).up();
        prod.ele('vUnCom').txt(item.prod.vUnCom).up();
        prod.ele('vProd').txt(item.prod.vProd).up();
        prod.ele('cEANTrib').txt(item.prod.cEANTrib).up();
        prod.ele('uTrib').txt(item.prod.uTrib).up();
        prod.ele('qTrib').txt(item.prod.qTrib).up();
        prod.ele('vUnTrib').txt(item.prod.vUnTrib).up();
        this.addOpt(prod, 'vFrete', item.prod.vFrete);
        this.addOpt(prod, 'vSeg', item.prod.vSeg);
        this.addOpt(prod, 'vDesc', item.prod.vDesc);
        this.addOpt(prod, 'vOutro', item.prod.vOutro);
        prod.ele('indTot').txt(item.prod.indTot).up();
        prod.up();

        // <imposto>
        const imposto = det.ele('imposto');
        this.addOpt(imposto, 'vTotTrib', item.imposto.vTotTrib);

        // Ordem exigida pelo XSD (TImposto): ICMS -> IPI -> PIS -> COFINS -> ICMSUFDest
        if (item.imposto.ICMS) {
            this.addICMS(imposto, item.imposto.ICMS);
        }
        if (item.imposto.IPI) {
            this.addIPI(imposto, item.imposto.IPI);
        }
        if (item.imposto.PIS) {
            this.addPIS(imposto, item.imposto.PIS);
        }
        if (item.imposto.COFINS) {
            this.addCOFINS(imposto, item.imposto.COFINS);
        }
        if (item.imposto.ICMSUFDest) {
            this.addICMSUFDest(imposto, item.imposto.ICMSUFDest);
        }
        // Reforma Tributaria (NT 2025.002): grupo UB.
        //
        // A rejeicao 1115 ("IBS/CBS nao informado", regra UB12-10) chegou a ser
        // marcada para 03/08/2026, mas o Ato Tecnico Conjunto RFB/CGIBS 1/2026
        // adiou as validacoes e a NT 2025.002 v1.51 passou a regra para
        // "implementacao futura". Hoje a ausencia do grupo nao rejeita.
        //
        // O que importa agora e o inverso: grupo INFORMADO atrai todas as regras
        // de validacao dele. Preencher errado rejeita; nao preencher, nao.
        if (item.imposto.IBSCBS) {
            this.addIBSCBS(imposto, item.imposto.IBSCBS);
        }
        imposto.up();

        // <infAdProd>
        this.addOpt(det, 'infAdProd', item.infAdProd);

        // <DFeReferenciado> — último elemento do det, conforme o XSD.
        // Na devolução a SEFAZ exige a referência por item, não só o NFref do
        // cabeçalho: sem isto a nota volta com rejeição 321.
        if (item.DFeReferenciado?.chaveAcesso) {
            const ref = det.ele('DFeReferenciado');
            ref.ele('chaveAcesso').txt(item.DFeReferenciado.chaveAcesso).up();
            this.addOpt(ref, 'nItem', item.DFeReferenciado.nItem);
            ref.up();
        }

        det.up();
    }

    /**
     * Generates the <NFe><infNFe>...</infNFe></NFe> XML string for the given NFe object.
     * Output is compact (no pretty printing) for signing purposes.
     *
     * @param nfe - The NFe domain object
     * @param chaveAcesso - The 44-digit access key
     * @returns Compact XML string with no XML declaration
     */
    generateInfNFe(nfe: NFe, chaveAcesso: string): string {
        const doc = create()
            .ele(SEFAZ_NS, 'NFe');

        const infNFe = doc.ele('infNFe', { versao: '4.00', Id: `NFe${chaveAcesso}` });

        // === <ide> ===
        const ide = infNFe.ele('ide');
        ide.ele('cUF').txt(nfe.ide.cUF).up();
        ide.ele('cNF').txt(nfe.ide.cNF).up();
        ide.ele('natOp').txt(nfe.ide.natOp).up();
        ide.ele('mod').txt(nfe.ide.mod).up();
        ide.ele('serie').txt(nfe.ide.serie).up();
        ide.ele('nNF').txt(nfe.ide.nNF).up();
        ide.ele('dhEmi').txt(nfe.ide.dhEmi).up();
        this.addOpt(ide, 'dhSaiEnt', nfe.ide.dhSaiEnt);
        ide.ele('tpNF').txt(nfe.ide.tpNF).up();
        ide.ele('idDest').txt(nfe.ide.idDest).up();
        ide.ele('cMunFG').txt(nfe.ide.cMunFG).up();
        ide.ele('tpImp').txt(nfe.ide.tpImp).up();
        ide.ele('tpEmis').txt(nfe.ide.tpEmis).up();
        ide.ele('cDV').txt(nfe.ide.cDV).up();
        ide.ele('tpAmb').txt(nfe.ide.tpAmb).up();
        ide.ele('finNFe').txt(nfe.ide.finNFe).up();
        ide.ele('indFinal').txt(nfe.ide.indFinal).up();
        ide.ele('indPres').txt(nfe.ide.indPres).up();
        ide.ele('procEmi').txt(nfe.ide.procEmi).up();
        ide.ele('verProc').txt(nfe.ide.verProc).up();
        // Notas referenciadas — um grupo NFref por chave.
        // Posição conforme o XSD desta versão: no FIM do ide, depois de verProc
        // (o layout 4.00 clássico trazia NFref logo após cMunFG; a atualização da
        // Reforma moveu para cá). Emitir na posição antiga rejeita com cStat 225.
        if (nfe.ide.NFref?.length) {
            for (const chave of nfe.ide.NFref) {
                const ref = ide.ele('NFref');
                ref.ele('refNFe').txt(chave).up();
                ref.up();
            }
        }
        ide.up();

        // === <emit> ===
        const emit = infNFe.ele('emit');
        if (nfe.emit.CNPJ) {
            emit.ele('CNPJ').txt(nfe.emit.CNPJ).up();
        } else if (nfe.emit.CPF) {
            emit.ele('CPF').txt(nfe.emit.CPF).up();
        }
        emit.ele('xNome').txt(nfe.emit.xNome).up();
        this.addOpt(emit, 'xFant', nfe.emit.xFant);

        const enderEmit = emit.ele('enderEmit');
        this.addEndereco(enderEmit, nfe.emit.enderEmit);
        enderEmit.up();

        emit.ele('IE').txt(nfe.emit.IE).up();
        emit.ele('CRT').txt(nfe.emit.CRT).up();
        emit.up();

        // === <dest> ===
        const isNFCe = nfe.ide.mod === '65';
        const hasDest = nfe.dest.CNPJ || nfe.dest.CPF || nfe.dest.idEstrangeiro || nfe.dest.xNome;
        if (!isNFCe || hasDest) {
            const dest = infNFe.ele('dest');
            if (nfe.dest.CNPJ) {
                dest.ele('CNPJ').txt(nfe.dest.CNPJ).up();
            } else if (nfe.dest.CPF) {
                dest.ele('CPF').txt(nfe.dest.CPF).up();
            } else if (nfe.dest.idEstrangeiro) {
                dest.ele('idEstrangeiro').txt(nfe.dest.idEstrangeiro).up();
            }
            if (nfe.dest.xNome) dest.ele('xNome').txt(nfe.dest.xNome).up();

            if (!isNFCe && nfe.dest.enderDest) {
                const enderDest = dest.ele('enderDest');
                this.addEndereco(enderDest, nfe.dest.enderDest);
                enderDest.up();
            }

            dest.ele('indIEDest').txt(nfe.dest.indIEDest).up();
            this.addOpt(dest, 'IE', nfe.dest.IE);
            this.addOpt(dest, 'email', nfe.dest.email);
            dest.up();
        }

        // === <det> (items) ===
        for (const item of nfe.det) {
            this.addDetalheItem(infNFe, item);
        }

        // === <total> ===
        const total = infNFe.ele('total');
        const icmsTot = total.ele('ICMSTot');
        icmsTot.ele('vBC').txt(nfe.total.ICMSTot.vBC).up();
        icmsTot.ele('vICMS').txt(nfe.total.ICMSTot.vICMS).up();
        icmsTot.ele('vICMSDeson').txt(nfe.total.ICMSTot.vICMSDeson).up();
        this.addOpt(icmsTot, 'vFCPUFDest', nfe.total.ICMSTot.vFCPUFDest);
        this.addOpt(icmsTot, 'vICMSUFDest', nfe.total.ICMSTot.vICMSUFDest);
        this.addOpt(icmsTot, 'vICMSUFRemet', nfe.total.ICMSTot.vICMSUFRemet);
        icmsTot.ele('vFCP').txt(nfe.total.ICMSTot.vFCP).up();
        icmsTot.ele('vBCST').txt(nfe.total.ICMSTot.vBCST).up();
        icmsTot.ele('vST').txt(nfe.total.ICMSTot.vST).up();
        icmsTot.ele('vFCPST').txt(nfe.total.ICMSTot.vFCPST).up();
        icmsTot.ele('vFCPSTRet').txt(nfe.total.ICMSTot.vFCPSTRet).up();
        icmsTot.ele('vProd').txt(nfe.total.ICMSTot.vProd).up();
        icmsTot.ele('vFrete').txt(nfe.total.ICMSTot.vFrete).up();
        icmsTot.ele('vSeg').txt(nfe.total.ICMSTot.vSeg).up();
        icmsTot.ele('vDesc').txt(nfe.total.ICMSTot.vDesc).up();
        icmsTot.ele('vII').txt(nfe.total.ICMSTot.vII).up();
        icmsTot.ele('vIPI').txt(nfe.total.ICMSTot.vIPI).up();
        icmsTot.ele('vIPIDevol').txt(nfe.total.ICMSTot.vIPIDevol).up();
        icmsTot.ele('vPIS').txt(nfe.total.ICMSTot.vPIS).up();
        icmsTot.ele('vCOFINS').txt(nfe.total.ICMSTot.vCOFINS).up();
        icmsTot.ele('vOutro').txt(nfe.total.ICMSTot.vOutro).up();
        icmsTot.ele('vNF').txt(nfe.total.ICMSTot.vNF).up();
        // vTotTrib fecha o ICMSTot. É o que alimenta o quadro "V. TOT. TRIB."
        // do DANFE, que sem ele imprime R$ 0,00.
        this.addOpt(icmsTot, 'vTotTrib', nfe.total.ICMSTot.vTotTrib);
        icmsTot.up();

        // Totais IBS/CBS (grupo W03) — acompanham o grupo UB dos itens.
        if (nfe.total.IBSCBSTot) {
            const t = nfe.total.IBSCBSTot;
            const tot = total.ele('IBSCBSTot');
            tot.ele('vBCIBSCBS').txt(t.vBCIBSCBS).up();

            const gIBS = tot.ele('gIBS');
            const tUF = gIBS.ele('gIBSUF');
            tUF.ele('vDif').txt(t.gIBS.gIBSUF.vDif).up();
            tUF.ele('vDevTrib').txt(t.gIBS.gIBSUF.vDevTrib).up();
            tUF.ele('vIBSUF').txt(t.gIBS.gIBSUF.vIBSUF).up();
            tUF.up();

            const tMun = gIBS.ele('gIBSMun');
            tMun.ele('vDif').txt(t.gIBS.gIBSMun.vDif).up();
            tMun.ele('vDevTrib').txt(t.gIBS.gIBSMun.vDevTrib).up();
            tMun.ele('vIBSMun').txt(t.gIBS.gIBSMun.vIBSMun).up();
            tMun.up();

            gIBS.ele('vIBS').txt(t.gIBS.vIBS).up();
            gIBS.ele('vCredPres').txt(t.gIBS.vCredPres).up();
            gIBS.ele('vCredPresCondSus').txt(t.gIBS.vCredPresCondSus).up();
            gIBS.up();

            const gCBS = tot.ele('gCBS');
            gCBS.ele('vDif').txt(t.gCBS.vDif).up();
            gCBS.ele('vDevTrib').txt(t.gCBS.vDevTrib).up();
            gCBS.ele('vCBS').txt(t.gCBS.vCBS).up();
            gCBS.ele('vCredPres').txt(t.gCBS.vCredPres).up();
            gCBS.ele('vCredPresCondSus').txt(t.gCBS.vCredPresCondSus).up();
            gCBS.up();

            tot.up();
        }
        total.up();

        // === <transp> ===
        const transp = infNFe.ele('transp');
        transp.ele('modFrete').txt(nfe.transp.modFrete).up();

        if (!isNFCe && nfe.transp.transporta) {
            const transporta = transp.ele('transporta');
            this.addOpt(transporta, 'CNPJ', nfe.transp.transporta.CNPJ);
            this.addOpt(transporta, 'CPF', nfe.transp.transporta.CPF);
            transporta.ele('xNome').txt(nfe.transp.transporta.xNome).up();
            this.addOpt(transporta, 'IE', nfe.transp.transporta.IE);
            transporta.ele('xEnder').txt(nfe.transp.transporta.xEnder).up();
            transporta.ele('xMun').txt(nfe.transp.transporta.xMun).up();
            transporta.ele('UF').txt(nfe.transp.transporta.UF).up();
            transporta.up();
        }

        if (!isNFCe && nfe.transp.veicTransp) {
            const veic = transp.ele('veicTransp');
            veic.ele('placa').txt(nfe.transp.veicTransp.placa).up();
            veic.ele('UF').txt(nfe.transp.veicTransp.UF).up();
            this.addOpt(veic, 'RNTRC', nfe.transp.veicTransp.RNTRC);
            veic.up();
        }

        if (!isNFCe && nfe.transp.vol && nfe.transp.vol.length > 0) {
            for (const v of nfe.transp.vol) {
                const vol = transp.ele('vol');
                this.addOpt(vol, 'qVol', v.qVol);
                this.addOpt(vol, 'esp', v.esp);
                this.addOpt(vol, 'marca', v.marca);
                this.addOpt(vol, 'nVol', v.nVol);
                this.addOpt(vol, 'pesoL', v.pesoL);
                this.addOpt(vol, 'pesoB', v.pesoB);
                vol.up();
            }
        }
        transp.up();

        // === <cobr> ===
        if (nfe.cobr) {
            const cobr = infNFe.ele('cobr');

            if (nfe.cobr.fat) {
                const fat = cobr.ele('fat');
                fat.ele('nFat').txt(nfe.cobr.fat.nFat).up();
                fat.ele('vOrig').txt(nfe.cobr.fat.vOrig).up();
                fat.ele('vDesc').txt(nfe.cobr.fat.vDesc).up();
                fat.ele('vLiq').txt(nfe.cobr.fat.vLiq).up();
                fat.up();
            }

            if (nfe.cobr.dup && nfe.cobr.dup.length > 0) {
                for (const d of nfe.cobr.dup) {
                    const dup = cobr.ele('dup');
                    dup.ele('nDup').txt(d.nDup).up();
                    dup.ele('dVenc').txt(d.dVenc).up();
                    dup.ele('vDup').txt(d.vDup).up();
                    dup.up();
                }
            }

            cobr.up();
        }

        // === <pag> ===
        const pag = infNFe.ele('pag');
        for (const dp of nfe.pag.detPag) {
            const detPag = pag.ele('detPag');
            this.addOpt(detPag, 'indPag', dp.indPag);
            detPag.ele('tPag').txt(dp.tPag).up();
            detPag.ele('vPag').txt(dp.vPag).up();

            // Dados do cartão vão dentro de <card>, não soltos no detPag.
            // A SEFAZ exige o grupo quando tPag é 03 (crédito) ou 04 (débito) —
            // sem ele, rejeição 391. tpIntegra é o único campo obrigatório:
            // '1' = integrado a TEF/POS, '2' = não integrado (digitação manual).
            const ehCartao = dp.tPag === '03' || dp.tPag === '04';
            if (ehCartao || dp.tpIntegra || dp.CNPJ || dp.tBand || dp.cAut) {
                const card = detPag.ele('card');
                card.ele('tpIntegra').txt(dp.tpIntegra ?? '2').up();
                this.addOpt(card, 'CNPJ', dp.CNPJ);
                this.addOpt(card, 'tBand', dp.tBand);
                this.addOpt(card, 'cAut', dp.cAut);
                card.up();
            }
            detPag.up();
        }
        this.addOpt(pag, 'vTroco', nfe.pag.vTroco);
        pag.up();

        // === <infAdic> ===
        if (nfe.infAdic) {
            const infAdic = infNFe.ele('infAdic');
            this.addOpt(infAdic, 'infAdFisco', nfe.infAdic.infAdFisco);
            this.addOpt(infAdic, 'infCpl', nfe.infAdic.infCpl);
            infAdic.up();
        }

        // === <infRespTec> ===
        if (nfe.infRespTec) {
            const irt = infNFe.ele('infRespTec');
            irt.ele('CNPJ').txt(nfe.infRespTec.CNPJ).up();
            irt.ele('xContato').txt(nfe.infRespTec.xContato).up();
            irt.ele('email').txt(nfe.infRespTec.email).up();
            irt.ele('fone').txt(nfe.infRespTec.fone).up();
            this.addOpt(irt, 'idCSRT', nfe.infRespTec.idCSRT);
            this.addOpt(irt, 'hashCSRT', nfe.infRespTec.hashCSRT);
            irt.up();
        }

        infNFe.up(); // close infNFe

        // NFC-e: infNFeSupl (QR Code + URL chave) — dentro de <NFe>, após </infNFe>
        if (isNFCe && nfe.infNFeSupl) {
            const supl = doc.ele('infNFeSupl');
            supl.ele('qrCode').txt(nfe.infNFeSupl.qrCode).up();
            supl.ele('urlChave').txt(nfe.infNFeSupl.urlChave).up();
            supl.up();
        }

        return doc.end({ prettyPrint: false, headless: true });
    }

    /**
     * Wraps a signed NFe XML string inside the SEFAZ transmission envelope.
     *
     * @param nfeXml - The signed NFe XML string (or unsigned, for testing)
     * @param idLote - The batch identifier
     * @returns Complete envelope XML with XML declaration
     */
    wrapEnvelope(nfeXml: string, idLote: string): string {
        return `<enviNFe xmlns="${SEFAZ_NS}" versao="4.00">`
            + `<idLote>${idLote}</idLote>`
            + '<indSinc>1</indSinc>'
            + nfeXml
            + '</enviNFe>';
    }
}
