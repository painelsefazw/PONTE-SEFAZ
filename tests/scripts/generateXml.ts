import * as fs from 'fs';
import * as path from 'path';
import { XmlGenerator } from '../../src/infrastructure/xml/XmlGenerator';
import { generateAccessKey } from '../../src/domain/NFeKeyGenerator';
import {
  NFe,
  TipoAmbiente,
  TipoEmissao,
  FinalidadeNFe,
  IndicadorPresenca,
  OrigemMercadoria,
} from '../../src/domain/models';

// ============================================================================
// Fixture: NF-e Simples Nacional, CSOSN 102, one item
// ============================================================================

const nfe: NFe = {
  ide: {
    cUF: '31',
    cNF: '00000001',
    natOp: 'VENDA DE MERCADORIA',
    mod: '55',
    serie: '1',
    nNF: '1',
    dhEmi: '2024-05-10T10:00:00-03:00',
    tpNF: '1',
    idDest: '1',
    cMunFG: '3106200',
    tpImp: '1',
    tpEmis: TipoEmissao.NORMAL,
    cDV: '0',
    tpAmb: TipoAmbiente.HOMOLOGACAO,
    finNFe: FinalidadeNFe.NORMAL,
    indFinal: '1',
    indPres: IndicadorPresenca.PRESENCIAL,
    procEmi: '0',
    verProc: '1.0.0',
  },
  emit: {
    CNPJ: '12345678000199',
    xNome: 'EMPRESA TESTE LTDA',
    xFant: 'TESTE',
    enderEmit: {
      xLgr: 'RUA TESTE',
      nro: '100',
      xBairro: 'CENTRO',
      cMun: '3106200',
      xMun: 'BELO HORIZONTE',
      UF: 'MG',
      CEP: '30130000',
      cPais: '1058',
      xPais: 'BRASIL',
      fone: '3132223333',
    },
    IE: '1234567890',
    CRT: '1',
  },
  dest: {
    CNPJ: '98765432000188',
    xNome: 'CLIENTE TESTE LTDA',
    enderDest: {
      xLgr: 'AV BRASIL',
      nro: '200',
      xBairro: 'SAVASSI',
      cMun: '3106200',
      xMun: 'BELO HORIZONTE',
      UF: 'MG',
      CEP: '30140071',
      cPais: '1058',
      xPais: 'BRASIL',
    },
    indIEDest: '1',
    IE: '0987654321',
    email: 'cliente@teste.com',
  },
  det: [
    {
      nItem: '1',
      prod: {
        cProd: '001',
        cEAN: 'SEM GTIN',
        xProd: 'NOTEBOOK DELL INSPIRON',
        NCM: '84715010',
        CFOP: '5102',
        uCom: 'UN',
        qCom: '1.0000',
        vUnCom: '100.00',
        vProd: '100.00',
        cEANTrib: 'SEM GTIN',
        uTrib: 'UN',
        qTrib: '1.0000',
        vUnTrib: '100.00',
        indTot: '1',
      },
      imposto: {
        vTotTrib: '18.00',
        ICMS: {
          ICMSSN102: {
            orig: OrigemMercadoria.NACIONAL,
            CSOSN: '102',
          },
        },
        PIS: {
          PISOutr: {
            CST: '99',
          },
        },
        COFINS: {
          COFINSOutr: {
            CST: '99',
          },
        },
      },
    },
  ],
  total: {
    ICMSTot: {
      vBC: '0.00',
      vICMS: '0.00',
      vICMSDeson: '0.00',
      vFCP: '0.00',
      vBCST: '0.00',
      vST: '0.00',
      vFCPST: '0.00',
      vFCPSTRet: '0.00',
      vProd: '100.00',
      vFrete: '0.00',
      vSeg: '0.00',
      vDesc: '0.00',
      vII: '0.00',
      vIPI: '0.00',
      vIPIDevol: '0.00',
      vPIS: '0.00',
      vCOFINS: '0.00',
      vOutro: '0.00',
      vNF: '100.00',
    },
  },
  transp: {
    modFrete: '9',
  },
  pag: {
    detPag: [
      {
        tPag: '01',
        vPag: '100.00',
      },
    ],
  },
  infAdic: {
    infCpl: 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL',
  },
};

// ============================================================================
// Generate access key
// ============================================================================

const { chave, cDV } = generateAccessKey({
  cUF: nfe.ide.cUF,
  dhEmi: nfe.ide.dhEmi,
  cnpj: nfe.emit.CNPJ || '',
  mod: nfe.ide.mod,
  serie: nfe.ide.serie,
  nNF: nfe.ide.nNF,
  tpEmis: nfe.ide.tpEmis,
  cNF: nfe.ide.cNF,
});

// Update cDV in the IDE
nfe.ide.cDV = cDV;

// ============================================================================
// Generate XML
// ============================================================================

const generator = new XmlGenerator();
const xml = generator.generateInfNFe(nfe, chave);

// ============================================================================
// Write to output/teste.xml
// ============================================================================

const outputDir = path.join(__dirname, '../../output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(path.join(outputDir, 'teste.xml'), xml, 'utf8');
console.log(`Chave de Acesso: ${chave}`);
console.log(`DV: ${cDV}`);
console.log('XML de teste gerado com sucesso em output/teste.xml');
