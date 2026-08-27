import * as fs from 'fs';
import * as path from 'path';

export interface ValidationError {
  line?: number;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Onde estão os .xsd, em qualquer um dos ambientes em que este código roda.
 *
 * No serverless o `process.cwd()` não é a raiz do projeto e o bundle reempacota
 * os arquivos: um caminho relativo único acerta em desenvolvimento e erra em
 * produção — desligando a validação exatamente onde ela mais importa, e em
 * silêncio, porque a falha é aberta.
 */
export function resolverSchemasDir(): string {
  const candidatos = [
    path.resolve(process.cwd(), 'schemas'),
    path.resolve(__dirname, 'schemas'),
    path.resolve(__dirname, '..', 'schemas'),
    path.resolve(__dirname, '..', '..', 'schemas'),
    path.resolve(__dirname, '..', '..', '..', 'schemas'),
    path.resolve(__dirname, '..', '..', '..', '..', 'schemas'),
    '/var/task/schemas',
  ];
  for (const dir of candidatos) {
    try {
      if (fs.existsSync(path.join(dir, 'nfe_v4.00.xsd'))) return dir;
    } catch { /* candidato inacessível, tenta o próximo */ }
  }
  return candidatos[0]!;
}

export class XsdValidator {
  private readonly schemasDir: string;
  private readonly available: boolean;

  constructor(schemasDir?: string) {
    this.schemasDir = schemasDir ?? resolverSchemasDir();
    this.available = fs.existsSync(this.schemasDir);
  }

  isAvailable(): boolean {
    if (!this.available) return false;
    const xsdPath = path.join(this.schemasDir, 'nfe_v4.00.xsd');
    return fs.existsSync(xsdPath);
  }

  listSchemas(): string[] {
    if (!this.available) return [];
    try {
      return fs.readdirSync(this.schemasDir)
        .filter(f => f.endsWith('.xsd'))
        .sort();
    } catch {
      return [];
    }
  }

  validate(xml: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!xml.includes('<infNFe')) {
      errors.push({ message: 'Elemento raiz <infNFe> nao encontrado' });
    }

    if (!xml.includes('versao="4.00"') && !xml.includes("versao='4.00'")) {
      errors.push({ message: 'Atributo versao="4.00" nao encontrado em infNFe' });
    }

    const requiredElements = [
      'ide', 'emit', 'dest', 'det', 'total', 'transp', 'pag',
    ];
    for (const el of requiredElements) {
      // A tag tem de terminar aqui: `includes('<det')` casava com `<detPag>`, e
      // por isso uma nota SEM NENHUM ITEM passava por esta conferência inteira.
      if (!new RegExp(`<${el}[ >/]`).test(xml)) {
        errors.push({
          message: `Elemento obrigatorio <${el}> nao encontrado`,
          path: `infNFe/${el}`,
        });
      }
    }

    const ideRequired = ['cUF', 'cNF', 'natOp', 'mod', 'serie', 'nNF', 'dhEmi', 'tpNF', 'tpEmis', 'tpAmb'];
    for (const field of ideRequired) {
      if (!xml.includes(`<${field}>`)) {
        errors.push({
          message: `Campo obrigatorio <${field}> nao encontrado em <ide>`,
          path: `infNFe/ide/${field}`,
        });
      }
    }

    // Presenca da tag nao e conteudo da tag. Estes dois campos definem a
    // numeracao, e o padrao deles esta no XSD: com `numero: "0"`, `"00123"` ou
    // `serie: "1500"` a previa dava verde e a nota so morria na SEFAZ (225).
    //
    // O `validarSchema` abaixo confere isto de verdade contra o .xsd — mas ele
    // FALHA ABERTO quando o xmllint nao esta disponivel, e nesse cenario a
    // previa voltaria a nao conferir nada. Estas duas linhas sao a rede que
    // sobra quando aquela cai.
    const PADRAO_DO_LEIAUTE: Array<[string, RegExp, string]> = [
      ['serie', /^(0|[1-9][0-9]{0,2})$/, '0 a 999, sem zero a esquerda'],
      ['nNF', /^[1-9][0-9]{0,8}$/, '1 a 999999999, sem zero a esquerda'],
    ];
    for (const [campo, padrao, esperado] of PADRAO_DO_LEIAUTE) {
      const m = xml.match(new RegExp(`<${campo}>([^<]*)</${campo}>`));
      if (m && !padrao.test(m[1])) {
        errors.push({
          message: `<${campo}> esta com "${m[1]}", que nao casa com o leiaute (${esperado}). `
            + 'A SEFAZ recusa com cStat 225, sem dizer qual campo.',
          path: `infNFe/ide/${campo}`,
        });
      }
    }

