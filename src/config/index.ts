import * as fs from 'fs';
import * as path from 'path';

export interface NFeConfigEndereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  nomeMunicipio: string;
  cep: string;
  fone?: string;
}

export interface NFeConfig {
  pfxPath: string;
  pfxBase64?: string;
  pfxPassword: string;
  ambiente: '1' | '2';
  uf: string;
  dbUrl: string;
  cnpjEmitente: string;
  razaoSocial: string;
  fantasia: string;
  ie: string;
  crt: string;
  endereco: NFeConfigEndereco;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Le o `.env` para dentro de `process.env`, se ele existir.
 *
 * Separado de `loadConfig` porque nem tudo que precisa de variavel precisa do
 * emitente padrao — o banco, por exemplo. Em producao ninguem tem `.env`: as
 * variaveis ja vem do provedor, e esta funcao nao faz nada.
 */
export function carregarArquivoEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * O endereco do banco, sem exigir o resto.
 *
 * Existe porque `loadConfig()` cobra certificado, CNPJ, IE e endereco do
 * emitente padrao — e dezessete lugares chamavam ele so para ler `dbUrl`. O
 * efeito pratico: uma instalacao nova nao abria o banco nem cadastrava cliente
 * enquanto nao tivesse um certificado A1 configurado.
 *
 * E o certificado do emitente padrao nem e o que emite pelos clientes: cada
 * cliente de API tem o seu, guardado cifrado no banco. Numa ponte que so
 * revende, o emitente padrao pode nunca existir.
 */
export function urlDoBanco(): string {
  carregarArquivoEnv();

  /**
   * `POSTGRES_URL` existe porque copiar connection string a mao e a etapa que
   * mais quebra numa instalacao nova.
   *
   * A string tem usuario, senha, host, porta e banco numa linha so, e qualquer
   * caractere perdido no caminho produz um erro que nao aponta para a causa:
   * um espaco no meio vira `ENOTFOUND` de um host que ninguem escreveu; um
   * simbolo nao codificado na senha corta a senha e vira `password
   * authentication failed`, como se estivesse errada.
   *
   * A integracao Supabase-Vercel escreve `POSTGRES_URL` sozinha, ja com o
   * pooler e a senha codificada. Aceitar esse nome elimina a digitacao — e a
   * classe inteira de erro que vem dela.
   *
   * `NFE_DB_URL` continua vindo primeiro: quem ja configurou na mao, ou aponta
   * para um banco que nao e do Supabase, nao pode ser atropelado por uma
   * variavel que uma integracao criou.
   */
  const naoVazia = (nome: string): string => String(process.env[nome] ?? '').trim();

  const pronta = naoVazia('NFE_DB_URL') || naoVazia('POSTGRES_URL');
  if (pronta) return pronta;

  /**
   * Ultimo recurso: montar a URL a partir das PARTES.
   *
   * Existe porque a connection string e um formato hostil para quem instala.
   * Ela obriga senha, host, porta, usuario e banco a viajarem num texto so, e
   * cada modo de estragar produz um erro que aponta para o lugar errado:
   *
   * - um espaco no meio corta o host ali → `ENOTFOUND` de um host que ninguem
   *   escreveu (foi assim que a palavra `base`, vinda de uma pagina traduzida
   *   pelo navegador, virou nome de servidor);
   * - `@`, `#`, `%`, `+` ou `/` na senha tem significado dentro de uma URL e
   *   cortam a senha pela metade → `password authentication failed`, como se a
   *   senha estivesse errada, levando a resetar a senha de novo. E de novo.
   *
   * Separadas, some a classe inteira: a senha vai sozinha num campo, sem
   * sintaxe em volta para quebrar, e e o codigo que a codifica. As outras
   * partes nao sao segredo — podem ser preenchidas por qualquer um, conferidas
   * a olho, e nao mudam mais depois.
   */
  const senha = naoVazia('NFE_DB_PASSWORD');
  const ref = naoVazia('NFE_DB_REF');
  const host = naoVazia('NFE_DB_HOST');
  if (!senha || !ref || !host) return '';

  const porta = naoVazia('NFE_DB_PORT') || '6543';
  const banco = naoVazia('NFE_DB_NAME') || 'postgres';

  // `encodeURIComponent` e o ponto todo: e ele que torna a senha indiferente ao
  // que ela contem. `trim` acima tambem conta — espaco no fim de um campo colado
  // e sempre acidente, e era indistinguivel de senha errada.
  return `postgresql://postgres.${ref}:${encodeURIComponent(senha)}@${host}:${porta}/${banco}`;
}

export function loadConfig(): NFeConfig {
  carregarArquivoEnv();

  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
    return val;
  };

  const optional = (key: string, defaultVal: string): string => {
    return process.env[key] || defaultVal;
  };

  // Certificado: arquivo (NFE_PFX_PATH) ou base64 (NFE_PFX_BASE64, p/ deploy serverless)
  const pfxBase64 = process.env['NFE_PFX_BASE64'] || '';
  const pfxPath = pfxBase64 ? optional('NFE_PFX_PATH', '') : required('NFE_PFX_PATH');

  return {
    pfxPath,
    pfxBase64: pfxBase64 || undefined,
    pfxPassword: required('NFE_PFX_PASSWORD'),
    ambiente: (optional('NFE_AMBIENTE', '2') as '1' | '2'),
    uf: required('NFE_UF'),
    dbUrl: optional('NFE_DB_URL', ''),
    cnpjEmitente: required('NFE_CNPJ_EMITENTE'),
    razaoSocial: required('NFE_RAZAO_SOCIAL'),
    fantasia: optional('NFE_FANTASIA', ''),
    ie: required('NFE_IE'),
    crt: optional('NFE_CRT', '1'),
    endereco: {
      logradouro: required('NFE_LOGRADOURO'),
      numero: required('NFE_NUMERO'),
      complemento: optional('NFE_COMPLEMENTO', '') || undefined,
      bairro: required('NFE_BAIRRO'),
      codigoMunicipio: required('NFE_COD_MUNICIPIO'),
      nomeMunicipio: required('NFE_NOME_MUNICIPIO'),
      cep: required('NFE_CEP'),
      fone: optional('NFE_FONE', '') || undefined,
    },
    timeoutMs: Number(optional('NFE_TIMEOUT_MS', '30000')),
    maxRetries: Number(optional('NFE_MAX_RETRIES', '3')),
  };
}

/** Retorna o buffer do certificado PFX — de base64 (serverless) ou arquivo local. */
export function getPfxBuffer(config: NFeConfig): Buffer {
  if (config.pfxBase64) {
    return Buffer.from(config.pfxBase64, 'base64');
  }
  return fs.readFileSync(config.pfxPath);
}