    const emitRequired = ['xNome', 'enderEmit', 'IE', 'CRT'];
    for (const field of emitRequired) {
      if (!xml.includes(`<${field}>`)) {
        errors.push({
          message: `Campo obrigatorio <${field}> nao encontrado em <emit>`,
          path: `infNFe/emit/${field}`,
        });
      }
    }

    if (!xml.includes('<CNPJ>') && !xml.includes('<CPF>')) {
      errors.push({
        message: 'Emitente deve ter <CNPJ> ou <CPF>',
        path: 'infNFe/emit',
      });
    }

    const cnpjMatch = xml.match(/<CNPJ>(\d+)<\/CNPJ>/);
    if (cnpjMatch && cnpjMatch[1].length !== 14) {
      errors.push({
        message: `CNPJ deve ter 14 digitos, encontrado ${cnpjMatch[1].length}`,
        path: 'infNFe/emit/CNPJ',
      });
    }

    const cpfMatch = xml.match(/<CPF>(\d+)<\/CPF>/);
    if (cpfMatch && cpfMatch[1].length !== 11) {
      errors.push({
        message: `CPF deve ter 11 digitos, encontrado ${cpfMatch[1].length}`,
        path: 'infNFe/emit/CPF',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validação de verdade, contra o XSD oficial da SEFAZ.
   *
   * O `validate()` acima confere presença de campo. É rápido, roda sempre e não
   * enxerga nada além disso: ordem de elemento, padrão de conteúdo e enumeração
   * passam batido. Era essa a razão de a prévia dar verde numa nota que a SEFAZ
   * recusa com cStat 225 — CEP com hífen, UF minúscula, IE onde o tipo não
   * aceita. Quem vê isso é o schema, e o schema está no projeto desde sempre;
   * só não estava sendo lido.
   *
   * **Falha aberta de propósito.** Se o xmllint ou os .xsd não estiverem
   * disponíveis, devolve `disponivel: false` em vez de reprovar. Infraestrutura
   * de validação ausente não pode impedir uma empresa de faturar — mas quem
   * chama precisa saber a diferença entre "conferido e aprovado" e "não deu
   * para conferir", e por isso o campo existe.
   *
   * A queixa de `Signature` ausente é descartada: aqui o XML ainda não foi
   * assinado, e é justamente esse o ponto de validar antes.
   */
  async validarSchema(
    xml: string,
  ): Promise<ValidationResult & { disponivel: boolean; motivo?: string }> {
    // O motivo viaja junto: falha aberta sem diagnóstico é uma validação que
    // some em produção sem ninguém perceber — foi o que aconteceu da primeira
    // vez, com os schemas fora do alcance do cwd do serverless.
    if (!this.isAvailable()) {
      return {
        valid: true, errors: [], disponivel: false,
        motivo: `schemas nao encontrados em ${this.schemasDir} (cwd=${process.cwd()})`,
      };
    }

    try {
      const { validateXML } = require('xmllint-wasm/index-node.js');
      const preload = fs.readdirSync(this.schemasDir)
        .filter(f => f.endsWith('.xsd'))
        .map(f => ({ fileName: f, contents: fs.readFileSync(path.join(this.schemasDir, f), 'utf8') }));

      // O xmllint quer o documento completo; o gerador devolve só o infNFe.
      const documento = xml.trimStart().startsWith('<?xml')
        ? xml
        : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;

      const r = await validateXML({
        xml: [{ fileName: 'nota.xml', contents: documento }],
        schema: [fs.readFileSync(path.join(this.schemasDir, 'nfe_v4.00.xsd'), 'utf8')],
        preload,
      });

      const errors: ValidationError[] = (r.errors || [])
        .map((e: any) => ({
          message: String(e?.message ?? e?.rawMessage ?? e),
          line: typeof e?.loc?.lineNo === 'number' ? e.loc.lineNo : undefined,
        }))
        .filter((e: ValidationError) => !e.message.includes('xmldsig#}Signature'));

      return { valid: errors.length === 0, errors, disponivel: true };
    } catch (err: any) {
      return {
        valid: true, errors: [], disponivel: false,
        motivo: `xmllint indisponivel: ${err?.message ?? err}`,
      };
    }
  }

  validatePreFlight(xml: string): ValidationResult {
    const result = this.validate(xml);

    if (!result.valid) {
      return result;
    }

    const warnings: ValidationError[] = [];

    if (!xml.includes('<Signature')) {
      warnings.push({ message: 'XML nao possui assinatura digital (esperado antes do envio)' });
    }

    return {
      valid: true,
      errors: warnings,
    };
  }
}
