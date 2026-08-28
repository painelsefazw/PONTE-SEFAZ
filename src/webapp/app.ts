import express from 'express';
import { descobrirHostDoPooler, sondarPoolerDeVerdade, REGIOES } from './pooler';
import * as fs from 'fs';
import * as path from 'path';
import Decimal from 'decimal.js';
import { buildNFe, getAliqInterestadual, UF_TO_IBGE, ErroDeDados } from '../domain/FiscalContext';
import { duplicarNota } from '../domain/DuplicarNota';
import { DanfseV2Generator } from '../infrastructure/pdf/danfse/DanfseV2Generator';
import { municipioPorCodigo } from '../domain/ibge';
import { generateAccessKey } from '../domain/NFeKeyGenerator';
import { XmlGenerator } from '../infrastructure/xml/XmlGenerator';
import { Signer } from '../infrastructure/crypto/Signer';
import { SoapClient } from '../infrastructure/soap/SoapClient';
import { parseAutorizacaoResponse, nfeAutorizada } from '../infrastructure/soap/ResponseParser';
import { getEndpoints, getNfceEndpoints, getNfceQrCodeUrl, getNfceUrlChave } from '../infrastructure/soap/SefazEndpoints';
import { XsdValidator } from '../infrastructure/validation/XsdValidator';
import { carimbarPdf, carimboDoStatus } from '../infrastructure/pdf/CarimboPdf';
import { DanfeGenerator } from '../infrastructure/pdf/DanfeGenerator';
import { EventXmlGenerator } from '../infrastructure/xml/EventXmlGenerator';
import { ConsultaXmlGenerator } from '../infrastructure/xml/ConsultaXmlGenerator';
import { parseEventoResponse, parseConsultaResponse, parseInutilizacaoResponse } from '../infrastructure/soap/ResponseParser';
import { InutilizacaoXmlGenerator } from '../infrastructure/xml/InutilizacaoXmlGenerator';
import { createStorage, WebappStorage } from './storage';
import { EmpresaStore, EmpresaContext } from './empresas';
import { ApiKeyStore, pareceApiKey, normalizarAmbientePermitido, AmbientePermitido } from './apikeys';
import { ProdutoStore } from './produtos';
import { NfseStore } from './nfse';
import { NfeRecebidaStore, proximoPasso } from './nfe-recebidas';
import { NcmStore } from './ncm';
import { NfseUseCase } from '../application/NfseUseCase';
import { SefinClient } from '../infrastructure/nfse/SefinClient';
import { PLANOS as CATALOGO_PLANOS, planoDe, divergenciaDePlano } from './planos';
import { gerarDhEmiDps, gerarCompetencia } from '../infrastructure/nfse/DpsXmlGenerator';
import { validarServico } from '../domain/nfse/RegrasServico';
import { parseNfse } from '../infrastructure/nfse/NfseParser';
import type { DpsContextInput } from '../domain/nfse/DpsContext';
import { FiscalBrain, TIPOS_OPERACAO, resolverCfop, TipoOperacaoFiscal } from '../infrastructure/fiscal/FiscalBrain';
import { verifySenha } from './crypto';
import { loadConfig, urlDoBanco, getPfxBuffer, NFeConfig } from '../config';
import type { FiscalContextInput } from '../domain/FiscalContext';
import type { NFe } from '../domain/models';
import { DanfePhpService } from '../../danfe-service/DanfePhpService';
import { requestIdMiddleware, errorResponse, errorHandlerMiddleware } from './middleware/errors';
import { createRateLimiter } from './middleware/rate-limiter';
import { limparVencidas } from './middleware/contador-compartilhado';
import { AuditStore } from './audit';
import { RequestLogStore } from './request-log';
import { ClientServiceStore, type FiscalService, scopeAllowsService } from './client-services';
import { WebhookStore, type WebhookEvent } from './webhooks';
import { ApiClientStore, type ClientStatus } from './api-clients';
import { WhiteLabelStore } from './white-label';
import { PlatformTemplateStore, type PlatformManifest, type PlatformTemplate } from './platform-templates';
import {
  baixarModelo, lerModeloDaPasta, montarZip, publicarNoGitHub, verificarAcessoAoRepositorio,
  escolherToken, SEM_TOKEN, CAMINHO_MANIFEST,
} from './kit-plataforma';
import { montarKitDaInstancia, urlDeDeployNaVercel, amarrarConsoleNaPonte, candidatosDeRaiz, discoEstaAtrasado } from './kit-instancia';
import { MarcaDoDanfeStore, conferirLogo, conferirTextoPadrao, normalizarPosicao } from './danfe-marca';

// DANFE oficial (sped-da) via serviço PHP separado: quando DANFE_SERVICE_URL está
// definido, o PDF vem do layout homologado; senão, usa o gerador simplificado.
const DANFE_SERVICE_URL = process.env['DANFE_SERVICE_URL'];
const DANFE_KEY = process.env['DANFE_KEY'];

/** Monta o nfeProc (NFe assinada + protNFe) a partir da resposta de autorização da SEFAZ. */
function montarNfeProc(signedNFeXml: string, responseXml: string): string | undefined {
  const m = responseXml.match(/<protNFe[\s\S]*?<\/protNFe>/);
  if (!m) return undefined;
  const nfe = signedNFeXml.replace(/^<\?xml[^>]*\?>\s*/, '');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}${m[0]}</nfeProc>`;
}

/**
 * Gera o PDF do DANFE. Preferência: serviço sped-da (layout oficial da SEFAZ) a partir
 * do nfeProc; se indisponível/erro, cai no gerador simplificado (pdfkit) via objeto NFe.
 */
/**
 * @param carimbo texto diagonal a aplicar sobre o PDF pronto — 'CANCELADA' na
 *   nota cancelada. Aplicado DEPOIS de gerar, e nao durante, porque o DANFE
 *   oficial vem pronto de um servico externo: desenhar so no gerador local
 *   deixaria justamente o PDF que a maioria baixa sem marca nenhuma.
 */
async function gerarDanfePdf(opts: {
  nfeProcXml?: string; nfe: NFe; chave: string; nProt: string; dhRecbto: string;
  carimbo?: string | undefined;
}): Promise<Buffer> {
  let pdf: Buffer | undefined;
  if (DANFE_SERVICE_URL && opts.nfeProcXml) {
    try {
      /**
       * A logo sai do CNPJ do emitente, que ja esta dentro da nota.
       *
       * Poderia ser um parametro, mas seriam quatro pontos de chamada para
       * lembrar de preencher — e o que fosse esquecido geraria DANFE sem logo
       * em silencio, exatamente o defeito que isto veio corrigir. Tirando de
       * dentro do documento, nao ha o que esquecer.
       */
      const emitente = String(opts.nfe?.emit?.CNPJ ?? '').replace(/\D/g, '');
      let marca;
      try {
        const store = emitente ? await getMarcaDoDanfeStore() : null;
        const achada = store ? await store.obter(emitente) : null;
        // Só a logo interessa aqui: o texto padrão já entrou no XML na
        // emissão, e o DANFE o imprime a partir dele.
        if (achada?.logoBase64) marca = { logoBase64: achada.logoBase64, posicao: achada.posicao };
      } catch { /* sem logo o DANFE sai igual ao de antes — nao vale derrubar a nota */ }

      const svc = new DanfePhpService({ serviceUrl: DANFE_SERVICE_URL, serviceKey: DANFE_KEY, timeoutMs: 25000 });
      pdf = await svc.generateFromXml(opts.nfeProcXml, marca);
    } catch { /* cai no gerador simplificado abaixo */ }
  }
  if (!pdf) {
    const gen = new DanfeGenerator();
    pdf = await gen.generate({ nfe: opts.nfe, chaveAcesso: opts.chave, nProt: opts.nProt, dhRecbto: opts.dhRecbto });
  }
  const pronto: Buffer = pdf;
  return opts.carimbo ? carimbarPdf(pronto, opts.carimbo) : pronto;
}

function gerarDhEmi(): string {
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${hh}:${mm}`;
}

/** idDest: 1=interna, 2=interestadual, 3=exterior — calculado pela UF do destinatário. */
function calcularDestino(ufEmitente: string, ufDestinatario: string): string {
  if (ufDestinatario === 'EX') return '3';
  return ufDestinatario === ufEmitente ? '1' : '2';
}

// Config carregada sob demanda: permite o deploy "nascer em branco" e
// responder com instrução clara em vez de crashar no boot.
let cachedConfig: NFeConfig | null = null;
function getConfig(): NFeConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

// Storage: Postgres (NFE_DB_URL) ou arquivo local — inicializado sob demanda
let cachedStorage: WebappStorage | null = null;
async function getStorage(): Promise<WebappStorage> {
  if (!cachedStorage) {
    const storage = createStorage(urlDoBanco());
    await storage.init();
    cachedStorage = storage;
  }
  return cachedStorage;
}

// Cadastro de empresas (multi-tenant) — exige Postgres (NFE_DB_URL)
let cachedEmpresaStore: EmpresaStore | null = null;
async function getEmpresaStore(): Promise<EmpresaStore> {
  if (!cachedEmpresaStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Cadastro de empresas exige NFE_DB_URL (Postgres)');
    const store = new EmpresaStore(dbUrl);
    await store.init();
    cachedEmpresaStore = store;
  }
  return cachedEmpresaStore;
}

// API Keys por empresa (Postgres) — inicializado sob demanda
let cachedApiKeyStore: ApiKeyStore | null = null;
async function getApiKeyStore(): Promise<ApiKeyStore> {
  if (!cachedApiKeyStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('API Keys exigem NFE_DB_URL (Postgres)');
    const store = new ApiKeyStore(dbUrl);
    await store.init();
    cachedApiKeyStore = store;
  }
  return cachedApiKeyStore;
}

// Catálogo de produtos por empresa (Postgres) — inicializado sob demanda
let cachedProdutoStore: ProdutoStore | null = null;
async function getProdutoStore(): Promise<ProdutoStore> {
  if (!cachedProdutoStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Catálogo de produtos exige NFE_DB_URL (Postgres)');
    const store = new ProdutoStore(dbUrl);
    await store.init();
    cachedProdutoStore = store;
  }
  return cachedProdutoStore;
}

// Base de NCM própria (Postgres) — inicializada sob demanda
let cachedNcmStore: NcmStore | null = null;
async function getNcmStore(): Promise<NcmStore> {
  if (!cachedNcmStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('A base de NCM exige NFE_DB_URL (Postgres)');
    const store = new NcmStore(dbUrl);
    await store.init();
    cachedNcmStore = store;
  }
  return cachedNcmStore;
}

// NFS-e: notas de serviço, numeração da DPS e catálogo de serviços (Postgres)
let cachedNfseStore: NfseStore | null = null;
let cachedNfeRecebidaStore: NfeRecebidaStore | null = null;

/**
 * A logomarca que sai no DANFE, por CNPJ do emitente.
 *
 * Devolve `null` sem banco em vez de lancar: a logo e enfeite do documento, e
 * derrubar a emissao de uma nota fiscal porque a decoracao nao carregou seria
 * trocar um problema pequeno por um grande.
 */
let cachedMarcaDanfe: MarcaDoDanfeStore | null = null;
async function getMarcaDoDanfeStore(): Promise<MarcaDoDanfeStore | null> {
  if (cachedMarcaDanfe) return cachedMarcaDanfe;
  const dbUrl = urlDoBanco();
  if (!dbUrl) return null;
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(dbUrl);
  const store = new MarcaDoDanfeStore(new Pool({
    connectionString: dbUrl,
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: 2,
  }));
  await store.init();
  cachedMarcaDanfe = store;
  return store;
}

async function getNfeRecebidaStore(): Promise<NfeRecebidaStore> {
  if (!cachedNfeRecebidaStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Notas recebidas exigem NFE_DB_URL (Postgres)');
    const store = new NfeRecebidaStore(dbUrl);
    await store.init();
    cachedNfeRecebidaStore = store;
  }
  return cachedNfeRecebidaStore;
}
async function getNfseStore(): Promise<NfseStore> {
  if (!cachedNfseStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('NFS-e exige NFE_DB_URL (Postgres)');
    const store = new NfseStore(dbUrl);
    await store.init();
    cachedNfseStore = store;
  }
  return cachedNfseStore;
}

// "Cérebro fiscal" (base externa de NCM/ICMS/ST/CEST) — stateless, reaproveitado
const fiscalBrain = new FiscalBrain();

// --- Stores da camada API comercial (inicializados sob demanda) ---
let cachedAuditStore: AuditStore | null = null;
async function getAuditStore(): Promise<AuditStore> {
  if (!cachedAuditStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Audit exige NFE_DB_URL');
    cachedAuditStore = new AuditStore(dbUrl);
    await cachedAuditStore.init();
  }
  return cachedAuditStore;
}

let cachedRequestLogStore: RequestLogStore | null = null;
async function getRequestLogStore(): Promise<RequestLogStore> {
  if (!cachedRequestLogStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Request log exige NFE_DB_URL');
    cachedRequestLogStore = new RequestLogStore(dbUrl);
    await cachedRequestLogStore.init();
  }
  return cachedRequestLogStore;
}

let cachedClientServiceStore: ClientServiceStore | null = null;
async function getClientServiceStore(): Promise<ClientServiceStore> {
  if (!cachedClientServiceStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Client services exige NFE_DB_URL');
    cachedClientServiceStore = new ClientServiceStore(dbUrl);
    await cachedClientServiceStore.init();
  }
  return cachedClientServiceStore;
}

let cachedWebhookStore: WebhookStore | null = null;
async function getWebhookStore(): Promise<WebhookStore> {
  if (!cachedWebhookStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Webhooks exige NFE_DB_URL');
    cachedWebhookStore = new WebhookStore(dbUrl);
    await cachedWebhookStore.init();
  }
  return cachedWebhookStore;
}

let cachedApiClientStore: ApiClientStore | null = null;
async function getApiClientStore(): Promise<ApiClientStore> {
  if (!cachedApiClientStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('API Clients exige NFE_DB_URL');
    cachedApiClientStore = new ApiClientStore(dbUrl);
    await cachedApiClientStore.init();
  }
  return cachedApiClientStore;
}

let cachedWhiteLabelStore: WhiteLabelStore | null = null;
async function getWhiteLabelStore(): Promise<WhiteLabelStore> {
  if (!cachedWhiteLabelStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('White-label exige NFE_DB_URL');
    cachedWhiteLabelStore = new WhiteLabelStore(dbUrl);
    await cachedWhiteLabelStore.init();
  }
  return cachedWhiteLabelStore;
}

let cachedPlatformTemplateStore: PlatformTemplateStore | null = null;
async function getPlatformTemplateStore(): Promise<PlatformTemplateStore> {
  if (!cachedPlatformTemplateStore) {
    const dbUrl = urlDoBanco();
    if (!dbUrl) throw new Error('Templates exige NFE_DB_URL');
    cachedPlatformTemplateStore = new PlatformTemplateStore(dbUrl);
    await cachedPlatformTemplateStore.init();
  }
  return cachedPlatformTemplateStore;
}

async function despacharWebhook(
  cnpj: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  ambiente?: string,
): Promise<void> {
  try {
    const store = await getWebhookStore();
    await store.despachar(cnpj, event, payload, ambiente);
  } catch { /* webhook dispatch never blocks */ }
}

async function registrarAudit(actor: string, action: string, entityType: string, opts?: {
  empresaCnpj?: string; entityId?: string; before?: Record<string, unknown>;
  after?: Record<string, unknown>; requestId?: string;
}): Promise<void> {
  try {
    const store = await getAuditStore();
    await store.registrar({ actor, action, entityType, ...opts });
  } catch { /* audit never blocks */ }
}

async function verificarServicoContratado(cnpj: string, service: FiscalService): Promise<boolean> {
  try {
    const store = await getClientServiceStore();
    return await store.verificarPermissao(cnpj, service);
  } catch { return true; }
}

/**
 * Consome uma emissão da cota do mês.
 *
 * O plano vem do CADASTRO do cliente (`planoDoCliente`, a mesma fonte que o
 * limitador de requisições usa), e não de `webapp_billing.plano` — coluna que
 * nasce 'free' e que ninguém mais escreve, desde que o checkout automático saiu.
 * Enquanto o limite saía dali, todo cliente MAX ou PREMIUM parava na nota 301
 * com 402, e o painel mostrava "sem teto".
 *
 * INCREMENTA: quem chama precisa ter certeza de que é emissão real. Prévia não
 * passa por aqui — consumir cota para conferir uma nota é cobrar pelo ensaio.
 */
async function verificarBilling(cnpj: string): Promise<{ permitido: boolean; usado: number; limite: number }> {
  try {
    const [billing, plano] = await Promise.all([getBillingStore(), planoDoCliente(cnpj)]);
    return await billing.incrementarUso(cnpj, plano);
  } catch { return { permitido: true, usado: 0, limite: 0 }; }
}

/**
 * Resolve a empresa emissora da requisição:
 * - tenant travado pela autenticação (API Key / senha da empresa) → sempre vence
 * - admin: header x-empresa-cnpj → empresa cadastrada no banco
 * - sem header → empresa da configuração de ambiente (.env / Vercel env vars)
 *
 * O tenant travado ignora o header de propósito: uma API Key vale para UMA empresa,
 * e trocar o header não pode dar acesso a outra.
 */
async function resolveEmpresa(req: express.Request): Promise<EmpresaContext> {
  const travado = (req as any).tenantCnpj as string | undefined;
  const cnpjHeader = travado || (req.header('x-empresa-cnpj') || '').replace(/\D/g, '');
  if (cnpjHeader) {
    const store = await getEmpresaStore();
    const ctx = await store.obterContexto(cnpjHeader);
    if (ctx) return ctx;

    // Empresa cadastrada porém desativada para de emitir, ponto. Sem esta
    // checagem o fallback abaixo reativaria pela porta dos fundos um CNPJ que
    // também existisse como cliente de API.
    const raw = await store.obterRaw(cnpjHeader);
    if (raw && !raw.ativa) throw new Error(`Empresa ${cnpjHeader} esta inativa`);

    // Cliente de API é entidade própria e não aparece na tabela de emitentes do
    // Emissor — tem cadastro fiscal e certificado proprios. Consultado só depois
    // do caminho normal falhar, para não alterar quem ja emitia.
    const clientStore = await getApiClientStore();
    const apiCtx = await clientStore.obterContextoFiscal(cnpjHeader);
    if (apiCtx) return apiCtx;

    const client = await clientStore.obter(cnpjHeader);
    if (client) {
      const falta: string[] = [];
      if (client.status !== 'active' && client.status !== 'sandbox') falta.push(`cliente esta ${client.status}`);
      if (!client.temCertificado) falta.push('certificado A1 nao enviado');
      falta.push('confira IE, UF e municipio no cadastro fiscal do cliente');
      throw new Error(`Cliente ${cnpjHeader} ainda nao pode emitir: ${falta.join('; ')}.`);
    }
    throw new Error(`Empresa ${cnpjHeader} nao cadastrada ou inativa`);
  }
  // Sem empresa identificada, o motor caía no emitente do .env. Como esse
  // emitente é uma empresa real e cadastrada, esquecer o header fazia a nota
  // sair em nome dela, assinada com o certificado dela — e no ambiente da
  // variável, que pode divergir do cadastro.
  //
  // O fallback só faz sentido quando ainda não há empresa cadastrada, que era o
  // caso de origem: deploy novo, operando pelo .env até o primeiro cadastro.
  try {
    const store = await getEmpresaStore();
    const cadastradas = await store.listar();
    if (cadastradas.length) {
      throw new Error(
        'Empresa nao identificada. Envie o header x-empresa-cnpj com o CNPJ da empresa emitente, '
        + 'ou use uma API Key (que ja carrega a empresa). '
        + `Cadastradas: ${cadastradas.length}.`,
      );
    }
  } catch (err: any) {
    // Erro de banco não deve mascarar a causa real: só segue para o .env quando
    // a consulta funcionou e não havia nenhuma empresa.
    if (/Empresa nao identificada/.test(err?.message || '')) throw err;
  }

  const config = getConfig();
  return {
    cnpj: config.cnpjEmitente,
    razaoSocial: config.razaoSocial,
    fantasia: config.fantasia || undefined,
    ie: config.ie,
    crt: config.crt,
    uf: config.uf,
    ambiente: config.ambiente,
    endereco: {
      logradouro: config.endereco.logradouro,
      numero: config.endereco.numero,
      complemento: config.endereco.complemento,
      bairro: config.endereco.bairro,
      codigoMunicipio: config.endereco.codigoMunicipio,
      nomeMunicipio: config.endereco.nomeMunicipio,
      cep: config.endereco.cep,
      fone: config.endereco.fone,
    },
    pfxBuffer: getPfxBuffer(config),
    pfxPassword: config.pfxPassword,
  };
}

export const app = express();
app.use(express.json({ limit: '10mb' })); // certificado .pfx em base64 no cadastro
app.use(requestIdMiddleware);

// Request logging: captura duração e resultado de cada chamada /api
app.use('/api', (req, res, next) => {
  const start = Date.now();
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const duration = Date.now() - start;
    const reqId = (req as any).requestId || '';
    res.setHeader('X-Request-Id', reqId);
    // Best-effort async log
    getRequestLogStore().then(store => {
      const service = req.path.includes('/nfse/') ? 'nfse'
        : req.path.includes('/emitir-nfce') ? 'nfce'
        : req.path.includes('/emitir') ? 'nfe'
        : undefined;
      store.enqueue({
        requestId: reqId,
        empresaCnpj: (req as any).tenantCnpj,
        apiKeyPrefix: (req as any).apiKeyNome,
        method: req.method,
        path: req.path,
        service,
        statusCode: res.statusCode,
        durationMs: duration,
        ambiente: (req as any).apiKeyAmbiente,
        errorCode: body?.error?.code,
        errorMessage: body?.erro || body?.error?.message,
        ip: req.ip,
      });
    }).catch(() => {});
    return originalJson(body);
  } as any;
  next();
});

// Static: __dirname (build local) ou cwd (bundle serverless)
const staticCandidates = [
  path.join(__dirname, 'public'),
  path.resolve(process.cwd(), 'src', 'webapp', 'public'),
];
for (const dir of staticCandidates) {
  if (fs.existsSync(dir)) {
    app.use(express.static(dir));
    break;
  }
}

// ---------------------------------------------------------------------------
// GET /api/ping — estado do deploy (sem autenticação)
// ---------------------------------------------------------------------------
/**
 * O painel completo mostra emissao, empresas, cadastros e configuracoes. Numa
 * ponte que so REVENDE, nada disso e operado por quem administra: os clientes
 * emitem pela API, cada um com o seu certificado guardado no banco. As telas
 * viram ruido — e pior, sugerem que ha algo a preencher ali.
 *
 * O padrao se decide sozinho pelo unico fato que ja distingue os dois casos:
 * ter ou nao um emitente proprio configurado. Instalacao nova nao tem, entao
 * nasce em `revenda` sem precisar de variavel nenhuma — e uma variavel a menos
 * na tela de deploy e uma a menos para errar.
 *
 * `WEBAPP_MODO` existe para os dois casos que a deducao nao cobre: quem revende
 * mas tambem emite em nome proprio, e quem quer o painel inteiro antes de
 * cadastrar o certificado.
 */
export function modoDoPainel(
  opts: { explicito?: string | undefined; configurado: boolean },
): 'revenda' | 'completo' {
  const escolhido = String(opts.explicito ?? '').trim().toLowerCase();
  if (escolhido === 'revenda' || escolhido === 'completo') return escolhido;
  return opts.configurado ? 'completo' : 'revenda';
}

app.get('/api/ping', (_req, res) => {
  let configurado = true;
  let erro: string | undefined;
  try {
    getConfig();
  } catch (e: any) {
    configurado = false;
    erro = e.message;
  }
  res.json({
    ok: true,
    configurado,
    erro,
    modo: modoDoPainel({ explicito: process.env['WEBAPP_MODO'], configurado }),
    // O titulo era fixo em "NF-e Engine". Numa instalacao que o cliente opera
    // — ou que voce revende com marca propria — o nome do fornecedor no topo
    // e, no minimo, estranho.
    marca: String(process.env['WEBAPP_MARCA'] ?? '').trim() || 'Ponte SEFAZ',
    autenticacao: Boolean(process.env['WEBAPP_SENHA']),
  });
});

// ---------------------------------------------------------------------------
// GET /api/keepalive — chamado pelo Vercel Cron 1x/dia: toca o banco para o
// Supabase free nunca pausar por inatividade (pausa após 7 dias sem query).
// Sem auth (não expõe dados) e registrado ANTES do middleware de senha.
// ---------------------------------------------------------------------------
app.get('/api/keepalive', async (_req, res) => {
  try {
    const storage = await getStorage();
    await storage.peekNumber('00000000000000', 'keepalive'); // SELECT real no banco

    /**
     * Arquivo em serverless nao e sucesso, e esta rota nao pode dizer que e.
     *
     * Antes ela respondia `{ok:true, storage:"file"}` com 200 quando o banco
     * nao estava configurado — tecnicamente verdade (o SELECT no arquivo
     * funcionou) e praticamente uma mentira: em serverless cada invocacao
     * comeca com um disco vazio, entao a empresa cadastrada some, a numeracao
     * volta ao 1 e a nota emitida nao fica em lugar nenhum.
     *
     * Custou cinco dias numa instalacao real. O verde era o unico sinal que se
     * olhava, e ele estava verde o tempo todo — ninguem procura defeito onde o
     * monitor diz que esta tudo bem. So apareceu quando um build novo trocou o
     * modo arquivo por uma tentativa de verdade no Postgres.
     *
     * Localmente arquivo E um modo legitimo: `npm run dev` sem banco tem disco
     * que persiste entre requisicoes. Por isso a condicao e a PLATAFORMA, e nao
     * o modo — `VERCEL` e definida pelo proprio ambiente de execucao dela.
     */
    if (Boolean(process.env['VERCEL']) && storage.kind() !== 'postgres') {
      res.status(503).json({
        ok: false,
        storage: storage.kind(),
        erro: 'Sem banco configurado: esta instalacao esta gravando em ARQUIVO, e em '
          + 'serverless cada invocacao comeca com um disco vazio. Nada do que for '
          + 'cadastrado ou emitido sobrevive.',
        veja: '/api/diagnostico/banco',
      });
      return;
    }

    res.json({ ok: true, storage: storage.kind() });
  } catch (err: any) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/cron/webhooks-retry — varredura agendada das entregas pendentes.
//
// Em serverless não existe processo de fundo: um `setInterval` morre junto com
// a invocação. Sem um gatilho, `next_retry_at` era gravado e nunca lido — a
// aparência do retry, sem reenvio nenhum. Este é o gatilho.
//
// Método GET porque é o que o Vercel Cron dispara. A rota fica ANTES do
// middleware de senha (como o keepalive) — o cron não tem como mandar a senha
// da plataforma — e por isso se protege sozinha com `CRON_SECRET`, o mesmo
// segredo que o Vercel envia no `Authorization`.
//
// Sem `CRON_SECRET` definido a rota fica DESLIGADA, não aberta: uma instalação
// que esqueceu de configurar não vira endpoint público. Para disparar à mão
// nesse caso existe `POST /api/admin/webhooks/reprocessar`, que passa pela
// autenticação normal.
// ---------------------------------------------------------------------------
app.get('/api/cron/webhooks-retry', async (req, res) => {
  const segredo = process.env['CRON_SECRET'];
  if (!segredo || req.headers['authorization'] !== `Bearer ${segredo}`) {
    res.status(403).json({
      erro: 'Rota de cron: exige Authorization Bearer com CRON_SECRET.',
      comoDisparar: 'Sem CRON_SECRET configurado, use POST /api/admin/webhooks/reprocessar.',
    });
    return;
  }
  try {
    const store = await getWebhookStore();
    const r = await store.reprocessarPendentes(200);

    // A varredura diária é o único momento periódico que existe neste ambiente,
    // então a limpeza das janelas de rate limit pega carona. Sem ela a tabela
    // cresce com chaves que ninguém vai consultar de novo — IP avulso, cliente
    // que sumiu.
    let janelasLimpas = 0;
    if (poolDoLimitador) janelasLimpas = await limparVencidas(poolDoLimitador);

    res.json({ ok: true, ...r, janelasLimpas });
  } catch (err: any) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

/**
 * Traduz o erro do driver de Postgres para a causa que o operador consegue agir.
 *
 * O erro cru aponta para o lugar errado com frequencia, e cada um deles ja levou
 * alguem a procurar horas no lugar errado:
 *
 * - host cortado por um espaco vira `ENOTFOUND` de um host que NINGUEM escreveu
 *   (foi assim que a palavra "base", vinda de uma pagina traduzida pelo
 *   navegador, virou nome de servidor);
 * - simbolo nao codificado na senha corta a senha pela metade e vira
 *   `password authentication failed`, como se a senha estivesse errada — o que
 *   leva a reseta-la. E a nova senha tem outro simbolo, e o ciclo recomeca.
 *
 * Devolve `null` quando nao reconhece: inventar uma causa provavel errada e pior
 * que nao dar nenhuma, porque manda procurar no lugar errado com confianca.
 */
export function explicarErroDeBanco(mensagem: string): string | null {
  const m = String(mensagem ?? '');
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) {
    return 'O HOST não foi encontrado. Confira NFE_DB_HOST — ele costuma vir com espaço '
      + 'colado no fim, ou com uma palavra traduzida pelo navegador no meio.';
  }
  if (/password authentication failed|SASL|senha/i.test(m)) {
    return 'A senha foi RECUSADA. Se você a colou dentro de uma connection string, um '
      + 'símbolo (@ # % + /) pode tê-la cortado pela metade — use NFE_DB_PASSWORD sozinha, '
      + 'que o código codifica.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(m)) {
    return 'A conexão não completou. Confira a porta (6543 é o pooler, 5432 é direto) e se '
      + 'o projeto Supabase não está pausado por inatividade.';
  }
  if (/does not exist|role .* does not exist/i.test(m)) {
    return 'O banco ou o usuário não existe. Confira NFE_DB_REF — é o pedaço do meio da URL '
      + 'do painel do Supabase.';
  }
  if (/self.signed|certificate/i.test(m)) {
    return 'O certificado TLS do banco foi recusado. Em Supabase isso costuma ser host '
      + 'errado, não certificado — confira NFE_DB_HOST antes de mexer em SSL.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/diagnostico/banco — por que esta instalação não achou o Postgres.
//
// Sem isto, uma instalação nova responde `storage: "file"` e pronto: o operador
// preencheu três variáveis, uma está errada, e nada diz qual. Foi exatamente o
// que aconteceu com a segunda instância da ponte — no ar, respondendo 200, e
// gravando num disco que some.
//
// Em serverless o armazenamento em ARQUIVO não é um modo degradado aceitável:
// cada invocação começa com um disco vazio. A empresa cadastrada some, a
// numeração volta ao 1 e a nota emitida não fica em lugar nenhum. Parece que
// funciona, e é o pior desfecho possível.
//
// Sem auth, como o keepalive, e registrada ANTES do middleware de senha: quem
// precisa dela é justamente quem ainda não conseguiu configurar a instalação.
// Por isso ela NUNCA devolve a senha nem a URL montada — só quais peças
// chegaram, e o host e a referência, que não são segredo e precisam ser
// conferidos a olho.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /api/diagnostico/pooler — em qual frota do Supabase este projeto vive.
//
// O host do pooler tem um numero de frota no nome, e `aws-0-us-west-2` e
// `aws-1-us-west-2` sao balanceadores DIFERENTES: um projeto atende em um so.
// Apontar para o errado devolve `password authentication failed`, que parece
// senha errada — e numa instalacao real isso levou a dois resets de senha antes
// de alguem desconfiar do host. A confusao e simetrica: neste mesmo projeto uma
// sessao supos a frota 1 e estava errada.
//
// Aqui a resposta e MEDIDA: sonda-se cada frota com uma senha inventada e
// le-se qual recusa veio. Senha recusada prova que o tenant existe ali; tenant
// nao encontrado prova que nao.
//
// Sem auth, como as outras rotas de diagnostico, porque quem precisa dela e
// justamente quem ainda nao configurou. Isso a torna PUBLICA, e por isso o host
// nunca vem do pedido: ele e MONTADO a partir da lista de regioes conhecidas.
// Aceitar host do chamador transformaria esta rota num jeito de mandar o
// servidor abrir conexao em qualquer endereco.
// ---------------------------------------------------------------------------
app.get('/api/diagnostico/pooler', async (req, res) => {
  const referencia = String(req.query['ref'] ?? '').trim();
  const regiao = String(req.query['regiao'] ?? '').trim();

  try {
    const achado = await descobrirHostDoPooler({ referencia, regiao }, sondarPoolerDeVerdade);
    res.status(achado.host ? 200 : 404).json({ ok: Boolean(achado.host), ...achado });
  } catch (erro: any) {
    res.status(400).json({ ok: false, erro: erro.message, regioes: REGIOES });
  }
});

// ---------------------------------------------------------------------------
// GET /api/diagnostico/pacote — de onde sai o codigo que vira instancia nova.
//
// O pacote e montado a partir do DISCO, e o servidor roda a partir de um bundle
// compilado. Os dois podem divergir: ja aconteceu de a instancia publicada
// nascer com o codigo de dias antes, enquanto a ponte que a gerou respondia com
// o codigo novo. Nada na resposta dizia isso — o commit era novo, a contagem de
// arquivos batia, e so comparando arquivo por arquivo se descobria.
//
// Esta rota compara as duas coisas: o que ESTA RODANDO e o que esta no disco. A
// prova e uma marca que so existe no codigo desta versao; se o arquivo lido nao
// a contiver, o disco esta atrasado em relacao ao processo.
//
// Sem auth, como as outras de diagnostico: quem precisa dela e justamente quem
// publicou e recebeu um pacote errado. Nao devolve conteudo de arquivo nenhum,
// so caminhos, tamanhos e datas.
// ---------------------------------------------------------------------------
app.get('/api/diagnostico/pacote', (_req, res) => {
  const alvo = path.join('src', 'webapp', 'app.ts');

  const candidatos = candidatosDeRaiz().map((raiz) => {
    const completo = path.join(raiz, alvo);
    try {
      const info = fs.statSync(completo);
      const conteudo = fs.readFileSync(completo, 'utf8');
      return {
        raiz,
        existe: true,
        bytes: info.size,
        modificadoEm: info.mtime.toISOString(),
        /**
         * A marca e ESTA PROPRIA ROTA.
         *
         * A primeira versao procurava `modoDoPainel`, e isso envelheceu na
         * mesma tarde: o disco tinha aquele commit e nao os quatro seguintes,
         * entao a conferencia passava e o pacote saia velho do mesmo jeito.
         * Qualquer marca escolhida a dedo tem esse destino.
         *
         * Procurar o caminho desta rota resolve por construcao: se o processo
         * esta respondendo aqui, o codigo dele tem esta linha — e um disco que
         * nao a tenha e, por definicao, anterior ao que esta rodando.
         */
        temCodigoDesteProcesso: conteudo.includes('/api/diagnostico/pacote'),
      };
    } catch {
      return { raiz, existe: false };
    }
  });

  const escolhida = candidatos.find((c) => c.existe);
  const atrasado = Boolean(escolhida && escolhida.temCodigoDesteProcesso === false);

  res.status(atrasado ? 503 : 200).json({
    ok: !atrasado,
    raizEscolhida: escolhida?.raiz ?? null,
    candidatos,
    ...(atrasado ? {
      alerta: 'O DISCO ESTA ATRASADO em relacao ao processo. Publicar agora geraria uma '
        + 'instancia com codigo antigo — o commit sai novo e o conteudo, nao.',
      comoResolver: 'Refaca o deploy desta ponte SEM cache de build (na Vercel: Redeploy '
        + 'com "Use existing Build Cache" desmarcado) e publique de novo.',
    } : {}),
  });
});

app.get('/api/diagnostico/banco', async (_req, res) => {
  const valor = (nome: string) => String(process.env[nome] ?? '').trim();
  const estado = (nome: string) => (valor(nome) ? 'presente' : 'ausente');

  const url = urlDoBanco();
  const porPartes = !valor('NFE_DB_URL') && !valor('POSTGRES_URL') && Boolean(url);

  const variaveis: Record<string, string> = {
    NFE_DB_URL: estado('NFE_DB_URL'),
    POSTGRES_URL: estado('POSTGRES_URL'),
    NFE_DB_PASSWORD: estado('NFE_DB_PASSWORD'),
    NFE_DB_REF: estado('NFE_DB_REF'),
    NFE_DB_HOST: estado('NFE_DB_HOST'),
  };

  // As partes só valem juntas: faltando uma, as outras duas não servem para
  // nada e o código cai no arquivo em silêncio.
  const partes = ['NFE_DB_PASSWORD', 'NFE_DB_REF', 'NFE_DB_HOST'];
  const faltando = partes.filter(n => !valor(n));

  if (!url) {
    const algumaParte = partes.some(n => valor(n));
    res.status(503).json({
      ok: false,
      storage: 'file',
      alerta: 'ARMAZENAMENTO EM ARQUIVO. Em serverless cada invocação começa com um disco '
        + 'vazio: empresa cadastrada some, numeração volta ao 1 e nota emitida não fica '
        + 'em lugar nenhum. Parece que funciona.',
      variaveis,
      faltando: algumaParte ? faltando : partes,
      comoResolver: algumaParte
        ? `Faltam ${faltando.join(', ')}. As três partes só valem juntas — com uma ausente `
          + 'as outras duas são ignoradas.'
        : 'Configure NFE_DB_URL, ou POSTGRES_URL (a integração Supabase-Vercel escreve essa '
          + 'sozinha), ou as três partes: NFE_DB_PASSWORD, NFE_DB_REF e NFE_DB_HOST.',
      ondeConfigurar: 'Vercel → Settings → Environment Variables → Production. '
        + 'Depois de salvar é preciso REDEPLOY: variável nova não entra num deploy já feito.',
    });
    return;
  }

  // Peças visíveis: nada aqui é segredo, e é o que o operador precisa conferir
  // a olho. A senha nunca aparece, nem mascarada — mascarar já é dizer o
  // tamanho dela.
  const pecas = porPartes
    ? { referencia: valor('NFE_DB_REF'), host: valor('NFE_DB_HOST'),
        porta: valor('NFE_DB_PORT') || '6543', banco: valor('NFE_DB_NAME') || 'postgres' }
    : (() => {
      try {
        const u = new URL(url);
        return { host: u.hostname, porta: u.port || '5432', banco: u.pathname.replace('/', '') };
      } catch { return { host: '(não foi possível ler a URL)' }; }
    })();

  try {
    const storage = await getStorage();
    await storage.peekNumber('00000000000000', 'diagnostico');
    res.json({
      ok: storage.kind() === 'postgres',
      storage: storage.kind(),
      origem: porPartes ? 'partes (NFE_DB_PASSWORD + NFE_DB_REF + NFE_DB_HOST)'
        : (valor('NFE_DB_URL') ? 'NFE_DB_URL' : 'POSTGRES_URL'),
      pecas,
      variaveis,
    });
  } catch (err: any) {
    const cru = String(err?.message ?? err);
    const traduzido = explicarErroDeBanco(cru);

    res.status(503).json({
      ok: false,
      storage: 'nao conectou',
      origem: porPartes ? 'partes' : (valor('NFE_DB_URL') ? 'NFE_DB_URL' : 'POSTGRES_URL'),
      pecas,
      variaveis,
      erro: cru,
      ...(traduzido ? { provavelCausa: traduzido } : {}),
    });
  }
});

// GET /api/importar-modelo — baixar modelo XLSX (sem auth, é só template)
app.get('/api/importar-modelo', (_req, res) => {
  const XLSX = require('xlsx');
  const colunas = [
    { codigo: 'PROD001', descricao: 'Camiseta algodao', ncm: '61091000', cfop: '5102', unidade: 'UN', valorUnitario: '49.90', cstCsosn: '102', aliqIcms: '', cest: '', mva: '', aliqIcmsSt: '', origem: '0' },
    { codigo: 'PROD002', descricao: 'Calca jeans', ncm: '62034200', cfop: '5102', unidade: 'UN', valorUnitario: '129.90', cstCsosn: '102', aliqIcms: '', cest: '', mva: '', aliqIcmsSt: '', origem: '0' },
  ];
  const ws = XLSX.utils.json_to_sheet(colunas);
  ws['!cols'] = [
    { wch: 12 }, { wch: 35 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 14 },
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 8 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  const xlsBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=modelo_importacao_produtos.xlsx');
  res.send(xlsBuf);
});

// ---------------------------------------------------------------------------
// Autenticação em três níveis:
// - senha mestra (WEBAPP_SENHA) → ADMIN: cadastra empresas, emite por qualquer uma
// - API Key `nfe_live_*` / `nfe_test_*` → tenant TRAVADO no CNPJ da chave
// - senha da empresa (hash no banco) + header x-empresa-cnpj → opera SÓ aquela empresa
//
// Nos dois últimos casos req.tenantCnpj fixa a empresa e resolveEmpresa passa a
// ignorar o header x-empresa-cnpj — é o que impede acesso cruzado entre clientes.
// ---------------------------------------------------------------------------
app.use('/api', async (req, res, next) => {
  const senha = process.env['WEBAPP_SENHA'];
  if (!senha) { (req as any).isAdmin = true; return next(); } // uso local sem senha
  const key = req.header('x-api-key');
  if (key === senha) { (req as any).isAdmin = true; return next(); }

  if (key && pareceApiKey(key)) {
    try {
      const keyStore = await getApiKeyStore();
      const ctx = await keyStore.validar(key);
      if (ctx) {
        (req as any).isAdmin = false;
        (req as any).tenantCnpj = ctx.empresaCnpj;
        (req as any).apiKeyEscopo = ctx.escopo;
        (req as any).apiKeyAmbiente = ctx.ambientePermitido;
        (req as any).apiKeyNome = ctx.nome;
        // O limitador de requisições lê `clientPlano` e ninguém o preenchia:
        // todo cliente caía no plano `free`, 10 requisições por minuto, fosse
        // qual fosse o que ele paga. Abrir uma listagem e baixar dois arquivos
        // já estourava, e o operador via "limite excedido" sem ter feito nada
        // demais.
        (req as any).clientPlano = await planoDoCliente(ctx.empresaCnpj);
        return next();
      }
    } catch { /* cai no 401 */ }
    res.status(401).json({ erro: 'API Key invalida ou revogada.' });
    return;
  }

  const cnpj = (req.header('x-empresa-cnpj') || '').replace(/\D/g, '');
  if (cnpj && key) {
    try {
      const store = await getEmpresaStore();
      const row = await store.obterRaw(cnpj);
      if (row?.ativa && row.senha_acesso_hash && verifySenha(key, row.senha_acesso_hash)) {
        (req as any).isAdmin = false;
        (req as any).tenantCnpj = cnpj;
        return next();
      }
    } catch { /* cai no 401 */ }
  }
  res.status(401).json({ erro: 'Nao autorizado. Informe a senha de acesso.' });
});

/**
 * Pool do limitador de requisições.
 *
 * Um pool próprio e pequeno (`max: 2`), criado uma vez: o limitador roda em
 * TODA requisição, e abrir conexão por requisição custaria mais que a consulta.
 * Sem `NFE_DB_URL` ele fica `undefined` e o limitador conta em memória — que é
 * o comportamento antigo, e continua sendo o certo em instalação sem banco.
 */
const poolDoLimitador = (() => {
  const dbUrl = urlDoBanco();
  if (!dbUrl) return undefined;
  try {
    const { Pool } = require('pg');
    const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
    return new Pool({
      connectionString: dbUrl,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: 2,
    });
  } catch {
    return undefined;
  }
})();

// Rate limiting por API Key / tenant — após autenticação.
// Conta no Postgres: em serverless, contar em memória dava a cada instância o
// próprio contador, e o teto efetivo virava o do plano vezes o número de
// instâncias vivas — furando o limite justamente no pico.
app.use('/api', createRateLimiter(poolDoLimitador));

// Registrar uso da API para clientes API
app.use('/api', (req, _res, next) => {
  const cnpj = (req as any).tenantCnpj;
  if (cnpj) {
    getApiClientStore().then(s => s.registrarUsoApi(cnpj)).catch(() => {});
  }
  next();
});

/**
 * Plano contratado do cliente, para o limitador de requisições.
 *
 * Em cache curto porque isto roda em TODA requisição autenticada por API Key —
 * uma consulta ao banco por chamada transformaria o limitador, que existe para
 * proteger o serviço, em carga sobre ele. Um minuto é tempo de sobra: mudança de
 * plano é evento raro e não precisa valer no mesmo segundo.
 */
const cachePlano = new Map<string, { plano: string; ate: number }>();

async function planoDoCliente(cnpj: string): Promise<string> {
  const agora = Date.now();
  const emCache = cachePlano.get(cnpj);
  if (emCache && agora < emCache.ate) return emCache.plano;

  let plano = 'free';
  try {
    const store = await getApiClientStore();
    plano = (await store.obter(cnpj))?.plano || 'free';
  } catch {
    // Banco indisponível cai no plano mais restrito: é o lado seguro para o
    // serviço, e o cache curto faz a correção chegar sozinha.
  }
  cachePlano.set(cnpj, { plano, ate: agora + 60_000 });
  return plano;
}

/**
 * URL base desta instalacao, deduzida da propria requisicao.
 *
 * Estava cravada como 'https://nfe-emissor.vercel.app' dentro da documentacao —
 * entao um cliente lendo os exemplos por qualquer outro dominio (preview da
 * Vercel, dominio proprio, localhost) copiava curl apontando para o lugar
 * errado. `x-forwarded-*` e o que o proxy da Vercel preenche.
 */
function baseUrl(req: express.Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0]!.trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'nfe-emissor.vercel.app').split(',')[0]!.trim();
  return `${proto}://${host}`;
}

/**
 * Faixa inicial do codigo IBGE por UF.
 *
 * O codigo do municipio comeca pelos dois digitos da UF — e a unica conferencia
 * que pega municipio de um estado com a UF de outro, combinacao que a SEFAZ
 * recusa e que ninguem enxerga lendo o cadastro.
 */
const IBGE_DA_UF: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
};

/**
 * Confere o destinatario antes de montar a nota, e devolve o motivo da recusa.
 *
 * Todos os erros abaixo tem a mesma forma: o dado para decidir ja esta na
 * requisicao, o XSD aceita, e quem recusa e a regra de negocio da SEFAZ — depois
 * de a nota ter sido montada, assinada e transmitida.
 *
 * A UF chega normalizada porque 'mg' e 'MG' eram estados diferentes para o
 * codigo: era a UF que decidia interna x interestadual, e minuscula fazia toda
 * venda dentro do estado virar interestadual.
 *
 * Devolve texto em vez de escrever na resposta para poder ser testada sozinha;
 * `conferirDestinatario` e a casca que transforma o texto em 400.
 */
export function erroDoDestinatario(dest: any): string | undefined {
  const uf = String(dest?.endereco?.uf ?? '').trim().toUpperCase();
  const indIEDest = String(dest?.indIEDest ?? '').trim();
  const ie = String(dest?.ie ?? '').trim();
  // ERP costuma gravar a palavra "ISENTO" na coluna da IE. Como texto ela
  // parece preenchida, mas nao e inscricao nenhuma — so os digitos valem.
  const ieDigitos = ie.replace(/\D/g, '');
  const cMun = String(dest?.endereco?.codigoMunicipio ?? '').replace(/\D/g, '');

  // Ausente nao pode virar a UF do emitente: era exatamente esse `|| emp.uf` que
  // transformava toda venda sem UF em operacao interna, forcando 5xxx/1xxx e
  // desligando o DIFAL. O dado nao estava em maos — e a ausencia dele estava
  // sendo tratada como se fosse uma resposta.
  if (dest?.endereco && typeof dest.endereco === 'object' && !uf) {
    return 'UF do destinatario ausente. Informe destinatario.endereco.uf — e ela que decide '
      + 'se a operacao e interna (CFOP 5xxx) ou interestadual (6xxx), e nao da para deduzir '
      + 'do emitente sem mudar o imposto.';
  }

  if (uf && uf !== 'EX' && !IBGE_DA_UF[uf]) {
    return `UF do destinatario invalida: "${dest?.endereco?.uf}". Use a sigla de 2 letras.`;
  }

  // indIEDest 1 diz "e contribuinte"; sem a IE, a SEFAZ recusa com 728 pedindo
  // um campo que o operador acha que nao precisava preencher.
  if (indIEDest === '1' && !ieDigitos) {
    return (ie ? `A Inscricao Estadual informada ("${ie}") nao tem digitos. ` : '')
      + 'Destinatario marcado como contribuinte de ICMS (indIEDest 1) mas sem Inscricao Estadual. '
      + 'Informe a IE, ou use indIEDest 2 (contribuinte isento de IE) '
      + 'ou indIEDest 9 (nao contribuinte, como consumidor final).';
  }
  // O inverso tambem rejeita: IE em quem se declarou nao contribuinte.
  if (indIEDest === '9' && ieDigitos) {
    return 'Destinatario marcado como NAO contribuinte (indIEDest 9) mas com Inscricao Estadual informada. '
      + 'Se ele e contribuinte, use indIEDest 1; se nao e, remova a IE.';
  }

  if (uf && cMun && IBGE_DA_UF[uf] && !cMun.startsWith(IBGE_DA_UF[uf]!)) {
    return `Codigo IBGE ${cMun} nao pertence a ${uf} — municipio de ${uf} comeca com ${IBGE_DA_UF[uf]}. `
      + 'E o codigo que a SEFAZ confere, nao o nome do municipio.';
  }

  return undefined;
}

/**
 * Campos de domínio fechado: aceita sinônimos, recusa o resto.
 *
 * São três campos que decidem coisas grandes — `tipoOperacao` manda no primeiro
 * dígito do CFOP, `finalidade` decide se a nota precisa referenciar outra,
 * `destino` liga o DIFAL — e qualquer string atravessava a montagem inteira até
 * virar rejeição de schema, que não diz o campo.
 *
 * Sinônimo é CORRIGIDO porque "entrada" é o que uma pessoa escreve, e a rota de
 * classificação já aceitava. Valor fora da tabela é RECUSADO nomeando os
 * válidos: adivinhar entre entrada e saída inverteria o sentido da nota.
 */
const DOMINIOS: Record<string, { validos: string[]; sinonimos: Record<string, string>; explica: string }> = {
  tipoOperacao: {
    validos: ['0', '1'],
    sinonimos: { entrada: '0', compra: '0', devolucao: '0', saida: '1', venda: '1', remessa: '1' },
    explica: '"0" = entrada (compra), "1" = saída (venda)',
  },
  finalidade: {
    validos: ['1', '2', '3', '4'],
    sinonimos: { normal: '1', complementar: '2', ajuste: '3', devolucao: '4', retorno: '4' },
    explica: '"1" = normal, "2" = complementar, "3" = ajuste, "4" = devolução',
  },
  destino: {
    validos: ['1', '2', '3'],
    sinonimos: {
      interna: '1', interestadual: '2', exterior: '3', exportacao: '3',
    },
    explica: '"1" = operação interna, "2" = interestadual, "3" = exterior',
  },
};

function normalizarDominios(body: any, res: express.Response): boolean {
  for (const [campo, regra] of Object.entries(DOMINIOS)) {
    const bruto = body[campo];
    if (bruto === undefined || bruto === null || bruto === '') continue;

    const texto = String(bruto).trim();
    if (regra.validos.includes(texto)) continue;

    // Sem acento e sem caixa: "Devolução" e "devolucao" são a mesma intenção.
    const chave = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (regra.sinonimos[chave]) {
      body[campo] = regra.sinonimos[chave];
      continue;
    }

    res.status(400).json({
      sucesso: false,
      erro: `${campo.toUpperCase()}_INVALIDO: "${bruto}" não é um valor de ${campo}. `
        + `Use ${regra.explica}.`,
      aceitos: regra.validos,
      tambemAceitos: Object.keys(regra.sinonimos),
    });
    return false;
  }
  return true;
}

/**
 * Confere os NCM da nota contra a tabela oficial, antes de transmitir.
 *
 * Falha ABERTO: sem banco, com a tabela vazia ou com a consulta quebrada, a
 * emissao segue. Uma conferencia que nao pode ser feita nao pode virar recusa —
 * seria trocar "nota rejeitada pela SEFAZ" por "ninguem emite".
 */
async function conferirNcms(itens: any, res: express.Response): Promise<boolean> {
  if (!Array.isArray(itens) || !itens.length) return true;

  let faltando: string[];
  try {
    const store = await getNcmStore();
    faltando = await store.inexistentes(itens.map((i: any) => String(i?.ncm ?? '')));
  } catch {
    return true;
  }
  if (!faltando.length) return true;

  const semNcm = new Set(faltando);
  // O numero do item e o que o operador precisa: numa nota de trinta produtos,
  // "NCM invalido" sem o item manda procurar.
  const ondeEsta = itens
    .map((it: any, i: number) => ({ item: i + 1, ncm: String(it?.ncm ?? '').replace(/\D/g, ''), descricao: it?.descricao }))
    .filter((x: any) => semNcm.has(x.ncm));

  res.status(400).json({
    sucesso: false,
    erro: ondeEsta.length === 1
      ? `NCM_INEXISTENTE: item ${ondeEsta[0].item} está com NCM ${ondeEsta[0].ncm}, `
        + 'que não existe na tabela oficial da NCM.'
      : `NCM_INEXISTENTE: ${ondeEsta.length} itens estão com NCM que não existe na tabela oficial.`,
    itens: ondeEsta,
    comoResolver: 'Consulte o código em GET /api/ncm/:codigo ou busque pela descrição do produto. '
      + 'O NCM não é corrigido automaticamente porque escolhê-lo é decisão de quem conhece a mercadoria.',
  });
  return false;
}

function conferirDestinatario(dest: any, res: express.Response): boolean {
  const erro = erroDoDestinatario(dest);
  if (!erro) return true;
  res.status(400).json({ erro });
  return false;
}

/**
 * CNPJ e CPF sao excludentes, e escolher um dos dois em silencio e o pior
 * desfecho que este sistema produz.
 *
 * O gerador escolhe o CNPJ no primeiro ramo do if e o CPF nunca chega ao XML.
 * Nao ha rejeicao: o documento sai AUTORIZADO no nome de outra pessoa, e so se
 * descobre no destinatario ou na apuracao — quando o conserto ja e cancelamento
 * ou carta de correcao.
 *
 * `documentoOpcional` separa os dois documentos: a NF-e exige documento do
 * destinatario, o cupom nao (consumidor nao identificado e o caso normal do
 * balcao). A frase muda; a regra e a mesma.
 *
 * Isto vive fora das rotas de proposito. A conferencia nasceu escrita a mao
 * dentro de `/api/emitir` e a rota irma nasceu sem ela — guarda copiada e
 * guarda que uma das copias vai esquecer.
 */
export function erroDeDocumentosExcludentes(
  dest: any,
  opts: { documentoOpcional: boolean },
): string | undefined {
  const temCnpj = String(dest?.cnpj ?? '').replace(/\D/g, '').length > 0;
  const temCpf = String(dest?.cpf ?? '').replace(/\D/g, '').length > 0;
  if (!temCnpj || !temCpf) return undefined;
  return 'Destinatario com "cnpj" E "cpf" preenchidos. Informe apenas um — sao excludentes, '
    + 'e adivinhar qual vale emitiria um documento valido no nome errado.'
    + (opts.documentoOpcional ? ' Para consumidor nao identificado, omita os dois.' : '');
}

/**
 * Serie fora de 0-889 volta como cStat 244 depois de o documento ter sido
 * montado e assinado — e a mensagem da SEFAZ nao diz qual e a faixa.
 *
 * 890-899 e Nota Fiscal Avulsa e 900-999 e emissao pelo Fisco/contingencia. O
 * projeto sabia a regra e a escrevia em tres lugares (title do input, /api/docs,
 * dica da tela); nenhum deles era codigo executavel.
 *
 * Precisa rodar ANTES da reserva de numero: numero reservado numa serie que
 * nunca vai emitir vira buraco na numeracao, e buraco so se fecha inutilizando.
 */
export function erroDeSerie(serie: unknown): string | undefined {
  const n = Number(String(serie ?? '1').replace(/\D/g, ''));
  if (Number.isFinite(n) && n <= 889) return undefined;
  return `Serie ${serie} fora da faixa de emissao normal. A SEFAZ reserva 890-999 para `
    + 'contingencia e recusa com cStat 244 ("Processo de Emissao incompativel com a Serie"). '
    + 'Use de 0 a 889 — o padrao das plataformas e 880.';
}

/**
 * O que responder quando a SEFAZ nao respondeu.
 *
 * Duas situacoes muito diferentes chegavam aqui como uma so, e a resposta era a
 * da pior delas:
 *
 * - **Nao sei se saiu** (timeout, conexao cortada no meio). A nota PODE estar
 *   autorizada. Reemitir as cegas gera duplicidade — e o numero esta gasto.
 * - **Nao saiu** (conexao recusada, DNS, servidor devolvendo indisponibilidade).
 *   A nota nao existe em lugar nenhum e o numero continua livre.
 *
 * Tratar o segundo como o primeiro custa caro na pratica: manda o operador
 * consultar uma chave que nunca existiu, e queima um numero por tentativa
 * durante uma queda que pode durar horas — cada numero queimado depois so se
 * fecha com inutilizacao.
 *
 * **Sobre contingencia.** A SEFAZ prevê desvio para servidor reserva (SVC), e
 * este emissor NAO o implementa — o codigo existe em `infrastructure/
 * contingencia` mas nao esta ligado ao caminho de emissao, e sem os campos
 * `dhCont`/`xJust` no XML a nota nem passaria no schema. Decisao consciente de
 * 17/08/2026: em vez de prometer um desvio que nao existe, dizer ao operador
 * que enquanto a SEFAZ estiver fora nao ha como autorizar. **Se um dia o SVC for
 * implementado, e aqui que a decisao entra** — este e o unico ponto do sistema
 * que sabe que a SEFAZ nao respondeu.
 */
export function respostaDeEnvioSemResposta(
  erro: unknown,
  ctx: {
    uf: string; chave: string; serie: string; numero: string;
    ambiente: string; documento: 'nota' | 'cupom';
  },
): { status: number; corpo: Record<string, unknown>; podeDevolverNumero: boolean } {
  const motivo = erro instanceof Error ? erro.message : String(erro);
  // Duck typing de proposito: quem marca e o SoapClient, mas qualquer cliente de
  // transporte (a NFS-e e REST, nao SOAP) pode marcar o mesmo campo.
  const naoSaiu = (erro as { naoTransmitiu?: boolean } | null)?.naoTransmitiu === true;
  const oDocumento = ctx.documento === 'cupom' ? 'o cupom' : 'a nota';

  if (naoSaiu) {
    return {
      status: 503,
      podeDevolverNumero: true,
      corpo: {
        sucesso: false,
        sefazIndisponivel: true,
        // Dito explicitamente para nao ser confundido com o 502: aqui NAO ha
        // duvida, e consultar a chave seria perda de tempo.
        indefinido: false,
        erro: `A SEFAZ de ${ctx.uf} nao respondeu. ${oDocumento[0]!.toUpperCase()}${oDocumento.slice(1)} `
          + 'NAO foi emitido e a numeracao continua livre.',
        comoResolver: 'Tente de novo em alguns minutos. Acompanhe por GET /api/status'
          + `?ambiente=${ctx.ambiente} — ele diz quando a SEFAZ de ${ctx.uf} voltar.`,
        // Sem isto o operador espera por um desvio automatico que nao existe.
        contingencia: 'Este emissor nao emite em contingencia (SVC): enquanto a SEFAZ estiver '
          + 'fora do ar nao ha como autorizar o documento.',
        serie: ctx.serie,
        numero: ctx.numero,
        ambiente: ctx.ambiente,
        detalhes: motivo,
      },
    };
  }

  return {
    status: 502,
    podeDevolverNumero: false,
    corpo: {
      sucesso: false,
      indefinido: true,
      erro: `Nao foi possivel confirmar o envio a SEFAZ. ${oDocumento[0]!.toUpperCase()}${oDocumento.slice(1)} `
        + 'PODE ter sido autorizado.',
      comoResolver: `Consulte GET /api/consultar?chave=${ctx.chave} antes de emitir de novo. `
        + 'Reemitir com o mesmo numero sem consultar gera duplicidade (cStat 539).',
      chaveAcesso: ctx.chave,
      serie: ctx.serie,
      numero: ctx.numero,
      ambiente: ctx.ambiente,
      detalhes: motivo,
    },
  };
}

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if ((req as any).isAdmin) return true;
  res.status(403).json({ erro: 'Apenas o administrador pode gerenciar empresas.' });
  return false;
}

/** Chave readonly não pode emitir, cancelar, inutilizar nem alterar cadastro. */
function bloqueiaEscrita(req: express.Request, res: express.Response): boolean {
  if ((req as any).apiKeyEscopo === 'readonly') {
    res.status(403).json({ erro: 'Esta API Key e somente leitura.' });
    return true;
  }
  return false;
}

/**
 * Resolve o ambiente da operação e valida contra a permissão da API Key.
 *
 * O ERP escolhe o ambiente a cada requisição; a chave define se aquela escolha é
 * autorizada. Uma chave de homologação não emite em produção nem quando a empresa
 * está cadastrada em produção — e é isso que impede nota fiscal real emitida por
 * engano durante o desenvolvimento do cliente.
 *
 * Sem API Key (admin ou senha da empresa) não há restrição: quem opera pelo
 * painel já escolhe o ambiente na própria tela.
 *
 * Retorna null quando bloqueou — nesse caso a resposta HTTP já foi enviada.
 */
function resolverAmbiente(
  req: express.Request,
  res: express.Response,
  ambienteEmpresa: string,
  pedido?: unknown,
): '1' | '2' | null {
  const pedidoStr = pedido === '1' || pedido === '2' ? pedido : null;
  const permitido = (req as any).apiKeyAmbiente as AmbientePermitido | undefined;

  // Sem pedido explícito, uma chave restrita usa o ambiente que ela pode — não o
  // da empresa. Assim o ERP que esquece o campo cai no lado seguro.
  const efetivo: '1' | '2' = pedidoStr
    ?? (permitido === 'homologacao' ? '2'
      : permitido === 'producao' ? '1'
      : (ambienteEmpresa === '1' ? '1' : '2'));

  if (permitido === 'homologacao' && efetivo === '1') {
    res.status(403).json({
      erro: 'Esta API Key so opera em homologacao. Para emitir em producao, solicite uma chave com essa permissao.',
      ambientePermitido: permitido,
      ambienteSolicitado: efetivo,
    });
    return null;
  }
  if (permitido === 'producao' && efetivo === '2') {
    res.status(403).json({
      erro: 'Esta API Key so opera em producao. Para testar, solicite uma chave de homologacao.',
      ambientePermitido: permitido,
      ambienteSolicitado: efetivo,
    });
    return null;
  }
  return efetivo;
}

// ---------------------------------------------------------------------------
// Cadastro de empresas (multi-tenant)
// ---------------------------------------------------------------------------
app.get('/api/empresas', async (req, res) => {
  try {
    const store = await getEmpresaStore();
    const todas = await store.listar();
    if ((req as any).isAdmin) {
      res.json(todas);
      return;
    }
    // Operador de empresa vê apenas a própria — pelo tenant autenticado, nunca
    // pelo header, que o cliente controla e poderia apontar para outro CNPJ.
    const cnpj = (req as any).tenantCnpj as string | undefined;
    res.json(cnpj ? todas.filter(e => e.cnpj === cnpj) : []);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/empresas', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const b = req.body;
    const obrigatorios = ['cnpj', 'razaoSocial', 'ie', 'crt', 'uf', 'ambiente', 'pfxBase64', 'pfxPassword'];
    const faltando = obrigatorios.filter(c => !b[c]);
    const e = b.endereco || {};
    const endObrigatorios = ['logradouro', 'numero', 'bairro', 'codigoMunicipio', 'nomeMunicipio', 'cep'];
    faltando.push(...endObrigatorios.filter(c => !e[c]).map(c => `endereco.${c}`));
    if (faltando.length) {
      res.status(400).json({ erro: 'Campos obrigatorios faltando: ' + faltando.join(', ') });
      return;
    }
    // Valida o certificado antes de salvar: tenta abrir o PFX com a senha
    try {
      const pfxBuffer = Buffer.from(b.pfxBase64, 'base64');
      new Signer(pfxBuffer, b.pfxPassword);
    } catch (certErr: any) {
      res.status(400).json({ erro: 'Certificado invalido ou senha do certificado incorreta: ' + certErr.message });
      return;
    }
    const store = await getEmpresaStore();
    await store.salvar({
      cnpj: b.cnpj,
      razaoSocial: b.razaoSocial,
      fantasia: b.fantasia || undefined,
      ie: b.ie,
      im: b.im || undefined,
      crt: b.crt,
      uf: b.uf,
      ambiente: b.ambiente,
      endereco: e,
      pfxBase64: b.pfxBase64,
      pfxPassword: b.pfxPassword,
      senhaAcesso: b.senhaAcesso || undefined,
    });
    res.json({ sucesso: true, cnpj: b.cnpj.replace(/\D/g, '') });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// CSC (NFC-e) — salva código de segurança do contribuinte
app.post('/api/empresas/:cnpj/csc', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { cscId, cscToken } = req.body;
    if (!cscId || !cscToken) {
      res.status(400).json({ erro: 'Campos obrigatorios: cscId, cscToken' });
      return;
    }
    const store = await getEmpresaStore();
    await store.salvarCsc(req.params.cnpj, cscId, cscToken);
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Verifica o credenciamento NF-e da empresa no cadastro OFICIAL da SEFAZ
// (CadConsultaCadastro4 — só existe em produção; é o registro que vale)
const CAD_CONSULTA_URLS: Record<string, string> = {
  MG: 'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
  SP: 'https://nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx',
  GO: 'https://nfe.sefaz.go.gov.br/nfe/services/CadConsultaCadastro4',
  MT: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/CadConsultaCadastro4',
  MS: 'https://nfe.sefaz.ms.gov.br/ws/CadConsultaCadastro4',
  PR: 'https://nfe.sefa.pr.gov.br/nfe/CadConsultaCadastro4',
  RS: 'https://cad.sefazrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  BA: 'https://nfe.sefaz.ba.gov.br/webservices/CadConsultaCadastro4/CadConsultaCadastro4.asmx',
  PE: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/CadConsultaCadastro4',
};

// POST /api/empresas/:cnpj/sincronizar-ie
//
// Compara a Inscrição Estadual do cadastro com a que a SEFAZ tem para o CNPJ e
// corrige quando divergem. IE errada derruba TODA emissão da empresa com
// cStat 231, e o erro não diz qual é a certa — só que a informada não vale.
//
// A fonte é a própria SEFAZ, então não há palpite: ou os números batem, ou o
// dela é o correto.
app.post('/api/empresas/:cnpj/sincronizar-ie', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const alvo = req.params.cnpj.replace(/\D/g, '');
    const store = await getEmpresaStore();
    const emp = await store.obterContexto(alvo);
    if (!emp) { res.status(404).json({ erro: 'Empresa nao cadastrada' }); return; }

    const url = CAD_CONSULTA_URLS[emp.uf];
    if (!url) {
      res.status(400).json({
        erro: `Consulta de cadastro indisponivel para ${emp.uf}. Confira a IE no portal da SEFAZ-${emp.uf}.`,
      });
      return;
    }

    const soapClient = new SoapClient({ timeout: 20000, pfxBuffer: emp.pfxBuffer, pfxPassword: emp.pfxPassword });
    const xml = `<ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons>`
      + `<xServ>CONS-CAD</xServ><UF>${emp.uf}</UF><CNPJ>${emp.cnpj}</CNPJ></infCons></ConsCad>`;
    const resp = await soapClient.send(xml, url, 'CadConsultaCadastro4');
    const get = (tag: string) => resp.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

    const ieOficial = (get('IE') || '').replace(/\D/g, '');
    const ieAtual = (emp.ie || '').replace(/\D/g, '');
    const cSit = get('cSit');

    if (!ieOficial) {
      res.status(400).json({
        erro: 'A SEFAZ nao devolveu a IE para este CNPJ. Verifique se a inscricao esta ativa.',
        situacao: cSit,
      });
      return;
    }

    if (ieOficial === ieAtual) {
      res.json({ sucesso: true, alterado: false, ie: ieAtual, mensagem: 'A IE do cadastro ja confere com a da SEFAZ.' });
      return;
    }

    await store.atualizarIe(alvo, ieOficial);
    res.json({
      sucesso: true,
      alterado: true,
      ieAnterior: ieAtual,
      ie: ieOficial,
      situacao: cSit === '1' ? 'IE ATIVA' : `cSit ${cSit}`,
      mensagem: 'IE corrigida com o valor da SEFAZ. Era esta a causa do cStat 231.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/empresas/:cnpj/municipio — corrige o código IBGE do município sem
// reenviar o certificado. Município inválido derruba toda emissão (cStat 270),
// e o painel não expõe edição de empresa; este é o irmão do sincronizar-ie.
app.patch('/api/empresas/:cnpj/municipio', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const alvo = req.params.cnpj.replace(/\D/g, '');
    const cod = String(req.body?.codigoMunicipio || '').replace(/\D/g, '');
    if (!/^\d{7}$/.test(cod)) {
      res.status(400).json({ erro: 'codigoMunicipio deve ter 7 digitos (codigo IBGE).' });
      return;
    }
    // Valida contra a tabela do IBGE: um codigo inexistente e justamente a causa
    // do cStat 270 que este endpoint conserta — nao adianta trocar por outro invalido.
    const mun = municipioPorCodigo(cod);
    if (!mun) {
      res.status(400).json({ erro: `Codigo IBGE ${cod} inexistente. Confira o municipio na tabela do IBGE.` });
      return;
    }

    const store = await getEmpresaStore();
    const emp = await store.obterContexto(alvo);
    if (!emp) { res.status(404).json({ erro: 'Empresa nao cadastrada' }); return; }
    if (mun.uf !== emp.uf) {
      res.status(400).json({
        erro: `O municipio ${mun.nome} e de ${mun.uf}, mas a empresa e de ${emp.uf}. Confira o codigo.`,
      });
      return;
    }

    const nome = mun.nome.toUpperCase();
    await store.atualizarMunicipio(alvo, cod, nome);
    res.json({
      sucesso: true,
      cnpj: alvo,
      codigoMunicipio: cod,
      nomeMunicipio: nome,
      mensagem: 'Municipio corrigido. Era esta a causa do cStat 270.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/empresas/:cnpj/crt — corrige o Código de Regime Tributário sem
// reenviar o certificado. A NT 2026.007 (12C21-20, produção 03/11/2026) rejeita
// a NF-e quando o CRT diverge do regime do CNPJ na Receita. Irmão do :cnpj/municipio.
app.patch('/api/empresas/:cnpj/crt', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const alvo = req.params.cnpj.replace(/\D/g, '');
    const crt = String(req.body?.crt || '').trim();
    if (!['1', '2', '3', '4'].includes(crt)) {
      res.status(400).json({ erro: 'crt deve ser 1 (Simples), 2 (Simples excesso), 3 (Normal) ou 4 (MEI).' });
      return;
    }
    const store = await getEmpresaStore();
    const emp = await store.obterContexto(alvo);
    if (!emp) { res.status(404).json({ erro: 'Empresa nao cadastrada' }); return; }
    await store.atualizarCrt(alvo, crt);
    res.json({
      sucesso: true,
      cnpj: alvo,
      crt,
      mensagem: 'CRT corrigido. Deve casar com o regime do CNPJ na Receita (regra 12C21-20).',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/empresas/:cnpj/credenciamento', async (req, res) => {
  try {
    const alvo = req.params.cnpj.replace(/\D/g, '');
    const tenant = (req as any).tenantCnpj as string | undefined;
    if (tenant && tenant !== alvo) {
      res.status(403).json({ erro: 'Empresa fora do escopo desta credencial.' });
      return;
    }
    const store = await getEmpresaStore();
    const emp = await store.obterContexto(alvo);
    if (!emp) { res.status(404).json({ erro: 'Empresa nao cadastrada' }); return; }
    const url = CAD_CONSULTA_URLS[emp.uf];
    if (!url) {
      res.json({ disponivel: false, orientacao: `Consulta automatica indisponivel para ${emp.uf}. Verifique no portal da SEFAZ-${emp.uf} (credenciamento de emissor NF-e) com o certificado da empresa.` });
      return;
    }
    const soapClient = new SoapClient({ timeout: 20000, pfxBuffer: emp.pfxBuffer, pfxPassword: emp.pfxPassword });
    const xml = `<ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>${emp.uf}</UF><CNPJ>${emp.cnpj}</CNPJ></infCons></ConsCad>`;
    const resp = await soapClient.send(xml, url, 'CadConsultaCadastro4');
    const get = (tag: string) => resp.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
    const cSit = get('cSit');
    const indCredNFe = get('indCredNFe');
    const credenciada = cSit === '1' && (indCredNFe === '1' || indCredNFe === '2' || indCredNFe === '3');
    res.json({
      disponivel: true,
      ieAtiva: cSit === '1',
      credenciadaNFe: credenciada,
      indCredNFe,
      situacao: cSit === '1' ? 'IE ATIVA' : `IE nao habilitada (cSit ${cSit || '?'})`,
      resumo: credenciada
        ? 'CREDENCIADA: a empresa PODE emitir NF-e em producao.'
        : (cSit === '1'
          ? `IE ATIVA. Atencao: o indicador de credenciamento (indCredNFe) da SEFAZ-${emp.uf} NAO e confiavel — costuma retornar "nao credenciado" mesmo para empresas que emitem normalmente. NAO trate isto como impedimento. Empresas ja em operacao sao credenciadas de oficio. A confirmacao real e emitir uma nota (teste em homologacao ou uma venda em producao): se a SEFAZ autorizar (cStat 100), esta tudo certo.`
          : 'IE irregular no cadastro (inscricao estadual pode estar suspensa/baixada). Confirme com o contador antes de emitir.'),
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/empresas/:cnpj/ambiente — troca homologação <-> produção.
//
// Existe como rota própria porque POST /api/empresas exige o .pfx inteiro: virar
// uma empresa para produção não deveria obrigar a reenviar o certificado.
//
// `resetarSerie` zera o contador de numeração de uma série. O contador é indexado
// por (cnpj, serie) e NÃO separa ambiente — um teste em homologação consome o
// número que a produção usaria. Só é aceito quando a empresa ainda não tem nota
// em produção naquela série, para nunca reabrir numeração já usada de verdade.
// ---------------------------------------------------------------------------
app.patch('/api/empresas/:cnpj/ambiente', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = (req.params.cnpj || '').replace(/\D/g, '');
    const ambiente = String(req.body?.ambiente || '');
    if (ambiente !== '1' && ambiente !== '2') {
      res.status(400).json({ erro: 'ambiente deve ser "1" (producao) ou "2" (homologacao)' });
      return;
    }

    const store = await getEmpresaStore();
    const row = await store.obterRaw(cnpj);
    if (!row) {
      res.status(404).json({ erro: `Empresa ${cnpj} nao cadastrada` });
      return;
    }

    const anterior = row.ambiente;
    await store.alterarAmbiente(cnpj, ambiente);

    const resposta: any = {
      sucesso: true,
      cnpj,
      razaoSocial: row.razao_social,
      ambienteAnterior: anterior,
      ambiente,
      aviso: ambiente === '1'
        ? 'Empresa em PRODUCAO: as proximas notas tem valor fiscal e juridico real.'
        : 'Empresa em HOMOLOGACAO: as notas nao tem valor fiscal.',
    };

    const serie = req.body?.resetarSerie != null ? String(req.body.resetarSerie) : null;
    if (serie) {
      const storage = await getStorage();
      // Zerar homologacao e sempre seguro: aquela numeracao nao vale fora do teste
      // e nao se cruza com a de producao. O contador de producao e que nao volta.
      const emitidas = ambiente === '1' ? await storage.contarNotasProducao(cnpj, serie) : 0;
      if (emitidas > 0) {
        resposta.resetarSerie = {
          serie,
          aplicado: false,
          motivo: `Existem ${emitidas} nota(s) em producao na serie ${serie}. Zerar o contador reabriria numeracao ja usada.`,
        };
      } else {
        await storage.resetSequencia(cnpj, serie, ambiente);
        resposta.resetarSerie = { serie, ambiente, aplicado: true, proximoNumero: 1 };
      }
    }

    res.json(resposta);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Keys por empresa — credencial de integração isolada por tenant
// ---------------------------------------------------------------------------

// POST /api/empresas/:cnpj/keys — gera chave (valor em claro aparece só aqui)
app.post('/api/empresas/:cnpj/keys', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const empresaStore = await getEmpresaStore();
    const empresa = await empresaStore.obterRaw(cnpj);
    if (!empresa?.ativa) {
      res.status(404).json({ erro: 'Empresa nao cadastrada ou inativa' });
      return;
    }
    const { nome, escopo, ambientePermitido } = req.body || {};
    const keyStore = await getApiKeyStore();
    const { chave, registro } = await keyStore.criar({
      empresaCnpj: cnpj,
      nome: String(nome || '').trim() || 'Integracao',
      ambiente: empresa.ambiente === '1' ? '1' : '2',
      escopo: escopo === 'readonly' ? 'readonly' : 'full',
      ambientePermitido: normalizarAmbientePermitido(ambientePermitido),
    });
    res.json({
      sucesso: true,
      chave,
      aviso: 'Guarde esta chave agora — ela nao pode ser exibida novamente.',
      registro,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/empresas/:cnpj/keys — lista chaves (só prefixo, nunca o valor)
app.get('/api/empresas/:cnpj/keys', async (req, res) => {
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const tenant = (req as any).tenantCnpj as string | undefined;
    if (!(req as any).isAdmin && tenant !== cnpj) {
      res.status(403).json({ erro: 'Empresa fora do escopo desta credencial.' });
      return;
    }
    const keyStore = await getApiKeyStore();
    res.json(await keyStore.listar(cnpj));
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/keys/:id — revoga chave
app.delete('/api/keys/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ erro: 'Id invalido' });
      return;
    }
    const keyStore = await getApiKeyStore();
    // Não-admin só revoga chaves da própria empresa (escopo aplicado na query).
    const escopoCnpj = (req as any).isAdmin ? undefined : (req as any).tenantCnpj;
    if (!escopoCnpj && !(req as any).isAdmin) {
      res.status(403).json({ erro: 'Nao autorizado.' });
      return;
    }
    const ok = await keyStore.revogar(id, escopoCnpj);
    if (!ok) {
      res.status(404).json({ erro: 'Chave nao encontrada, ja revogada ou fora do escopo.' });
      return;
    }
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/keys/:id/registro — apaga o registro da chave.
//
// Caminho separado do revogar de propósito: revogar é reversível de intenção
// (o histórico fica), apagar não deixa rastro. Um parâmetro opcional na mesma
// rota faria a exclusão acontecer por esquecimento.
// ---------------------------------------------------------------------------
app.delete('/api/keys/:id/registro', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ erro: 'Id invalido' });
      return;
    }
    const escopoCnpj = (req as any).isAdmin ? undefined : (req as any).tenantCnpj;
    if (!escopoCnpj && !(req as any).isAdmin) {
      res.status(403).json({ erro: 'Nao autorizado.' });
      return;
    }
    const keyStore = await getApiKeyStore();
    const removida = await keyStore.excluir(id, escopoCnpj);
    if (!removida) {
      res.status(404).json({ erro: 'Chave nao encontrada ou fora do escopo.' });
      return;
    }
    res.json({
      sucesso: true,
      removida,
      aviso: removida.estavaAtiva
        ? 'A chave estava ATIVA: qualquer integracao que a usava parou de funcionar agora.'
        : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/empresas/:cnpj/keys/revogadas — limpa de uma vez as já revogadas
app.delete('/api/empresas/:cnpj/keys/revogadas', async (req, res) => {
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const tenant = (req as any).tenantCnpj as string | undefined;
    if (!(req as any).isAdmin && tenant !== cnpj) {
      res.status(403).json({ erro: 'Empresa fora do escopo desta credencial.' });
      return;
    }
    const keyStore = await getApiKeyStore();
    const removidas = await keyStore.excluirRevogadas(cnpj);
    res.json({ sucesso: true, removidas });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete('/api/empresas/:cnpj', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getEmpresaStore();
    // Chaves da empresa morrem junto: senão continuariam autenticando um tenant morto.
    try {
      const keyStore = await getApiKeyStore();
      await keyStore.revogarTodas(req.params.cnpj);
    } catch { /* sem banco de chaves — segue a remoção */ }
    await store.remover(req.params.cnpj);
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/config — info pública do emitente (sem segredos)
// ---------------------------------------------------------------------------
app.get('/api/config', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    res.json({
      cnpj: emp.cnpj,
      razaoSocial: emp.razaoSocial,
      fantasia: emp.fantasia,
      ie: emp.ie,
      uf: emp.uf,
      crt: emp.crt,
      ambiente: emp.ambiente,
      municipio: emp.endereco.nomeMunicipio,
      admin: Boolean((req as any).isAdmin),
    });
  } catch (e: any) {
    res.status(503).json({ erro: `Emitente nao configurado: ${e.message}` });
  }
});

// ---------------------------------------------------------------------------
// Classificador fiscal (cérebro) + catálogo de produtos por empresa
// ---------------------------------------------------------------------------

// GET /api/ncm/buscar?q= — autocomplete de NCM por descrição
//
// Ordem das fontes: primeiro o que a casa já classificou, depois a tabela
// oficial. Se alguém já cadastrou aquele produto com um NCM, essa decisão vale
// mais que qualquer busca textual — foi tomada por quem conhece o produto.
app.get('/api/ncm/buscar', async (req, res) => {
  try {
    const q = String(req.query['q'] || '');
    const limite = Math.min(Number(req.query['limit']) || 8, 20);

    let store: NcmStore | null = null;
    try { store = await getNcmStore(); } catch { /* sem banco: cai no externo */ }

    if (store && await store.total() > 0) {
      const doCatalogo = await store.buscarNoCatalogo(q, 3);
      const jaTem = new Set(doCatalogo.map((i) => i.codigo));
      const oficiais = (await store.buscar(q, limite)).filter((i) => !jaTem.has(i.codigo));
      res.json({
        disponivel: true,
        fonte: 'base-propria',
        itens: [...doCatalogo, ...oficiais].slice(0, limite),
      });
      return;
    }

    // Base ainda não importada: mantém o comportamento antigo em vez de ficar
    // sem sugestão nenhuma.
    res.json({ disponivel: fiscalBrain.disponivel, fonte: 'externa', itens: await fiscalBrain.buscarNcm(q) });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/ncm/{codigo} — descrição oficial, para conferir o que foi digitado
app.get('/api/ncm/:codigo', async (req, res) => {
  try {
    const store = await getNcmStore();
    const item = await store.descrever(String(req.params.codigo));
    if (!item) { res.status(404).json({ erro: 'NCM nao encontrado na tabela oficial.' }); return; }
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/ncm/importar — baixa a tabela oficial do MDIC e recarrega a base
//
// O governo revisa a NCM periodicamente, então isto é para rodar de novo de
// tempos em tempos — não uma vez só.
app.post('/api/ncm/importar', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getNcmStore();
    const r = await store.importarOficial();
    res.json({
      sucesso: true,
      ...r,
      mensagem: `${r.total} codigos importados da tabela do MDIC, ${r.termos} termos indexados.`,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/ncm — estado da base
app.get('/api/ncm', async (_req, res) => {
  try {
    const store = await getNcmStore();
    const total = await store.total();
    res.json({
      total,
      atualizadoEm: await store.atualizadoEm(),
      pronta: total > 0,
      orientacao: total ? undefined : 'Base vazia. Rode POST /api/ncm/importar para carregar a tabela oficial.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/classificar?ncm=&uf=&regime=&operacao= — sugere a classificação fiscal do NCM
app.get('/api/classificar', async (req, res) => {
  try {
    const ncm = String(req.query['ncm'] || '').replace(/\D/g, '');
    if (ncm.length !== 8) { res.status(400).json({ erro: 'Informe ?ncm= com 8 digitos' }); return; }
    const emp = await resolveEmpresa(req);
    const uf = (String(req.query['uf'] || '') || emp.uf).toUpperCase();
    const regimeQ = String(req.query['regime'] || '');
    const regime = (regimeQ === 'simples' || regimeQ === 'normal')
      ? regimeQ
      : ((emp.crt === '1' || emp.crt === '2') ? 'simples' : 'normal');
    // `operacao` nomeia a natureza (venda_revenda, devolucao, transferencia...)
    // e `entrada=1` dá o sentido. Só que pedir `operacao=entrada` é a coisa mais
    // natural do mundo para quem integra, e isso caía no fallback em silêncio:
    // devolvia 5102 — CFOP de SAÍDA — a quem tinha dito, com todas as letras,
    // que a nota era de entrada. O erro só aparecia na rejeição 519 da SEFAZ.
    const SENTIDO_PELO_NOME: Record<string, boolean> = {
      entrada: true, compra: true, compras: true,
      saida: false, venda: false,
    };
    const operacaoQ = String(req.query['operacao'] || '').trim().toLowerCase();
    const sentidoPeloNome = SENTIDO_PELO_NOME[operacaoQ];
    const operacaoValida = TIPOS_OPERACAO.some(t => t.valor === operacaoQ);
    const operacao = (operacaoValida ? operacaoQ : 'venda_revenda') as TipoOperacaoFiscal;

    // 1) Regras locais (prioridade máxima): a da própria empresa vence a global
    let cls: any = null;
    try {
      const store = await getProdutoStore();
      cls = await store.buscarRegraComoClassificacao(ncm, uf, regime as 'simples' | 'normal', emp.cnpj);
    } catch { /* sem DB, segue */ }

    // 2) Base fiscal externa (FiscalBrain)
    if (!cls) {
      cls = await fiscalBrain.classificar(ncm, uf, regime as 'simples' | 'normal');
    }

    if (!cls) { res.status(404).json({ erro: 'NCM nao encontrado no cerebro fiscal', disponivel: fiscalBrain.disponivel }); return; }

    // CFOP: a regra cadastrada para o NCM vence, porque é decisão humana sobre
    // aquele produto. Só é sobrescrita quando quem chama pede uma operação
    // específica — aí o CFOP é da operação, não do produto.
    //
    // Antes o resolverCfop sobrescrevia sempre, e a regra do usuário era
    // descartada em silêncio: cadastrava CFOP 5949 e a classificação devolvia
    // 5102 sem dizer por quê.
    const interestadual = req.query['interestadual'] === '1';
    const entrada = sentidoPeloNome ?? (req.query['entrada'] === '1');
    const operacaoPedida = operacaoValida;
    const cfopDaRegra = cls.fonte === 'regra_local' ? String(cls.cfop || '') : '';

    // Valor irreconhecível não vira 404 — quebraria integração que já roda —
    // mas também não passa calado: quem pediu precisa saber que não foi atendido.
    if (operacaoQ && !operacaoValida && sentidoPeloNome === undefined) {
      cls.aviso = `Operacao "${operacaoQ}" nao reconhecida; classifiquei como "venda_revenda". `
        + `Validas: ${TIPOS_OPERACAO.map(t => t.valor).join(', ')} `
        + `(ou "entrada"/"saida" so para o sentido).`;
    }

    if (operacaoPedida || !cfopDaRegra) {
      cls.cfop = resolverCfop(operacao, { entrada, interestadual });
    } else {
      // Mantém a natureza escolhida na regra e só acerta o sentido/destino:
      // 5949 vira 6949 para fora do estado, 1949 numa entrada.
      cls.cfop = ajustarSentidoCfop(cfopDaRegra, { entrada, interestadual });
    }

    res.json(cls);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/tipos-operacao — lista os tipos de operação fiscal disponíveis
app.get('/api/tipos-operacao', (_req, res) => {
  res.json(TIPOS_OPERACAO);
});

// GET /api/cfop?operacao=&entrada=&interestadual= — resolve o CFOP correto
app.get('/api/cfop', (req, res) => {
  const operacao = (String(req.query['operacao'] || 'venda_revenda')) as TipoOperacaoFiscal;
  const entrada = req.query['entrada'] === '1' || req.query['entrada'] === 'true';
  const interestadual = req.query['interestadual'] === '1' || req.query['interestadual'] === 'true';
  res.json({ cfop: resolverCfop(operacao, { entrada, interestadual }), operacao, entrada, interestadual });
});

// GET /api/produtos/sugestoes?ncm=&q= — efeito rede: produtos de OUTRAS empresas como sugestão
app.get('/api/produtos/sugestoes', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const store = await getProdutoStore();
    const ncm = String(req.query['ncm'] || '').replace(/\D/g, '');
    const q = String(req.query['q'] || '');
    const sugestoes = await store.buscarCompartilhado(emp.cnpj, q || ncm, 8);
    res.json(sugestoes);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// Regras fiscais locais (para o contador alimentar via UI)
// ---------------------------------------------------------------------------
/**
 * Regras fiscais: o administrador mantém as globais, cada empresa mantém as
 * suas. A regra da empresa tem prioridade na classificação e não é visível
 * nem alterável por outra — a tabela é compartilhada, o escopo não.
 *
 * `escopoRegra` devolve o CNPJ quando quem chama é uma empresa, e undefined
 * para o administrador (que opera no espaço global).
 */
async function escopoRegra(req: express.Request): Promise<string | undefined> {
  if ((req as any).isAdmin) return undefined;
  const emp = await resolveEmpresa(req);
  return emp.cnpj;
}

app.get('/api/regras-fiscais', async (req, res) => {
  try {
    const store = await getProdutoStore();
    // Sem `uf`, a UF é a da empresa — não 'SP'. O default fixo entregava as
    // regras paulistas a quem é de outro estado, e uma alíquota de ICMS de outra
    // UF não dá erro nenhum: vira nota autorizada com o imposto errado.
    const emp = await resolveEmpresa(req).catch(() => null);
    const uf = String(req.query['uf'] || emp?.uf || 'SP').toUpperCase();
    // Admin vê o acervo global; empresa vê as suas mais as globais.
    res.json(await store.listarRegras(uf, await escopoRegra(req)));
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/regras-fiscais', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const b = req.body;
    if (!b.ncm || !b.uf) { res.status(400).json({ erro: 'ncm e uf obrigatorios' }); return; }
    const store = await getProdutoStore();
    const escopo = await escopoRegra(req);
    // O campo se chama `cfopSaida`; guardar 1102 nele e guardar uma compra num
    // lugar que diz venda. Corrige e conta, em vez de aceitar calado.
    const cfopCadastro = cfopDeCadastro(b.cfopSaida);
    const regra = await store.salvarRegra(
      { ...b, ...(cfopCadastro.cfop ? { cfopSaida: cfopCadastro.cfop } : {}) },
      escopo,
    );
    registrarAudit(escopo ? 'empresa' : 'admin', 'regra_fiscal.salva', 'regra_fiscal', {
      empresaCnpj: escopo, entityId: String(regra.id ?? ''), requestId: (req as any).requestId,
    });
    res.json({
      sucesso: true,
      regra,
      ...(cfopCadastro.ajuste ? { cfopAjustado: cfopCadastro.ajuste } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete('/api/regras-fiscais/:id', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const store = await getProdutoStore();
    const escopo = await escopoRegra(req);
    const removeu = await store.removerRegra(Number(req.params.id), escopo);
    if (!removeu) {
      // Empresa tentando apagar regra global ou de outro cliente cai aqui.
      res.status(404).json({ erro: 'Regra nao encontrada ou fora do seu escopo.' });
      return;
    }
    registrarAudit(escopo ? 'empresa' : 'admin', 'regra_fiscal.removida', 'regra_fiscal', {
      empresaCnpj: escopo, entityId: req.params.id, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/produtos  (?q= = autocomplete na emissao) — catálogo da empresa
app.get('/api/produtos', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const store = await getProdutoStore();
    const q = String(req.query['q'] || '');
    res.json(q ? await store.buscar(emp.cnpj, q) : await store.listar(emp.cnpj));
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/produtos — cadastra/atualiza produto (fiscal ja resolvido)
app.post('/api/produtos', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    if (!b.descricao || !String(b.ncm || '').replace(/\D/g, '')) {
      res.status(400).json({ erro: 'Campos obrigatorios: descricao, ncm' });
      return;
    }
    const store = await getProdutoStore();
    // O catalogo guarda o CFOP da VENDA. 1102 aqui e compra, nao venda — a
    // emissao conserta na hora de montar o XML, mas o cadastro ficaria errado
    // para sempre e a tela mostraria um CFOP diferente do que sai na nota.
    const cfopCadastro = cfopDeCadastro(b.cfop || '5102');
    const salvo = await store.salvar({
      empresaCnpj: emp.cnpj,
      codigo: String(b.codigo || '').trim() || String(Date.now()).slice(-6),
      descricao: b.descricao,
      ean: b.ean || undefined,
      ncm: b.ncm,
      cest: b.cest || undefined,
      cfop: cfopCadastro.cfop || '5102',
      unidade: b.unidade || 'UN',
      valorUnitario: b.valorUnitario || undefined,
      origem: b.origem || '0',
      cstCsosn: b.cstCsosn || (emp.crt === '3' ? '00' : '102'),
      aliqIcms: b.aliqIcms || undefined,
      redBcIcms: b.redBcIcms || undefined,
      cstIpi: b.cstIpi || '53',
      aliqIpi: b.aliqIpi || undefined,
      cstPis: b.cstPis || '99',
      cstCofins: b.cstCofins || '99',
      mva: b.mva || undefined,
      aliqIcmsSt: b.aliqIcmsSt || undefined,
      cbenef: b.cbenef || undefined,
      ibscbsCst: b.ibscbsCst || undefined,
      ibscbsCclasstrib: b.ibscbsCclasstrib || undefined,
      ibscbsPRedAliq: b.ibscbsPRedAliq || undefined,
    });
    res.json({
      sucesso: true,
      produto: salvo,
      ...(cfopCadastro.ajuste ? { cfopAjustado: cfopCadastro.ajuste } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/produtos/:id — desativa produto
app.delete('/api/produtos/:id', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const store = await getProdutoStore();
    await store.remover(Number(req.params.id), emp.cnpj);
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/status — StatusServico SEFAZ
// ---------------------------------------------------------------------------
/**
 * GET /api/me — quem sou eu, com esta chave.
 *
 * Faltava, e a falta obrigava o integrador a adivinhar ou a perguntar por
 * e-mail: com que CNPJ a chave emite, que documentos ele contratou, se pode
 * emitir em produção ou só em homologação, quanto da cota já gastou, quantas
 * requisições por minuto tem. Tudo isso o servidor sabe no instante em que
 * autentica a requisição.
 *
 * É também o primeiro endpoint a chamar num "smoke test" de integração: se ele
 * responde, a credencial está viva e o ERP já sabe o que pode fazer. Não gasta
 * cota, não fala com a SEFAZ.
 */
app.get('/api/me', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const plano = planoDe(await planoDoCliente(emp.cnpj));

    let servicos: string[] = [];
    try {
      const store = await getClientServiceStore();
      servicos = await store.obterAtivos(emp.cnpj);
    } catch { /* sem cadastro de serviços: a lista fica vazia, não inventa */ }

    let uso: { emitidas: number; limite: number; restante: number | null } | undefined;
    try {
      const billing = await getBillingStore();
      const b = await billing.obterOuCriar(emp.cnpj);
      uso = {
        emitidas: b.notasMes,
        limite: plano.limiteNotas,
        restante: plano.limiteNotas > 0 ? Math.max(0, plano.limiteNotas - b.notasMes) : null,
      };
    } catch { /* sem billing: omite em vez de mentir um número */ }

    // `ambientePermitido` é da CHAVE, não da empresa: é ele que decide se um
    // POST com ambiente 1 passa ou volta 403.
    const ambienteChave = (req as any).apiKeyAmbiente as string | undefined;

    res.json({
      empresa: {
        cnpj: emp.cnpj,
        razaoSocial: emp.razaoSocial,
        uf: emp.uf,
        crt: emp.crt,
        // Quem usa CSOSN é CRT 1 e 4; CRT 2 e 3 usam CST. O integrador precisa
        // saber disso para preencher o item, e errar volta como 590/591.
        codigoIcms: (emp.crt === '1' || emp.crt === '4') ? 'CSOSN' : 'CST',
      },
      credencial: {
        nome: (req as any).apiKeyNome || undefined,
        escopo: (req as any).apiKeyEscopo || 'full',
        ambientePermitido: ambienteChave || emp.ambiente,
        ambientePadrao: emp.ambiente,
        admin: Boolean((req as any).isAdmin),
      },
      plano: {
        id: plano.id,
        nome: plano.nome,
        documentos: plano.documentos,
        webhooks: plano.webhooks,
        limiteNotasMes: plano.limiteNotas || null,
        requisicoesPorMinuto: plano.requestsPerMinute,
        requisicoesPorDia: plano.requestsPerDay || null,
      },
      servicosContratados: servicos,
      ...(uso ? { usoDoMes: uso } : {}),
      documentacao: `${baseUrl(req)}/api/docs`,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// A logomarca que sai impressa no DANFE
//
// O quadro do emitente no DANFE tem espaco reservado para a logo desde sempre,
// e a biblioteca que o desenha sabe preenche-lo. O que faltava era de onde
// tirar a imagem: o XML da NF-e nao carrega figura nenhuma. Resultado — toda
// nota de todo cliente saia com aquele espaco vazio, justamente no documento
// que o cliente entrega ao cliente DELE.
//
// Resolvido pela empresa do pedido, e nao por um CNPJ no caminho: assim a
// mesma rota serve ao painel (que escolhe a empresa no topo) e a plataforma do
// cliente (que so alcanca a propria, pela chave de API).
// ---------------------------------------------------------------------------
/**
 * De quem são os parâmetros que esta requisição pede.
 *
 * Não usa `resolveEmpresa` porque ela resolve quem pode EMITIR: sem certificado
 * ou com cadastro fiscal incompleto, ela lança. E é justamente o cliente recém
 * criado — ainda sem certificado — que se quer configurar antes da primeira
 * nota. Configurar a logo não depende de poder emitir.
 *
 * A ordem protege o isolamento: quando a chave de API prende o pedido a um
 * CNPJ (`tenantCnpj`), esse valor vence, e o cliente não alcança a marca de
 * outro nem mandando o cabeçalho.
 */
async function cnpjDosParametros(req: express.Request): Promise<string> {
  const travado = (req as any).tenantCnpj as string | undefined;
  if (travado) return String(travado).replace(/\D/g, '');
  const doHeader = (req.header('x-empresa-cnpj') || '').replace(/\D/g, '');
  if (doHeader.length === 14) return doHeader;
  return (await resolveEmpresa(req)).cnpj;
}

app.get('/api/danfe/marca', async (req, res) => {
  try {
    const emp = { cnpj: await cnpjDosParametros(req) };
    const store = await getMarcaDoDanfeStore();
    if (!store) { res.json({ configurada: false, motivo: 'sem banco' }); return; }
    const marca = await store.obter(emp.cnpj);
    // A imagem VAI no corpo: a tela precisa mostrar a previa do que sera
    // impresso, e mandar so "tem logo" obrigaria a uma segunda rota.
    res.json({
      configurada: Boolean(marca?.logoBase64 || marca?.textoPadrao),
      ...(marca ? {
        logoBase64: marca.logoBase64,
        posicao: marca.posicao,
        textoPadrao: marca.textoPadrao,
        atualizadaEm: marca.atualizadaEm,
      } : {}),
    });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

app.post('/api/danfe/marca', async (req, res) => {
  try {
    const emp = { cnpj: await cnpjDosParametros(req) };

    // Logo e texto são dois parâmetros independentes, salvos em abas
    // separadas. Um corpo que traz só um deles não pode apagar o outro — daí
    // `undefined` em vez de string vazia quando o campo nem veio.
    const veioLogo = req.body?.logoBase64 !== undefined || req.body?.logo !== undefined;
    const logo = veioLogo ? String(req.body?.logoBase64 ?? req.body?.logo ?? '') : undefined;
    const veioTexto = req.body?.textoPadrao !== undefined;
    const texto = veioTexto ? String(req.body?.textoPadrao ?? '') : undefined;

    if (!veioLogo && !veioTexto && req.body?.posicao === undefined) {
      res.status(400).json({ erro: 'Nada para salvar: envie logoBase64, textoPadrao ou posicao.' });
      return;
    }
    // Logo vazia é remoção, não imagem inválida: é assim que a tela desfaz o
    // envio sem precisar de uma rota só para isso.
    const recusa = (logo ? conferirLogo(logo) : null) ?? conferirTextoPadrao(texto ?? '');
    if (recusa) { res.status(400).json(recusa); return; }

    const store = await getMarcaDoDanfeStore();
    if (!store) {
      res.status(503).json({ erro: 'Guardar os parametros do DANFE exige banco configurado (NFE_DB_URL).' });
      return;
    }
    await store.salvar(emp.cnpj, {
      logoBase64: logo,
      posicao: req.body?.posicao,
      textoPadrao: texto,
    });
    registrarAudit('admin', 'danfe.marca.salva', emp.cnpj, { requestId: (req as any).requestId });
    res.json({ sucesso: true, posicao: normalizarPosicao(req.body?.posicao) });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

app.delete('/api/danfe/marca', async (req, res) => {
  try {
    const emp = { cnpj: await cnpjDosParametros(req) };
    const store = await getMarcaDoDanfeStore();
    if (store) await store.remover(emp.cnpj);
    registrarAudit('admin', 'danfe.marca.removida', emp.cnpj, { requestId: (req as any).requestId });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    // ?ambiente=1|2 permite consultar o ambiente selecionado na UI (default: empresa)
    const ambienteQ = req.query['ambiente'] as string;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, ambienteQ);
    if (!ambiente) return;
    const cUF = UF_TO_IBGE[emp.uf] || '31';
    const pfxBuffer = emp.pfxBuffer;
    const soapClient = new SoapClient({ timeout: 15000, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);

    const xmlBody = `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${ambiente}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;

    const responseXml = await soapClient.send(xmlBody, endpoints.NfeStatusServico, 'NfeStatusServico');
    const cStatMatch = responseXml.match(/<cStat>(\d+)<\/cStat>/);
    const xMotivoMatch = responseXml.match(/<xMotivo>([^<]+)<\/xMotivo>/);

    res.json({
      online: cStatMatch?.[1] === '107',
      cStat: cStatMatch?.[1] || '?',
      xMotivo: xMotivoMatch?.[1] || 'Sem resposta',
      ambiente: ambiente === '1' ? 'PRODUCAO' : 'HOMOLOGACAO',
      // O que a credencial permite. A plataforma do cliente usa isso para decidir
      // se mostra o seletor de ambiente — oferecer uma opção que devolve 403 é
      // pior do que não oferecer nenhuma.
      ambientePermitido: (req as any).apiKeyAmbiente ?? 'ambos',
    });
  } catch (err: any) {
    res.json({
      online: false, cStat: 'ERRO', xMotivo: err.message, ambiente: '?',
      // Vai também no caminho de falha: a permissão da credencial não depende da
      // SEFAZ estar no ar, e é ela que decide se a tela mostra o seletor de
      // ambiente. Omitir aqui fazia o seletor sumir sempre que a SEFAZ oscilava.
      ambientePermitido: (req as any).apiKeyAmbiente ?? 'ambos',
    });
  }
});

// ---------------------------------------------------------------------------
// Normaliza itens/pagamento: aceita formato flat (ERP) ou aninhado (frontend)
// ---------------------------------------------------------------------------
/**
 * Converte número em formato brasileiro para o que decimal.js aceita.
 *
 *   "20,00"     -> "20.00"
 *   "1.234,56"  -> "1234.56"
 *   "20.00"     -> "20.00"   (já válido, passa intacto)
 *
 * A vírgula decide: quando existe, ela é o separador decimal e os pontos são de
 * milhar. Sem vírgula, o ponto já é o decimal.
 *
 * Necessário porque o campo da tela e boa parte dos ERPs brasileiros produzem
 * vírgula; sem a conversão o valor chega ao Decimal e derruba a emissão com
 * "[DecimalError] Invalid argument", sem dizer qual campo causou.
 */
function numeroFiscal(valor: unknown): string | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined;
  const s = String(valor).trim();
  if (!s) return undefined;
  return s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
}

/**
 * Resolve a alíquota interna da UF de DESTINO para cada item, pelo NCM.
 *
 * O DIFAL cobra a diferença entre a alíquota interna do estado de destino e a
 * interestadual. Essa alíquota interna é do PRODUTO naquele estado — cesta
 * básica e bebida não pagam o mesmo em lugar nenhum —, então uma alíquota fixa
 * para a nota inteira só acerta por acidente, e um 18% fixo para todos os
 * estados erra na maioria deles.
 *
 * A informação certa já existe no sistema: a tela de regras fiscais guarda
 * alíquota por (NCM, UF). Cadastrar a regra do estado para onde se vende passa a
 * valer DIFAL correto, sem tabela de alíquotas embutida no código — que
 * envelheceria em silêncio a cada mudança de lei estadual.
 *
 * Falha aberta: sem regra, o item fica sem alíquota resolvida e a rota avisa.
 */
async function aplicarAliquotaDestino(
  itens: any[],
  ufDest: string,
  empresaCnpj: string,
): Promise<{ itens: any[]; semRegra: string[] }> {
  const semRegra: string[] = [];
  try {
    const store = await getProdutoStore();
    const regras = await store.listarRegras(ufDest.toUpperCase(), empresaCnpj);
    const porNcm = new Map(regras.map(r => [String(r.ncm).replace(/\D/g, ''), r]));

    const resolvidos = itens.map((it) => {
      if (it?.pICMSUFDest) return it; // quem informou manda
      const ncm = String(it?.ncm ?? '').replace(/\D/g, '');
      const regra = ncm ? porNcm.get(ncm) : undefined;
      if (!regra?.aliqIcms) {
        if (ncm && !semRegra.includes(ncm)) semRegra.push(ncm);
        return it;
      }
      return {
        ...it,
        pICMSUFDest: percentualFiscal(regra.aliqIcms),
        ...(regra.fcp && !it?.pFCPUFDest ? { pFCPUFDest: percentualFiscal(regra.fcp) } : {}),
      };
    });
    return { itens: resolvidos, semRegra };
  } catch {
    // Banco fora do ar não pode impedir a emissão; o aviso da rota cobre.
    return { itens, semRegra: [] };
  }
}

/** Há frete cobrado na nota, no cabeçalho ou em qualquer item? */
function temFrete(body: any): boolean {
  const n = (v: unknown) => Number(String(v ?? '0').replace(',', '.')) || 0;
  return n(body?.frete) > 0
    || (Array.isArray(body?.itens) && body.itens.some((i: any) => n(i?.frete ?? i?.vFrete) > 0));
}

/**
 * Percentual no formato que o leiaute aceita: exatamente duas casas.
 *
 * O tipo TDec_0302 do XSD não aceita "7.5" — quer "7.50". Como a alíquota chega
 * crua do ERP, do catálogo ou de uma tabela do contador, `7.5` e `0` derrubavam
 * a emissão por schema, com a rejeição apontando o campo seguinte ao errado.
 */
function percentualFiscal(valor: unknown): string | undefined {
  const bruto = numeroFiscal(valor);
  if (bruto === undefined) return undefined;
  const n = Number(bruto);
  return Number.isFinite(n) ? n.toFixed(2) : bruto;
}

/** Aplica numeroFiscal aos campos numéricos de um item já no formato aninhado. */
function normalizarNumerosItem(it: any): any {
  const icms = it.icms ? {
    ...it.icms,
    pICMS: numeroFiscal(it.icms.pICMS),
    pRedBC: numeroFiscal(it.icms.pRedBC),
    pMVAST: numeroFiscal(it.icms.pMVAST),
    pICMSST: numeroFiscal(it.icms.pICMSST),
    vBCSTRet: numeroFiscal(it.icms.vBCSTRet),
    vICMSSTRet: numeroFiscal(it.icms.vICMSSTRet),
  } : it.icms;

  return {
    ...it,
    quantidade: numeroFiscal(it.quantidade) ?? '1',
    valorUnitario: numeroFiscal(it.valorUnitario) ?? '0',
    // Acessórios aceitam vírgula como o resto dos valores do item.
    desconto: numeroFiscal(it.desconto ?? it.vDesc),
    frete: numeroFiscal(it.frete ?? it.vFrete),
    seguro: numeroFiscal(it.seguro ?? it.vSeg),
    despesas: numeroFiscal(it.despesas ?? it.vOutro),
    icms,
    ipi: it.ipi ? { ...it.ipi, pIPI: numeroFiscal(it.ipi.pIPI) } : it.ipi,
  };
}

/**
 * Rateia desconto/frete/seguro/despesas informados no cabeçalho entre os itens,
 * proporcional ao valor de cada um.
 *
 * O leiaute só tem esses campos por item, e a SEFAZ exige que o total feche
 * exatamente com a soma deles. Ratear no servidor evita que cada integrador
 * invente o próprio arredondamento e receba rejeição por divergência de
 * centavo. A sobra da divisão vai para o último item, pelo mesmo motivo.
 */
export function ratearAcessorios(itens: any[], body: any): any[] {
  const CAMPOS: [string, string][] = [
    ['desconto', 'desconto'], ['frete', 'frete'],
    ['seguro', 'seguro'], ['despesas', 'despesas'],
  ];
  const totais = CAMPOS
    .map(([campo]) => [campo, new Decimal(numeroFiscal(body[campo]) ?? '0')] as const)
    .filter(([, v]) => v.gt(0));
  if (!totais.length || !itens.length) return itens;

  const valorDoItem = (it: any) =>
    new Decimal(it.quantidade || '0').times(new Decimal(it.valorUnitario || '0'));
  const somaItens = itens.reduce((acc, it) => acc.plus(valorDoItem(it)), new Decimal(0));
  if (somaItens.lte(0)) return itens;

  const saida = itens.map((it) => ({ ...it }));
  for (const [campo, total] of totais) {
    // MAIOR RESTO, e não "a sobra vai toda no último".
    //
    // Despejar a sobra no último item produz parte NEGATIVA quando os anteriores
    // arredondam para cima: 4 itens (três de R$ 1,00 e um de R$ 0,01) com
    // desconto de R$ 0,02 dava ['0.01','0.01','0.01','-0.01']. O XML saía com
    // <vDesc>-0.01</vDesc>, que o schema rejeita — e o operador não tinha como
    // ligar um erro de facet a um rateio de dois centavos.
    //
    // Aqui cada item leva o próprio quinhao truncado, e os centavos que sobram
    // são distribuídos um a um por quem tem o maior resto. A soma continua
    // fechando exatamente com o total, e nenhuma parte fica negativa.
    const bruto = saida.map(it => total.times(valorDoItem(it)).div(somaItens));
    const partes = bruto.map(v => v.toDecimalPlaces(2, Decimal.ROUND_DOWN));
    let sobraCentavos = total.minus(partes.reduce((a, b) => a.plus(b), new Decimal(0)))
      .times(100).round().toNumber();

    const porMaiorResto = bruto
      .map((v, i) => ({ i, resto: v.minus(partes[i]!) }))
      .sort((a, b) => b.resto.comparedTo(a.resto));
    for (let k = 0; sobraCentavos > 0 && k < porMaiorResto.length * 2; k++) {
      const alvo = porMaiorResto[k % porMaiorResto.length]!.i;
      partes[alvo] = partes[alvo]!.plus('0.01');
      sobraCentavos--;
    }

    saida.forEach((it, i) => {
      const jaTem = new Decimal(it[campo] ?? '0');
      // Valor por item informado pelo integrador soma ao rateio, não é substituído.
      it[campo] = jaTem.plus(partes[i]!).toFixed(2);
    });
  }
  return saida;
}

/**
 * Completa a classificação de IBS/CBS dos itens a partir do catálogo.
 *
 * O ERP não tem como saber essa classificação — ela é decisão da contabilidade
 * e vive no cadastro do produto. Sem isto, todo item sairia com o padrão de
 * tributação integral, o que está errado para isento, imune ou monofásico.
 *
 * Precedência: o que o item manda > o cadastro do produto > o padrão do motor.
 * Falha de consulta não derruba a emissão — cai no padrão, que é o caso da
 * grande maioria dos produtos.
 */
async function aplicarIbsCbsDoCatalogo(itens: any[], empresaCnpj: string): Promise<any[]> {
  const semClassificacao = itens.filter(it => !it.ibscbs?.cst && it.codigo);
  if (!semClassificacao.length) return itens;

  try {
    const store = await getProdutoStore();
    const mapa = await store.classificacaoIbsCbs(
      empresaCnpj,
      semClassificacao.map(it => String(it.codigo)),
    );
    if (!mapa.size) return itens;

    return itens.map(it => {
      if (it.ibscbs?.cst || !it.codigo) return it;
      const doCatalogo = mapa.get(String(it.codigo));
      if (!doCatalogo) return it;
      return { ...it, ibscbs: { ...(it.ibscbs || {}), ...doCatalogo } };
    });
  } catch {
    return itens; // sem catálogo disponível: segue com o padrão
  }
}

function normalizarItens(itens: any[], crt: string): any[] {
  return itens.map((it: any) => {
    if (it.icms) return normalizarNumerosItem(it); // já aninhado — só os números
    // ibscbs é opcional e já vem aninhado nos dois formatos — repassa como está
    // para o ERP poder sobrescrever CST/alíquotas sem migrar de formato.
    // Quem usa CSOSN e CRT 1 (Simples) e CRT 4 (MEI). O CRT 2 — Simples com
    // excesso de sublimite — usa CST, porque nele o ICMS deixou de ser recolhido
    // dentro do DAS (Res. CGSN 140/2018 art. 12) e passou a seguir as normas de
    // quem nao e optante. Estava como `1 || 2`, o inverso nos dois extremos:
    // roteava o CRT 2 para CSOSN (rejeicao 591) e o MEI para CST (rejeicao 590).
    const isSimples = crt === '1' || crt === '4';
    return {
      codigo: it.codigo,
      descricao: it.descricao,
      ncm: it.ncm,
      cfop: it.cfop,
      unidade: it.unidade || 'UN',
      quantidade: numeroFiscal(it.quantidade) ?? '1',
      valorUnitario: numeroFiscal(it.valorUnitario) ?? '0',
      ean: it.ean,
      cest: it.cest,
      cBenef: it.cBenef ?? it.cbenef ?? it.codigoBeneficio,
      desconto: numeroFiscal(it.desconto ?? it.vDesc),
      frete: numeroFiscal(it.frete ?? it.vFrete),
      seguro: numeroFiscal(it.seguro ?? it.vSeg),
      despesas: numeroFiscal(it.despesas ?? it.vOutro),
      icms: {
        origem: it.origem || '0',
        // `cstCsosn` é o nome que a classificação usa nos dois regimes — ela
        // devolve CSOSN para o Simples e CST para o normal, no mesmo campo. Ele
        // era lido só no ramo do Simples: uma empresa de regime normal que
        // repassasse a classificação inteira via ERP tinha o CST descartado em
        // silêncio e a nota saía como '00', tributada integralmente.
        ...(isSimples
          ? { csosn: it.cstIcms || it.csosn || it.cstCsosn || '102' }
          : { cst: it.cstIcms || it.cst || it.cstCsosn || '00', pICMS: percentualFiscal(it.aliqIcms) ?? '0' }),
        // `redBcIcms` é o nome que a classificação, o catálogo e a tela de
        // regras usam. Não estava aqui: quem repassasse a classificação inteira
        // tinha a redução de base descartada e pagava imposto sobre a base
        // cheia. Mesma família do `cstCsosn` logo acima.
        pRedBC: percentualFiscal(it.redBcIcms ?? it.redBc ?? it.pRedBC),
        pMVAST: percentualFiscal(it.mva ?? it.pMVAST),
        pRedBCST: percentualFiscal(it.redBcIcmsSt ?? it.pRedBCST),
        pICMSST: percentualFiscal(it.aliqIcmsSt ?? it.pICMSST),
      },
      ipi: { cst: it.cstIpi || '53', pIPI: percentualFiscal(it.aliqIpi) },
      pis: { cst: it.cstPis || '99' },
      cofins: { cst: it.cstCofins || '99' },
      ibscbs: it.ibscbs,
      notaReferenciada: it.notaReferenciada,
      itemReferenciado: it.itemReferenciado,
    };
  });
}

function normalizarPagamento(pag: any): any {
  // Ausente, isto estourava com "Cannot read properties of undefined (reading
  // 'formas')" — erro que não diz nada a quem integra pela API. O pagamento é
  // dado fiscal e não se inventa: recusa dizendo o que enviar.
  if (!pag || typeof pag !== 'object') {
    throw new Error(
      'PAGAMENTO_AUSENTE: informe "pagamento" na nota. '
      + 'Ex.: { "pagamento": { "forma": "01", "valor": "855.00" } } — '
      + 'formas comuns: 01 dinheiro, 03 cartao de credito, 04 cartao de debito, '
      + '15 boleto, 17 PIX, 90 sem pagamento.',
    );
  }
  if (pag.formas) {
    // Já aninhado — ainda assim converte os valores, que podem vir com vírgula.
    return {
      ...pag,
      formas: pag.formas.map((f: any) => ({ ...f, valor: numeroFiscal(f.valor) ?? '0' })),
      troco: numeroFiscal(pag.troco),
    };
  }
  return {
    formas: [{ tipo: pag.forma || '01', valor: numeroFiscal(pag.valor) ?? '0' }],
    troco: numeroFiscal(pag.troco),
  };
}

/**
 * Aceita `informacoesAdicionais` como string (texto livre) ou como objeto
 * { fisco, complementar }. Sem isto, uma string cai em buildNFe e some sem erro:
 * `.complementar` de uma string é undefined e o campo nunca chega ao XML.
 */
function normalizarInfoAdicionais(info: any): { fisco?: string; complementar?: string } | undefined {
  if (!info) return undefined;
  if (typeof info === 'string') {
    const texto = info.trim();
    return texto ? { complementar: texto } : undefined;
  }
  if (typeof info === 'object' && (info.fisco || info.complementar)) return info;
  return undefined;
}

/**
 * Junta o texto fixo do emitente ao que veio no pedido.
 *
 * É o mesmo par que a tela de Parâmetros configura junto da logo: um sai no
 * quadro do emitente, o outro no de informações complementares. Sem isto, a
 * frase que a empresa repete em toda nota — dados bancários, garantia, o aviso
 * que a contabilidade exige — teria de ser digitada a cada emissão, ou virar
 * regra dentro do ERP do cliente, que não é lugar dela.
 *
 * O texto do pedido vem primeiro porque é o específico daquela nota; o padrão
 * complementa. E a busca é protegida: banco fora do ar não pode impedir a
 * emissão por causa de um texto de rodapé.
 */
async function comTextoPadraoDoDanfe(
  info: { fisco?: string; complementar?: string } | undefined,
  cnpj: string,
): Promise<{ fisco?: string; complementar?: string } | undefined> {
  let padrao = '';
  try {
    const store = cnpj ? await getMarcaDoDanfeStore() : null;
    const marca = store ? await store.obter(cnpj) : null;
    padrao = String(marca?.textoPadrao ?? '').trim();
  } catch { /* sem o texto a nota sai igual a de antes — nao vale derrubar a emissao */ }
  if (!padrao) return info;

  const doPedido = String(info?.complementar ?? '').trim();
  return {
    ...(info ?? {}),
    complementar: doPedido ? `${doPedido} | ${padrao}` : padrao,
  };
}

// ---------------------------------------------------------------------------
// POST /api/emitir — emissão NF-e
// ---------------------------------------------------------------------------
app.post('/api/emitir', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  // Fora do `try` de proposito: `let` dentro do bloco nao e visivel no `catch`,
  // e e justamente no catch que a reserva precisa ser desfeita.
  let reserva: { cnpj: string; serie: string; numero: number; ambiente: '1' | '2' } | undefined;
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const body = req.body;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, body.ambiente);
    if (!ambiente) return;

    const simulando = querSimular(body.simular) || querSimular(req.query['simular']);

    // Verificar serviço contratado e billing (API clients)
    if ((req as any).tenantCnpj && !(req as any).isAdmin) {
      if (!await verificarServicoContratado(emp.cnpj, 'nfe')) {
        errorResponse(res, 'SERVICE_NOT_ENABLED', { service: 'nfe' }); return;
      }
      // `verificarBilling` INCREMENTA o uso, não apenas consulta. Sem a exceção
      // para a simulação, cada "ver prévia" consumia uma nota da cota do cliente
      // — ele pagaria por documento que nunca existiu, e a conta fecharia com um
      // número que o histórico não explica. A prévia não emite nada; não cobra.
      if (ambiente === '1' && !simulando) {
        const billing = await verificarBilling(emp.cnpj);
        if (!billing.permitido) {
          errorResponse(res, 'BILLING_REQUIRED', { usado: billing.usado, limite: billing.limite }); return;
        }
      }
    }

    // Barrar aqui dá um erro que diz o que fazer. Deixar passar dava
    // "Cannot read properties of undefined" num 500 — logo abaixo do tratamento
    // caprichado que o pagamento ausente já recebia.
    if (!body.destinatario || typeof body.destinatario !== 'object') {
      res.status(400).json({
        sucesso: false,
        erro: 'Bloco "destinatario" ausente. Toda NF-e precisa dele — em nota de entrada ele e o fornecedor.',
        exemplo: {
          destinatario: {
            razaoSocial: '...', cnpj: '00000000000000', indIEDest: '9',
            endereco: {
              logradouro: '...', numero: '...', bairro: '...', codigoMunicipio: '0000000',
              nomeMunicipio: '...', uf: 'XX', cep: '00000000',
            },
          },
        },
      });
      return;
    }
    if (!body.destinatario.endereco || typeof body.destinatario.endereco !== 'object') {
      res.status(400).json({
        sucesso: false,
        erro: 'Bloco "destinatario.endereco" ausente. A SEFAZ exige o endereco completo do destinatario.',
        camposObrigatorios: ['logradouro', 'numero', 'bairro', 'codigoMunicipio', 'nomeMunicipio', 'uf', 'cep'],
      });
      return;
    }

    // Normalizar ANTES de calcular o destino, nao depois: 'mg' e 'MG' eram
    // estados diferentes para o codigo, e e a UF que decide se a operacao e
    // interna ou interestadual. Normalizar so na hora de montar o endereco
    // deixaria o XML bonito e a DIRECAO errada — CFOP 5102 reescrito para 6102,
    // DIFAL calculado numa venda dentro do proprio estado.
    if (body.destinatario?.endereco?.uf) {
      body.destinatario.endereco.uf = String(body.destinatario.endereco.uf).trim().toUpperCase();
    }
    if (!conferirDestinatario(body.destinatario, res)) return;

    // NCM que nao existe na tabela oficial.
    //
    // A conferencia de formato so mede o comprimento: '99999999' tem 8 digitos,
    // passa no XSD (o pattern e `[0-9]{2}|[0-9]{8}`) e so morre na SEFAZ, que
    // consulta a tabela real. E a tabela oficial do MDIC ESTA no proprio banco
    // — 13.745 codigos, com rota propria de consulta — e a emissao nunca a
    // usava. Um digito trocado numa planilha de importacao virava rejeicao em
    // vez de erro na previa.
    //
    // Nao corrige: escolher NCM e decisao de quem conhece o produto.
    if (!await conferirNcms(body.itens, res)) return;

    // `tipoOperacao: "entrada"` — o mais natural de mandar, e o que a rota de
    // classificacao ja teve de aprender a aceitar. Como o teste era
    // `=== '0'`, 'entrada' virava SAIDA: os CFOPs 1102 que o ERP mandou certos
    // eram reescritos para 5102, e o texto 'entrada' ia para <tpNF>. A SEFAZ
    // recusava por schema sem dizer o campo, e a previa aprovava porque so
    // conferia que a tag existe.
    if (!normalizarDominios(body, res)) return;

    const destRazao = ambiente === '2'
      ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
      : body.destinatario.razaoSocial;

    const ufDest = body.destinatario.endereco.uf;
    const destino = body.destino || calcularDestino(emp.uf, ufDest);

    // Devolução e complementar precisam apontar para a nota de origem. Barrar
    // aqui dá um erro que diz o que fazer; deixar passar retorna rejeição de
    // schema da SEFAZ, que não indica o campo faltante.
    const finalidade = body.finalidade || '1';
    const refs = body.notasReferenciadas ?? body.notaReferenciada;
    if ((finalidade === '4' || finalidade === '2') && !refs) {
      res.status(400).json({
        sucesso: false,
        erro: finalidade === '4'
          ? 'Devolucao (finalidade "4") exige a chave da nota original em "notaReferenciada".'
          : 'Nota complementar (finalidade "2") exige a chave da nota original em "notaReferenciada".',
        exemplo: { finalidade, notaReferenciada: '<44 digitos da chave de acesso original>' },
      });
      return;
    }

    // Na NF-e o documento do destinatario é obrigatório: não existe nota de
    // venda para "consumidor não identificado" como no cupom.
    const erroDocsNfe = erroDeDocumentosExcludentes(body.destinatario, { documentoOpcional: false });
    if (erroDocsNfe) {
      res.status(400).json({
        sucesso: false,
        erro: erroDocsNfe,
        recebido: { cnpj: body.destinatario.cnpj, cpf: body.destinatario.cpf },
      });
      return;
    }

    const erroSerieNfe = erroDeSerie(body.serie);
    if (erroSerieNfe) {
      res.status(400).json({ sucesso: false, erro: erroSerieNfe });
      return;
    }

    // Número da nota: quando o ERP não manda, o Emissor sabe qual é o próximo.
    //
    // Cair em '1' fazia TODA emissão sem o campo sair como nota 1 — e a segunda
    // colidia com a primeira (cStat 539, duplicidade). O contador já existe e é
    // por série e por ambiente; só ninguém o consultava aqui. Numeração não é
    // dado que o ERP conheça melhor: quem registra o que já foi usado é o
    // Emissor.
    const serieNota = String(body.serie ?? '1').replace(/\D/g, '') || '1';
    const numeroPedido = String(body.numero ?? '').replace(/\D/g, '');
    // Sem numero informado, RESERVA em vez de so espiar: `peekNumber` le e soma
    // 1, entao duas emissoes simultaneas recebiam o MESMO numero e a segunda
    // voltava como duplicidade. `numeroReservado` guarda o que precisa ser
    // devolvido se a nota nao sair.
    let numeroReservado: number | undefined;
    if (!numeroPedido && !simulando) {
      numeroReservado = await (await getStorage()).reservarNumero(emp.cnpj, serieNota, ambiente);
      reserva = { cnpj: emp.cnpj, serie: serieNota, numero: numeroReservado, ambiente };
    }
    const numeroNota = numeroPedido
      || String(numeroReservado ?? await (await getStorage()).peekNumber(emp.cnpj, serieNota, ambiente));

    // O historico esta aqui e ninguem olhava: numero ja usado ia para a SEFAZ e
    // voltava como cStat 539, gastando uma ida e deixando o operador sem saber
    // que a nota anterior existia.
    if (numeroPedido && !simulando) {
      try {
        const jaExiste = await (await getStorage()).listNotas(emp.cnpj, 500);
        const conflito = jaExiste.find(n =>
          String(n.numero) === numeroNota && String(n.serie) === serieNota
          && String(n.ambiente ?? '1') === ambiente && n.status === 'AUTORIZADA');
        if (conflito) {
          res.status(400).json({
            sucesso: false,
            erro: `Numero ${numeroNota} da serie ${serieNota} ja foi usado nesta empresa e ambiente.`,
            chaveAcesso: conflito.chaveAcesso,
            comoResolver: 'Omita o campo `numero` e a API usa o proximo livre, ou consulte GET /api/proximo-numero.',
          });
          return;
        }
      } catch { /* sem historico disponivel: segue e deixa a SEFAZ decidir */ }
    }

    // Numa operação interestadual o ICMS próprio é limitado à alíquota
    // interestadual — 12%, 7% ou 4%, conforme a rota e a origem da mercadoria.
    // Mandar a alíquota interna (18%, por exemplo) volta como cStat 693 depois
    // de a nota ter sido montada, assinada e transmitida. O Emissor sabe as duas
    // pontas antes disso, e o teto é definido em lei, não estimado — então dá
    // para recusar dizendo qual é a alíquota certa.
    if (destino === '2') {
      const uf = String(ufDest || '').toUpperCase();
      for (const [i, it] of (Array.isArray(body.itens) ? body.itens : []).entries()) {
        const informada = Number(String(it?.aliqIcms ?? it?.icms?.pICMS ?? '0').replace(',', '.')) || 0;
        if (informada <= 0) continue;
        const teto = Number(getAliqInterestadual(emp.uf, uf, String(it?.origem ?? it?.icms?.origem ?? '0')));
        if (informada > teto) {
          res.status(400).json({
            sucesso: false,
            erro: `Item ${i + 1}: aliquota de ICMS ${informada}% e maior que a interestadual de ${teto}% `
              + `para a rota ${emp.uf} -> ${uf}. A SEFAZ recusa com cStat 693. `
              + `Use ${teto}% no ICMS proprio; a diferenca ate a aliquota interna do destino `
              + 'e o DIFAL, que o Emissor calcula sozinho.',
            aliquotaInformada: informada,
            aliquotaInterestadual: teto,
            item: i + 1,
          });
          return;
        }
      }
    }

    // O sentido do CFOP é consequência da nota, não escolha do ERP: acertar aqui
    // evita a rejeição 519 depois de a nota já ter sido assinada e transmitida.
    const { itens: itensNoSentido, ajustes: cfopAjustado } = corrigirSentidoCfop(
      normalizarItens(body.itens, emp.crt),
      { entrada: String(body.tipoOperacao ?? '1') === '0', destino: String(destino) },
    );

    // Completa a classificação de IBS/CBS pelo cadastro do produto antes de
    // montar a nota — o ERP não tem essa informação.
    const itensComIbsCbs = await aplicarIbsCbsDoCatalogo(
      ratearAcessorios(itensNoSentido, body),
      emp.cnpj,
    );

    // DIFAL: venda interestadual para consumidor final não contribuinte. Só nesse
    // caso vale procurar a alíquota interna do destino — nos demais, procurar
    // seria consulta ao banco sem consequência nenhuma.
    const indFinalEfetivo = body.indFinal || (body.destinatario?.indIEDest === '1' ? '0' : '1');
    const difalAplicavel = destino === '2'
      && (body.destinatario?.indIEDest ?? '9') === '9'
      && indFinalEfetivo === '1';

    const { itens: itensFinais, semRegra: ncmSemAliqDestino } = difalAplicavel && !body.pICMSUFDest
      ? await aplicarAliquotaDestino(itensComIbsCbs, ufDest, emp.cnpj)
      : { itens: itensComIbsCbs, semRegra: [] as string[] };

    const fiscalInput: FiscalContextInput = {
      emitente: {
        cnpj: emp.cnpj,
        razaoSocial: emp.razaoSocial,
        fantasia: emp.fantasia || undefined,
        ie: emp.ie,
        crt: emp.crt,
        endereco: {
          logradouro: emp.endereco.logradouro,
          numero: emp.endereco.numero,
          complemento: emp.endereco.complemento,
          bairro: emp.endereco.bairro,
          codigoMunicipio: emp.endereco.codigoMunicipio,
          nomeMunicipio: emp.endereco.nomeMunicipio,
          uf: emp.uf,
          cep: emp.endereco.cep,
          fone: emp.endereco.fone,
        },
      },
      destinatario: {
        cnpj: body.destinatario.cnpj || undefined,
        cpf: body.destinatario.cpf || undefined,
        razaoSocial: destRazao,
        indIEDest: body.destinatario.indIEDest || '9',
        ie: body.destinatario.ie || undefined,
        email: body.destinatario.email || undefined,
        endereco: body.destinatario.endereco,
      },
      itens: itensFinais,
      pagamento: normalizarPagamento(body.pagamento),
      serie: serieNota,
      numero: numeroNota,
      naturezaOperacao: body.naturezaOperacao || 'VENDA',
      dataEmissao: gerarDhEmi(),
      finalidade: body.finalidade || '1',
      notasReferenciadas: body.notasReferenciadas ?? body.notaReferenciada,
      tipoOperacao: body.tipoOperacao || '1',
      destino,
      // Consumidor final é quem não vai revender. Quem tem inscrição estadual
      // (indIEDest '1') compra para revenda — marcá-lo como consumidor final
      // liga o DIFAL numa operação que não o tem, e o imposto sai a maior.
      indFinal: body.indFinal || (body.destinatario?.indIEDest === '1' ? '0' : '1'),
      presenca: body.presenca || '1',
      ambiente,
      municipioFG: emp.endereco.codigoMunicipio,
      ufEmitente: emp.uf,
      // '9' é "sem ocorrência de transporte". Declarar isso numa nota que cobra
      // frete é uma contradição dentro do próprio XML. Havendo frete e ninguém
      // dizendo quem contratou, o caso normal é o emitente (CIF): é ele que está
      // cobrando o valor na nota.
      modFrete: body.modFrete || (temFrete(body) ? '0' : '9'),
      informacoesAdicionais: await comTextoPadraoDoDanfe(
        normalizarInfoAdicionais(body.informacoesAdicionais), emp.cnpj),
      pICMSUFDest: body.pICMSUFDest || undefined,
    };

    // Suposições que o servidor precisou fazer. Elas existiam antes — só eram
    // invisíveis. Um default fiscal que ninguém vê é indistinguível de uma
    // decisão consciente, e é assim que imposto errado passa despercebido.
    const avisos: string[] = [];
    if (!body.modFrete && temFrete(body)) {
      avisos.push('modFrete nao informado numa nota com frete: assumi "0" (frete por conta do emitente). '
        + 'Informe modFrete se o transporte for por conta do destinatario ou de terceiros.');
    }
    if (!body.indFinal && body.destinatario?.indIEDest === '1') {
      avisos.push('indFinal nao informado e o destinatario e contribuinte com IE: assumi "0" (nao e consumidor final). '
        + 'Isso evita cobrar DIFAL numa venda para revenda.');
    }
    if (difalAplicavel && !body.pICMSUFDest && ncmSemAliqDestino.length) {
      avisos.push(
        `DIFAL: nao ha regra fiscal cadastrada em ${ufDest} para o(s) NCM ${ncmSemAliqDestino.join(', ')}, `
        + 'entao a aliquota interna do destino caiu no padrao de 18%. Cadastre a regra do estado de destino '
        + 'em "Regras fiscais" (ou informe "pICMSUFDest" no item) para o DIFAL sair correto.',
      );
    }

    // 1. Build
    const nfe = buildNFe(fiscalInput);

    // 2. Access key
    const { chave, cDV } = generateAccessKey({
      cUF: nfe.ide.cUF,
      dhEmi: nfe.ide.dhEmi,
      cnpj: nfe.emit.CNPJ!,
      mod: nfe.ide.mod,
      serie: nfe.ide.serie,
      nNF: nfe.ide.nNF,
      tpEmis: nfe.ide.tpEmis,
      cNF: nfe.ide.cNF,
    });
    nfe.ide.cDV = cDV;

    // 3. XML
    const xmlGen = new XmlGenerator();
    const xml = xmlGen.generateInfNFe(nfe, chave);

    // 4. Validate
    //
    // O construtor sem argumento procura os schemas em todos os lugares onde
    // eles podem estar — no serverless o cwd não é a raiz do projeto.
    const validator = new XsdValidator();
    const estrutura = validator.validate(xml);
    // A conferência de presença de campo não vê ordem de elemento, padrão de
    // conteúdo nem enumeração — CEP com hífen, UF minúscula e IE onde o tipo não
    // aceita passavam por ela e voltavam da SEFAZ como cStat 225, que não diz o
    // campo. O schema oficial vê, e sempre esteve no projeto.
    const schema = await validator.validarSchema(xml);
    const validation = {
      valid: estrutura.valid && schema.valid,
      errors: [...estrutura.errors, ...schema.errors],
    };

    // Modo simulação: devolve a nota montada sem enviar à SEFAZ.
    //
    // Existe porque a rejeição por schema (cStat 225) não diz o campo, e sem o
    // XML em mãos o diagnóstico vira adivinhação. Não emite nada e não consome
    // numeração — é o que sustenta o botão "ver prévia" das plataformas.
    //
    // Vai depois da validação de propósito: uma prévia que não reprova o que a
    // SEFAZ reprovaria não serve para conferir nada. Devolve também o objeto
    // montado, para a tela mostrar os totais e impostos que vão de fato ser
    // enviados, em vez de recalculá-los por conta e divergir do que sai.
    // Aceitar só o booleano `true` fazia `simular: "true"` — o que sai de
    // qualquer formulário ou querystring — EMITIR DE VERDADE. Quem pediu prévia
    // recebia nota fiscal; nenhum erro, nenhum aviso.
    if (simulando) {
      res.json({
        simulacao: true,
        sucesso: validation.valid,
        ...(validation.valid ? {} : {
          erro: 'Falha na validacao XML',
          detalhes: validation.errors.map(e => e.message),
        }),
        // Diz se a conferência contra o schema oficial rodou de fato. Sem isto,
        // "passou" e "não deu para conferir" ficariam indistinguíveis.
        schemaValidado: schema.disponivel,
        ...(schema.disponivel ? {} : { schemaMotivo: schema.motivo }),
        ambiente,
        chaveAcesso: chave,
        numero: numeroNota,
        serie: serieNota,
        // Correção não pode ser silenciosa: o operador precisa ver que o CFOP
        // que ele mandou não é o que vai na nota, e por quê.
        ...(cfopAjustado.length ? { cfopAjustado } : {}),
        ...(avisos.length ? { avisos } : {}),
        nfe,
        xml,
      });
      return;
    }
    if (!validation.valid) {
      res.status(400).json({
        sucesso: false,
        erro: 'Falha na validacao XML',
        detalhes: validation.errors.map(e => e.message),
      });
      return;
    }

    // 5. Sign
    const pfxBuffer = emp.pfxBuffer;
    const signer = new Signer(pfxBuffer, emp.pfxPassword);
    const signedXml = signer.sign(xml, `NFe${chave}`);

    // 6. Envelope
    const loteId = Date.now().toString();
    const envelope = xmlGen.wrapEnvelope(signedXml, loteId);

    // 7. Send
    //
    // A partir daqui a nota PODE existir na SEFAZ mesmo que nada volte. Timeout
    // de rede não é "não emitiu": é "não sei". O catch geral devolvia 500 sem a
    // chave, e o operador ficava sem a única informação que resolveria — com
    // que consultar. Reemitir às cegas gera duplicidade (cStat 539).
    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);
    let responseXml: string;
    try {
      responseXml = await soapClient.send(envelope, endpoints.NfeAutorizacao, 'NfeAutorizacao');
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error('[transmissao] sem resposta da SEFAZ', {
        cnpj: emp.cnpj, chave, serie: serieNota, numero: numeroNota, ambiente, erro: motivo,
      });
      // 502 (nao sei) ou 503 (SEFAZ fora), conforme o que der para AFIRMAR — e
      // nao 500: o problema e do serviço de destino, e o cliente não deve
      // tratar como bug nosso nem repetir a emissão automaticamente.
      const resposta = respostaDeEnvioSemResposta(e, {
        uf: emp.uf, chave, serie: serieNota, numero: numeroNota, ambiente, documento: 'nota',
      });
      // Numero so volta para a fila quando se sabe que a nota nao saiu. Na
      // duvida ele fica gasto: devolver um numero que pode estar autorizado na
      // SEFAZ recria a duplicidade que a reserva existe para evitar.
      if (resposta.podeDevolverNumero && reserva) {
        await (await getStorage())
          .devolverNumero(reserva.cnpj, reserva.serie, reserva.numero, reserva.ambiente)
          .catch(() => { /* devolver e otimizacao: nao pode trocar o erro real */ });
      }
      // Ja tratado aqui: o catch de fora nao pode devolver o mesmo numero de novo.
      reserva = undefined;
      res.status(resposta.status).json(resposta.corpo);
      return;
    }

    // 8. Parse
    const parsed = parseAutorizacaoResponse(responseXml);

    if (parsed.protNFe && nfeAutorizada(parsed.protNFe.infProt.cStat)) {
      const prot = parsed.protNFe.infProt;

      // nfeProc (NFe assinada + protNFe) — arquivo oficial p/ arquivamento e DANFE homologado
      const nfeProcXml = montarNfeProc(signedXml, responseXml) ?? signedXml;

      try {
        const outDir = path.resolve('output');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `NFe_${chave}.xml`), nfeProcXml, 'utf-8');
      } catch { /* serverless */ }

      // DANFE PDF: sped-da oficial (serviço) com fallback pro gerador simplificado
      let danfeBase64: string | undefined;
      try {
        const pdfBuf = await gerarDanfePdf({ nfeProcXml, nfe, chave, nProt: prot.nProt, dhRecbto: prot.dhRecbto });
        danfeBase64 = pdfBuf.toString('base64');
      } catch { /* DANFE generation failure is non-blocking */ }

      // Persist: numeração avança + nota entra no histórico (com XML p/ re-download)
      //
      // Não bloquear a resposta está certo — a nota já foi autorizada e recusar
      // agora não a desautoriza. Perder o AVISO é que estava errado: um `catch`
      // vazio cobria as duas gravações, e a falha mais cara delas — o contador
      // não avançar — saía como sucesso limpo. A próxima emissão reusava o
      // número e voltava como duplicidade (cStat 539), sem ninguém entender.
      //
      // São duas falhas diferentes, com consequências diferentes, então são dois
      // try separados: uma custa duplicidade, a outra custa o XML.
      try {
        const storage = await getStorage();
        await storage.registerUsedNumber(emp.cnpj, serieNota, Number(numeroNota), ambiente);
      } catch (e) {
        avisos.push(
          `Nota AUTORIZADA, mas o contador local nao avancou (banco indisponivel). O proximo numero da `
          + `serie ${serieNota} ainda aponta para ${numeroNota}. Confirme antes de emitir de novo — `
          + `reusar o numero volta como duplicidade (cStat 539).`,
        );
        // Sem isto a reconciliação depois vira arqueologia: a nota existe na
        // SEFAZ e não existe aqui, e nada diz qual número foi consumido.
        console.error('[persistencia] contador nao avancou', {
          cnpj: emp.cnpj, serie: serieNota, numero: numeroNota, ambiente, chave,
          erro: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        const storage = await getStorage();
        await storage.saveNota({
          chaveAcesso: chave,
          empresaCnpj: emp.cnpj,
          numero: numeroNota,
          serie: serieNota,
          ambiente,
          destNome: body.destinatario?.razaoSocial || '',
          destDoc: body.destinatario?.cnpj || body.destinatario?.cpf || '',
          vNF: nfe.total.ICMSTot.vNF,
          protocolo: prot.nProt,
          dhRecbto: prot.dhRecbto,
          cStat: prot.cStat,
          status: 'AUTORIZADA',
          nfeJson: nfe,
          xml: nfeProcXml,
          emitidaEm: new Date().toISOString(),
        });
      } catch (e) {
        avisos.push(
          'Nota AUTORIZADA, mas nao entrou no historico (banco indisponivel). GUARDE O XML DESTA '
          + 'RESPOSTA: ele nao vai estar disponivel para baixar depois.',
        );
        console.error('[persistencia] nota nao salva no historico', {
          cnpj: emp.cnpj, chave, protocolo: prot.nProt,
          erro: e instanceof Error ? e.message : String(e),
        });
      }

      // Webhook: nota autorizada
      despacharWebhook(emp.cnpj, 'nfe.authorized', { chaveAcesso: chave, protocolo: prot.nProt, cStat: prot.cStat, valor: nfe.total.ICMSTot.vNF, serie: serieNota, numero: numeroNota }, ambiente);

      res.json({
        sucesso: true,
        chaveAcesso: chave,
        protocolo: prot.nProt,
        dhRecbto: prot.dhRecbto,
        cStat: prot.cStat,
        xMotivo: prot.xMotivo,
        alerta: prot.cStat === '120' ? (prot.xMsg || prot.xMotivo) : undefined,
        ...(cfopAjustado.length ? { cfopAjustado } : {}),
        ...(avisos.length ? { avisos } : {}),
        arquivo: `NFe_${chave}.xml`,
        xml: nfeProcXml,
        danfePdf: danfeBase64,
        // Onde buscar de novo, depois. O `danfePdf` acima chega uma vez só, na
        // resposta; quem precisa do documento amanhã precisa saber o caminho —
        // e o cliente tem direito ao XML e ao PDF de tudo que emitiu.
        downloads: {
          xml: `/api/nota/${chave}/xml`,
          pdf: `/api/nota/${chave}/danfe`,
        },
      });
    } else {
      const prot = parsed.protNFe?.infProt;
      // Webhook: nota rejeitada
      // Rejeicao nao queima numeracao — e a promessa que o contrato da API faz.
      // Como agora o numero e RESERVADO antes de transmitir, ele precisa voltar.
      // A devolucao so vale se ninguem passou por cima nesse meio-tempo.
      if (numeroReservado != null) {
        await (await getStorage()).devolverNumero(emp.cnpj, serieNota, numeroReservado, ambiente);
        reserva = undefined; // ja devolvido: o catch nao pode devolver de novo
      }

      despacharWebhook(emp.cnpj, 'nfe.rejected', { chaveAcesso: chave, cStat: prot?.cStat || parsed.cStat, xMotivo: prot?.xMotivo || parsed.xMotivo, serie: serieNota, numero: numeroNota }, ambiente);

      const cStat = prot?.cStat || parsed.cStat;
      const xMotivo = prot?.xMotivo || parsed.xMotivo;
      res.json({
        sucesso: false,
        chaveAcesso: chave,
        cStat,
        xMotivo,
        // `erro` repete o xMotivo de propósito. Todo integrador lê `erro` — é o
        // que este contrato promete — e sem ele a rejeição da SEFAZ chegava na
        // tela como texto genérico, escondendo justamente a única frase que diz
        // o que houve. O campo custa nada e evita um suporte por semana.
        erro: xMotivo ? `SEFAZ ${cStat}: ${xMotivo}` : 'A SEFAZ rejeitou a nota.',
        detalhes: xMotivo ? [xMotivo] : [],
      });
    }
  } catch (err: any) {
    // O numero foi reservado e a nota nao saiu: devolve, senao cada erro de
    // cadastro abriria um buraco na numeracao que so a inutilizacao fecha.
    if (reserva) {
      try {
        await (await getStorage()).devolverNumero(reserva.cnpj, reserva.serie, reserva.numero, reserva.ambiente);
      } catch { /* devolver e otimizacao, nao pode mascarar o erro original */ }
    }
    // Cadastro errado nao e falha do servidor. Com 500 o ERP entra em retry
    // por um dado que nunca vai se corrigir sozinho, e o operador so ve
    // "erro interno" no lugar da frase que diz o que consertar.
    res.status(err instanceof ErroDeDados ? 400 : 500).json({
      sucesso: false,
      erro: err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/emitir-nfce — emissão NFC-e (modelo 65)
// ---------------------------------------------------------------------------
function gerarQrCodeNFCe(chave: string, tpAmb: string, csc: string, idCsc: string): string {
  const crypto = require('crypto');
  const concat = `${chave}|2|${tpAmb}|${idCsc}${csc}`;
  const hash = crypto.createHash('sha1').update(concat).digest('hex');
  return `${chave}|2|${tpAmb}|${idCsc}|${hash}`;
}

app.post('/api/emitir-nfce', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  // Declarada FORA do try: dentro dele ela nao existe para o catch, e o catch e
  // justamente onde a devolucao precisa acontecer.
  let reservaNfce: { cnpj: string; serie: string; numero: number; ambiente: '1' | '2' } | undefined;
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const body = req.body;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, body.ambiente);
    if (!ambiente) return;

    // Declarado aqui, antes do gate de cota: e ele que decide se a requisicao
    // consome uma nota do plano.
    const simulando = querSimular(req.body?.simular) || querSimular(req.query['simular']);

    // Verificar serviço contratado e billing (API clients)
    if ((req as any).tenantCnpj && !(req as any).isAdmin) {
      if (!await verificarServicoContratado(emp.cnpj, 'nfce')) {
        errorResponse(res, 'SERVICE_NOT_ENABLED', { service: 'nfce' }); return;
      }
      // Mesma excecao da NF-e: `verificarBilling` INCREMENTA. Sem ela, cada
      // "ver previa" consumia uma nota da cota — o cliente pagaria por
      // documento que nunca existiu. A NF-e ja fazia certo; NFC-e ficou para
      // tras, e no balcao a previa e usada muito mais.
      if (ambiente === '1' && !simulando) {
        const billing = await verificarBilling(emp.cnpj);
        if (!billing.permitido) {
          errorResponse(res, 'BILLING_REQUIRED', { usado: billing.usado, limite: billing.limite }); return;
        }
      }
    }

    if (!emp.cscId || !emp.cscToken) {
      res.status(400).json({ sucesso: false, erro: 'CSC nao configurado para esta empresa. Va em Empresas e cadastre o CSC (Codigo de Seguranca do Contribuinte).' });
      return;
    }

    const destRazao = ambiente === '2'
      ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
      : (body.destinatario?.razaoSocial || undefined);

    // Cupom SEM documento nenhum continua valendo — consumidor nao identificado
    // e o caso normal do balcao. O que nao existe e cupom com os dois.
    const erroDocsNfce = erroDeDocumentosExcludentes(body.destinatario, { documentoOpcional: true });
    if (erroDocsNfce) {
      res.status(400).json({
        sucesso: false,
        erro: erroDocsNfce,
        recebido: { cnpj: body.destinatario?.cnpj, cpf: body.destinatario?.cpf },
      });
      return;
    }

    const erroSerieNfce = erroDeSerie(body.serie);
    if (erroSerieNfce) {
      res.status(400).json({ sucesso: false, erro: erroSerieNfce });
      return;
    }

    // Mesma regra da NF-e: numeracao e do Emissor, nao do ERP. No balcao isso
    // pesa mais ainda — a NFC-e sai em rajada, e toda venda sem o campo cairia
    // no numero 1.
    const serieNota = String(body.serie ?? '1').replace(/\D/g, '') || '1';
    const numeroPedido = String(body.numero ?? '').replace(/\D/g, '');
    // RESERVA em vez de so espiar. `peekNumber` le e soma 1, entao dois caixas
    // vendendo ao mesmo tempo recebiam o MESMO numero e o segundo cupom voltava
    // como duplicidade — na frente do cliente, no balcao.
    let numeroReservadoNfce: number | undefined;
    if (!numeroPedido && !simulando) {
      numeroReservadoNfce = await (await getStorage()).reservarNumero(emp.cnpj, serieNota, ambiente);
      reservaNfce = { cnpj: emp.cnpj, serie: serieNota, numero: numeroReservadoNfce, ambiente };
    }
    const numeroNota = numeroPedido
      || String(numeroReservadoNfce ?? await (await getStorage()).peekNumber(emp.cnpj, serieNota, ambiente));

    // Numero ja usado: o historico esta aqui e ninguem olhava (mesma falta que a
    // NF-e tinha). O cupom ia ate a SEFAZ e voltava como cStat 539, gastando uma
    // ida e deixando o operador sem saber que a venda anterior ja existia — no
    // balcao, com o cliente esperando.
    //
    // So vale quando o numero veio de fora: o reservado e novo por construcao.
    if (numeroPedido && !simulando) {
      try {
        const jaExiste = await (await getStorage()).listNotas(emp.cnpj, 500);
        const conflito = jaExiste.find(n =>
          String(n.numero) === numeroNota && String(n.serie) === serieNota
          && String(n.ambiente ?? '1') === ambiente && n.status === 'AUTORIZADA');
        if (conflito) {
          res.status(400).json({
            sucesso: false,
            erro: `Numero ${numeroNota} da serie ${serieNota} ja foi usado nesta empresa e ambiente.`,
            chaveAcesso: conflito.chaveAcesso,
            comoResolver: 'Omita o campo `numero` e a API usa o proximo livre, ou consulte GET /api/proximo-numero.',
          });
          return;
        }
      } catch { /* sem historico disponivel: segue e deixa a SEFAZ decidir */ }
    }

    // No modelo 65 o sentido do CFOP nao e deducao: a NFC-e e sempre venda dentro
    // do estado, entao todo CFOP comeca por 5 e qualquer outro primeiro digito
    // esta errado por definicao.
    //
    // O caminho normal de preencher item e o catalogo, que devolve o CFOP
    // cadastrado: um produto de empresa que tambem vende para fora entra no cupom
    // com 6102, e um item de devolucao entra com 1202. A funcao que conserta isso
    // ja existia uma tela acima e so a NF-e a chamava.
    const { itens: itensDoCupom, ajustes: cfopAjustado } = corrigirSentidoCfop(
      normalizarItens(body.itens, emp.crt),
      { entrada: false, destino: '1' },
    );
    const itensNfce = await aplicarIbsCbsDoCatalogo(itensDoCupom, emp.cnpj);

    const fiscalInput: FiscalContextInput = {
      emitente: {
        cnpj: emp.cnpj,
        razaoSocial: emp.razaoSocial,
        fantasia: emp.fantasia || undefined,
        ie: emp.ie,
        crt: emp.crt,
        endereco: {
          logradouro: emp.endereco.logradouro,
          numero: emp.endereco.numero,
          complemento: emp.endereco.complemento,
          bairro: emp.endereco.bairro,
          codigoMunicipio: emp.endereco.codigoMunicipio,
          nomeMunicipio: emp.endereco.nomeMunicipio,
          uf: emp.uf,
          cep: emp.endereco.cep,
          fone: emp.endereco.fone,
        },
      },
      destinatario: {
        cpf: body.destinatario?.cpf || undefined,
        cnpj: body.destinatario?.cnpj || undefined,
        razaoSocial: destRazao || '',
        indIEDest: '9',
        endereco: body.destinatario?.endereco || {
          logradouro: '', numero: '', bairro: '', codigoMunicipio: emp.endereco.codigoMunicipio,
          nomeMunicipio: emp.endereco.nomeMunicipio, uf: emp.uf, cep: '',
        },
      },
      itens: itensNfce,
      pagamento: normalizarPagamento(body.pagamento),
      serie: serieNota,
      numero: numeroNota,
      naturezaOperacao: body.naturezaOperacao || 'VENDA',
      dataEmissao: gerarDhEmi(),
      finalidade: '1',
      tipoOperacao: '1',
      destino: '1',
      indFinal: '1',
      presenca: body.presenca || '1',
      ambiente,
      municipioFG: emp.endereco.codigoMunicipio,
      ufEmitente: emp.uf,
      modFrete: '9',
      mod: '65',
    };

    const nfe = buildNFe(fiscalInput);

    const { chave, cDV } = generateAccessKey({
      cUF: nfe.ide.cUF,
      dhEmi: nfe.ide.dhEmi,
      cnpj: nfe.emit.CNPJ!,
      mod: '65',
      serie: nfe.ide.serie,
      nNF: nfe.ide.nNF,
      tpEmis: nfe.ide.tpEmis,
      cNF: nfe.ide.cNF,
    });
    nfe.ide.cDV = cDV;

    // QR Code NFC-e
    const qrCodeParam = gerarQrCodeNFCe(chave, ambiente, emp.cscToken, emp.cscId);
    const urlConsulta = getNfceQrCodeUrl(emp.uf, ambiente);
    const qrCodeUrl = `${urlConsulta}?p=${qrCodeParam}`;
    nfe.infNFeSupl = {
      qrCode: qrCodeUrl,
      urlChave: getNfceUrlChave(emp.uf, ambiente),
    };

    const xmlGen = new XmlGenerator();
    const xml = xmlGen.generateInfNFe(nfe, chave);

    // Prévia da NFC-e, igual à da NF-e.
    //
    // Sem isto, o botão "Ver prévia" que o contrato exige em toda tela de
    // emissão não tinha o que chamar aqui — e uma plataforma que seguisse o
    // contrato acabaria ligando esse botão à emissão real. Cupom fiscal
    // autorizado é documento como qualquer outro: não se emite para conferir.
    if (simulando) {
      const validador = new XsdValidator();
      const estruturaNfce = validador.validate(xml);
      const schemaNfce = await validador.validarSchema(xml);
      const valido = estruturaNfce.valid && schemaNfce.valid;
      res.json({
        simulacao: true,
        sucesso: valido,
        ...(valido ? {} : {
          erro: 'Falha na validacao XML',
          detalhes: [...estruturaNfce.errors, ...schemaNfce.errors].map(e => e.message),
        }),
        schemaValidado: schemaNfce.disponivel,
        modelo: '65',
        ambiente,
        chaveAcesso: chave,
        numero: numeroNota,
        serie: serieNota,
        // Correcao muda o documento: quem chamou precisa saber que o CFOP que
        // ele mandou nao e o que foi para o XML.
        ...(cfopAjustado.length ? { cfopAjustado } : {}),
        nfe,
        xml,
      });
      return;
    }

    const pfxBuffer = emp.pfxBuffer;
    const signer = new Signer(pfxBuffer, emp.pfxPassword);
    const signedXml = signer.sign(xml, `NFe${chave}`);

    const loteId = Date.now().toString();
    const envelope = xmlGen.wrapEnvelope(signedXml, loteId);

    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getNfceEndpoints(emp.uf, ambiente);

    // Falha de envio no balcao: a NF-e ja separava "nao sei" de "nao saiu" e o
    // cupom caia no catch geral como erro 500 generico — na frente do cliente,
    // sem dizer se a venda foi ou nao.
    let responseXml: string;
    try {
      responseXml = await soapClient.send(envelope, endpoints.NfeAutorizacao, 'NfeAutorizacao');
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error('[transmissao-nfce] sem resposta da SEFAZ', {
        cnpj: emp.cnpj, chave, serie: serieNota, numero: numeroNota, ambiente, erro: motivo,
      });
      const resposta = respostaDeEnvioSemResposta(e, {
        uf: emp.uf, chave, serie: serieNota, numero: numeroNota, ambiente, documento: 'cupom',
      });
      // Na duvida o numero fica gasto: se o cupom PODE estar autorizado, devolver
      // o numero faria o proximo caixa emitir por cima dele.
      if (resposta.podeDevolverNumero && reservaNfce) {
        await (await getStorage())
          .devolverNumero(reservaNfce.cnpj, reservaNfce.serie, reservaNfce.numero, reservaNfce.ambiente)
          .catch(() => { /* devolver e otimizacao: nao pode trocar o erro real */ });
      }
      // Ja tratado aqui: o catch de fora nao pode devolver o mesmo numero de novo.
      reservaNfce = undefined;
      res.status(resposta.status).json(resposta.corpo);
      return;
    }

    const parsed = parseAutorizacaoResponse(responseXml);

    if (parsed.protNFe && nfeAutorizada(parsed.protNFe.infProt.cStat)) {
      const prot = parsed.protNFe.infProt;
      const nfeProcXml = montarNfeProc(signedXml, responseXml) ?? signedXml;

      try {
        const storage = await getStorage();
        // A reserva virou nota: nao ha o que devolver no catch.
        reservaNfce = undefined;
        await storage.registerUsedNumber(emp.cnpj, serieNota, Number(numeroNota), ambiente);
        await storage.saveNota({
          chaveAcesso: chave,
          empresaCnpj: emp.cnpj,
          numero: numeroNota,
          serie: serieNota,
          ambiente,
          destNome: body.destinatario?.razaoSocial || 'CONSUMIDOR',
          destDoc: body.destinatario?.cpf || body.destinatario?.cnpj || '',
          vNF: nfe.total.ICMSTot.vNF,
          protocolo: prot.nProt,
          dhRecbto: prot.dhRecbto,
          cStat: prot.cStat,
          status: 'AUTORIZADA',
          nfeJson: nfe,
          xml: nfeProcXml,
          emitidaEm: new Date().toISOString(),
        });
      } catch { /* persistência não bloqueia */ }

      // O documento pertence a quem emitiu. A NF-e já devolvia o PDF junto e a
      // NFC-e não — quem integrava por aqui ficava só com o XML e tinha de saber
      // que existe uma rota separada para o PDF. Falha na geração não derruba a
      // emissão: a nota está autorizada, e o PDF continua disponível em
      // `/api/nota/:chave/danfe`.
      let danfeNfce: string | undefined;
      try {
        const pdfBuf = await gerarDanfePdf({ nfeProcXml, nfe, chave, nProt: prot.nProt, dhRecbto: prot.dhRecbto });
        danfeNfce = pdfBuf.toString('base64');
      } catch { /* PDF é entrega, não requisito da emissão */ }

      despacharWebhook(emp.cnpj, 'nfce.authorized', {
        chaveAcesso: chave, protocolo: prot.nProt, cStat: prot.cStat,
        valor: nfe.total.ICMSTot.vNF, serie: serieNota, numero: numeroNota,
      }, ambiente);

      res.json({
        sucesso: true,
        modelo: '65',
        chaveAcesso: chave,
        protocolo: prot.nProt,
        dhRecbto: prot.dhRecbto,
        cStat: prot.cStat,
        xMotivo: prot.xMotivo,
        // cStat 120: NFC-e autorizada com alerta (NT 2026.002) — conferir.
        alerta: prot.cStat === '120' ? (prot.xMsg || prot.xMotivo) : undefined,
        qrCode: qrCodeUrl,
        ...(cfopAjustado.length ? { cfopAjustado } : {}),
        arquivo: `NFCe_${chave}.xml`,
        xml: nfeProcXml,
        danfePdf: danfeNfce,
        downloads: {
          xml: `/api/nota/${chave}/xml`,
          pdf: `/api/nota/${chave}/danfe`,
        },
      });
    } else {
      const prot = parsed.protNFe?.infProt;
      res.json({
        sucesso: false,
        modelo: '65',
        chaveAcesso: chave,
        cStat: prot?.cStat || parsed.cStat,
        xMotivo: prot?.xMotivo || parsed.xMotivo,
      });
    }
  } catch (err: any) {
    // Cupom que nao saiu nao pode queimar numeracao. `devolverNumero` so devolve
    // se o numero ainda for o ultimo — se outro caixa ja passou por cima, aquele
    // numero foi consumido de verdade.
    if (reservaNfce) {
      await (await getStorage())
        .devolverNumero(reservaNfce.cnpj, reservaNfce.serie, reservaNfce.numero, reservaNfce.ambiente)
        .catch(() => { /* devolver e otimizacao: nao pode trocar o erro real */ });
    }
    // Cadastro errado nao e falha do servidor, e a NF-e ja separava os dois. Com
    // 500 o PDV entra em retry por um dado que nunca se corrige sozinho — no
    // balcao isso vira fila enquanto o mesmo cupom e reenviado.
    res.status(err instanceof ErroDeDados ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// Numeração + histórico (Postgres via NFE_DB_URL, ou arquivo local)
// ---------------------------------------------------------------------------
app.get('/api/proximo-numero', async (req, res) => {
  try {
    const serie = (req.query['serie'] as string) || '1';
    const emp = await resolveEmpresa(req);
    // Cada ambiente tem a sua contagem: perguntar sem dizer qual devolveria o
    // número errado para quem está ensaiando a nota em homologação.
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.query['ambiente']);
    if (!ambiente) return;
    const storage = await getStorage();
    res.json({
      serie,
      ambiente,
      numero: await storage.peekNumber(emp.cnpj, serie, ambiente),
      storage: storage.kind(),
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/historico', async (req, res) => {
  try {
    const storage = await getStorage();

    // `?ambiente=1|2` separa o que vale do que foi teste. Sem isso a listagem
    // mistura os dois, e nota de homologação com o mesmo número de uma real —
    // que acontece, porque a numeração é separada por ambiente — fica
    // indistinguível na tela de quem opera.
    const filtroAmb = req.query['ambiente'];
    const soDeste = (lista: any[]) =>
      filtroAmb === '1' || filtroAmb === '2'
        ? lista.filter(n => String(n.ambiente) === filtroAmb)
        : lista;

    // Admin com ?todas=1 vê notas de todas as empresas (dashboard)
    if ((req as any).isAdmin && req.query['todas'] === '1') {
      res.json(soDeste(await storage.listNotas(undefined, 500)));
      return;
    }
    const emp = await resolveEmpresa(req);
    res.json(soDeste(await storage.listNotas(emp.cnpj)));
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Isolamento multi-empresa: operador só acessa notas da própria empresa
async function notaAcessivel(req: express.Request, nota: { empresaCnpj?: string } | null): Promise<boolean> {
  if (!nota) return false;
  if ((req as any).isAdmin) return true;
  if (!nota.empresaCnpj) return true; // notas antigas sem escopo
  const emp = await resolveEmpresa(req);
  return nota.empresaCnpj === emp.cnpj;
}

// Re-download de XML / DANFE de nota do histórico
app.get('/api/nota/:chave/xml', async (req, res) => {
  try {
    const storage = await getStorage();
    const nota = await storage.getNota(req.params.chave);
    if (!(await notaAcessivel(req, nota))) {
      res.status(403).json({ erro: 'Nota nao pertence a esta empresa' });
      return;
    }
    if (!nota?.xml) {
      res.status(404).json({ erro: 'XML nao encontrado no historico' });
      return;
    }
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="NFe_${nota.chaveAcesso}.xml"`);
    res.send(nota.xml);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/nota/:chave/danfe', async (req, res) => {
  try {
    const storage = await getStorage();
    const nota = await storage.getNota(req.params.chave);
    if (!(await notaAcessivel(req, nota))) {
      res.status(403).json({ erro: 'Nota nao pertence a esta empresa' });
      return;
    }
    if (!nota?.nfeJson) {
      res.status(404).json({ erro: 'Dados da nota nao encontrados no historico' });
      return;
    }
    // Nota nova guarda o nfeProc (com protNFe) → DANFE oficial; nota antiga cai no simplificado
    const nfeProcXml = nota.xml && nota.xml.includes('<protNFe') ? nota.xml : undefined;
    const pdf = await gerarDanfePdf({
      nfeProcXml,
      nfe: nota.nfeJson,
      chave: nota.chaveAcesso,
      nProt: nota.protocolo || '-',
      dhRecbto: nota.dhRecbto || '',
      // O status estava aqui o tempo todo e nunca viajava: a nota aparecia como
      // CANCELADA na tela e o PDF baixado saia identico ao de uma nota valida —
      // documento cancelado circulando com cara de bom.
      carimbo: carimboDoStatus(nota.status),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DANFE_${nota.chaveAcesso}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/nota/:chave/duplicar — dados de uma nota prontos para reemissão
//
// Devolve o formulário de emissão preenchido a partir de uma nota já
// autorizada, sem número, chave, data nem protocolo — a cópia é uma nota nova.
// O próximo número da série vai junto para a tela não precisar de outra volta.
// ---------------------------------------------------------------------------
app.get('/api/nota/:chave/duplicar', async (req, res) => {
  try {
    const storage = await getStorage();
    const nota = await storage.getNota(req.params.chave);
    if (!(await notaAcessivel(req, nota))) {
      res.status(403).json({ erro: 'Nota nao pertence a esta empresa' });
      return;
    }
    if (!nota?.nfeJson) {
      // Notas antigas podem ter sido gravadas só com o XML.
      res.status(404).json({ erro: 'Dados da nota nao encontrados no historico' });
      return;
    }
    const dados = duplicarNota(nota.nfeJson);
    dados.origem.chaveAcesso = nota.chaveAcesso;
    // Duplicar herda o ambiente da nota original — quem copia uma nota de produção
    // está preparando outra de produção, salvo pedido explícito.
    const ambiente = resolverAmbiente(req, res, nota.ambiente, req.query['ambiente']);
    if (!ambiente) return;
    const proximoNumero = await storage.peekNumber(nota.empresaCnpj, dados.serie, ambiente);
    res.json({ ...dados, ambiente, proximoNumero: String(proximoNumero) });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/cancelar — cancelamento de NF-e autorizada (evento 110111)
// ---------------------------------------------------------------------------
app.post('/api/cancelar', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const { chaveAcesso, protocolo, justificativa } = req.body;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.body.ambiente);
    if (!ambiente) return;
    if (!chaveAcesso || !protocolo || !justificativa) {
      res.status(400).json({ erro: 'Campos obrigatorios: chaveAcesso, protocolo, justificativa' });
      return;
    }
    if (String(justificativa).length < 15) {
      res.status(400).json({ erro: 'Justificativa deve ter no minimo 15 caracteres' });
      return;
    }

    const cUF = UF_TO_IBGE[emp.uf] || '31';
    const gen = new EventXmlGenerator();
    const xml = gen.generateCancelamento({
      chaveAcesso,
      cnpj: emp.cnpj,
      cUF,
      ambiente,
      nSeqEvento: 1,
      dhEvento: gerarDhEmi(),
      nProt: protocolo,
      xJust: justificativa,
    }, Date.now().toString());

    const pfxBuffer = emp.pfxBuffer;
    const signer = new Signer(pfxBuffer, emp.pfxPassword);
    const signedXml = signer.sign(xml, `ID110111${chaveAcesso}01`);

    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);
    const responseXml = await soapClient.send(signedXml, endpoints.NFeRecepcaoEvento, 'NFeRecepcaoEvento');
    const parsed = parseEventoResponse(responseXml);

    const cStat = parsed.infEvento?.cStat || parsed.cStat;
    const xMotivo = parsed.infEvento?.xMotivo || parsed.xMotivo;
    // 135 = cancelado, 155 = cancelamento fora de prazo aceito, 573 = já cancelado antes (duplicidade)
    const sucesso = cStat === '135' || cStat === '155' || cStat === '573';

    if (sucesso) {
      const storage = await getStorage();
      await storage.updateStatus(chaveAcesso, 'CANCELADA', cStat);
      // O evento existia no tipo, na tela de cadastro e no banco, e nunca
      // disparava: so `nfe.authorized` e `nfe.rejected` eram chamados em todo o
      // app. Quem assinou `nfe.cancelled` recebia silencio.
      despacharWebhook(emp.cnpj, 'nfe.cancelled', {
        chaveAcesso, cStat, protocoloEvento: parsed.infEvento?.nProt,
      }, ambiente);
    }

    res.json({ sucesso, cStat, xMotivo: cStat === '573' ? 'Nota ja estava cancelada (evento duplicado). Status local atualizado.' : xMotivo, protocoloEvento: parsed.infEvento?.nProt });
  } catch (err: any) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/carta-correcao — CC-e (evento 110110)
// ---------------------------------------------------------------------------
app.post('/api/carta-correcao', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const { chaveAcesso, correcao } = req.body;
    const nSeqEvento = Number(req.body.nSeqEvento || 1);
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.body.ambiente);
    if (!ambiente) return;
    if (!chaveAcesso || !correcao) {
      res.status(400).json({ erro: 'Campos obrigatorios: chaveAcesso, correcao' });
      return;
    }
    if (String(correcao).length < 15) {
      res.status(400).json({ erro: 'Texto da correcao deve ter no minimo 15 caracteres' });
      return;
    }

    const cUF = UF_TO_IBGE[emp.uf] || '31';
    const gen = new EventXmlGenerator();
    const xml = gen.generateCartaCorrecao({
      chaveAcesso,
      cnpj: emp.cnpj,
      cUF,
      ambiente,
      nSeqEvento,
      dhEvento: gerarDhEmi(),
      xCorrecao: correcao,
    }, Date.now().toString());

    const pfxBuffer = emp.pfxBuffer;
    const signer = new Signer(pfxBuffer, emp.pfxPassword);
    const nSeqPadded = String(nSeqEvento).padStart(2, '0');
    const signedXml = signer.sign(xml, `ID110110${chaveAcesso}${nSeqPadded}`);

    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);
    const responseXml = await soapClient.send(signedXml, endpoints.NFeRecepcaoEvento, 'NFeRecepcaoEvento');
    const parsed = parseEventoResponse(responseXml);

    const cStat = parsed.infEvento?.cStat || parsed.cStat;
    const xMotivo = parsed.infEvento?.xMotivo || parsed.xMotivo;

    res.json({
      sucesso: cStat === '135',
      cStat,
      xMotivo,
      protocoloEvento: parsed.infEvento?.nProt,
    });
  } catch (err: any) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/consultar?chave= — consulta situação da NF-e na SEFAZ
// ---------------------------------------------------------------------------
app.get('/api/consultar', async (req, res) => {
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const chave = req.query['chave'] as string;
    const ambienteQ = req.query['ambiente'] as string;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, ambienteQ);
    if (!ambiente) return;
    if (!chave || chave.length !== 44) {
      res.status(400).json({ erro: 'Informe ?chave= com 44 digitos' });
      return;
    }

    const gen = new ConsultaXmlGenerator();
    const xml = gen.generate(chave, ambiente);
    const pfxBuffer = emp.pfxBuffer;
    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);
    const responseXml = await soapClient.send(xml, endpoints.NfeConsultaProtocolo, 'NfeConsultaProtocolo');
    const parsed = parseConsultaResponse(responseXml);

    res.json({
      chaveAcesso: chave,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      protocolo: parsed.nProt,
      dhRecbto: parsed.dhRecbto,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/danfe — gerar DANFE PDF a partir de dados de NF-e autorizada
// ---------------------------------------------------------------------------
app.post('/api/danfe', async (req, res) => {
  try {
    const { nfe, chaveAcesso, protocolo, dhRecbto } = req.body;
    if (!nfe || !chaveAcesso || !protocolo) {
      res.status(400).json({ erro: 'Campos obrigatorios: nfe, chaveAcesso, protocolo' });
      return;
    }
    const danfe = new DanfeGenerator();
    const pdfBuffer = await danfe.generate({ nfe: nfe as NFe, chaveAcesso, nProt: protocolo, dhRecbto: dhRecbto || '' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DANFE_${chaveAcesso}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/notas/homologacao — apaga todas as notas de teste (ambiente=2)
// ---------------------------------------------------------------------------
app.delete('/api/notas/homologacao', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const storage = await getStorage();

    // Antes era so admin, e apagava de TODAS as empresas: `deleteHomologacao()`
    // sem CNPJ. Duas coisas erradas nisso.
    //
    // A primeira: o contador limpando os testes de um cliente apagava os testes
    // de todos os outros, sem dizer. A segunda: a plataforma do cliente nao
    // conseguia limpar os PROPRIOS testes — e agora ela precisa, porque a previa
    // dela emite em homologacao e a lista enche.
    //
    // O padrao passou a ser a empresa da requisicao. Limpar tudo continua
    // existindo, mas exige ser admin E pedir explicitamente.
    const todas = String(req.query['todas'] ?? '') === '1';
    if (todas) {
      if (!(req as any).isAdmin) {
        res.status(403).json({
          erro: 'Somente o administrador pode limpar as notas de homologacao de todas as empresas.',
          comoResolver: 'Sem `?todas=1`, a limpeza vale so para a empresa da sua chave.',
        });
        return;
      }
      const removidas = await storage.deleteHomologacao();
      res.json({
        sucesso: true, removidas, escopo: 'todas as empresas',
        mensagem: `${removidas} nota(s) de homologacao removida(s) de todas as empresas`,
      });
      return;
    }

    const emp = await resolveEmpresa(req);
    const removidas = await storage.deleteHomologacao(emp.cnpj);
    res.json({
      sucesso: true, removidas, escopo: emp.cnpj,
      mensagem: `${removidas} nota(s) de homologacao removida(s)`,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/nota/:chave — apaga UMA nota de teste
// ---------------------------------------------------------------------------
/**
 * Apaga uma nota do historico — e **somente** se ela for de homologacao.
 *
 * A limpeza em lote resolve "sujou a lista de teste"; esta rota resolve o caso
 * de uma nota so, que e o mais comum depois de conferir uma previa.
 *
 * Nota de PRODUCAO nunca e apagada, e nao e questao de permissao: o historico e
 * onde vive o XML autorizado. Apagar dali nao desfaz a nota na SEFAZ — deixa a
 * empresa sem o arquivo de uma nota que existe, que e o oposto do que se queria.
 * Para anular uma nota real existe cancelamento, com prazo e justificativa.
 */
app.delete('/api/nota/:chave', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const storage = await getStorage();
    const nota = await storage.getNota(String(req.params.chave));
    if (!(await notaAcessivel(req, nota))) {
      res.status(403).json({ erro: 'Nota nao pertence a esta empresa' });
      return;
    }
    if (!nota) { res.status(404).json({ erro: 'Nota nao encontrada.' }); return; }

    if (String(nota.ambiente ?? '1') !== '2') {
      res.status(400).json({
        erro: 'Esta nota e de producao e nao pode ser apagada do historico.',
        comoResolver: 'O historico guarda o XML autorizado. Apagar aqui nao desfaz a nota na '
          + 'SEFAZ — para anular uma nota real, use o cancelamento (POST /api/cancelar).',
        ambiente: nota.ambiente,
      });
      return;
    }

    const removidas = await storage.deleteNota(nota.chaveAcesso);
    res.json({ sucesso: true, removidas, chaveAcesso: nota.chaveAcesso });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/inutilizar — inutilização de numeração NF-e
// ---------------------------------------------------------------------------
app.post('/api/inutilizar', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const { serie, nNFIni, nNFFin, justificativa } = req.body;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.body.ambiente);
    if (!ambiente) return;

    if (!serie || !nNFIni || !nNFFin || !justificativa) {
      res.status(400).json({ erro: 'Campos obrigatorios: serie, nNFIni, nNFFin, justificativa' });
      return;
    }
    if (String(justificativa).length < 15) {
      res.status(400).json({ erro: 'Justificativa deve ter no minimo 15 caracteres' });
      return;
    }
    // Serie fora de 0-889 volta como rejeicao depois de assinar e transmitir, e
    // a /api/docs ja prometia a faixa. 890+ e reservada para Nota Fiscal Avulsa.
    const serieNum = Number(String(serie).trim());
    if (!Number.isInteger(serieNum) || serieNum < 0 || serieNum > 889) {
      res.status(400).json({
        erro: `Serie "${serie}" invalida para inutilizacao. Use de 0 a 889 — `
          + '890 em diante e reservada pela SEFAZ para Nota Fiscal Avulsa.',
      });
      return;
    }

    // `Number('abc') > Number('abc')` e `NaN > NaN`, que e FALSE: comparar nao
    // rejeita lixo. 'abc' seguia para o padStart e virava '000000abc' dentro do
    // Id assinado. Por isso a conferencia e de INTEIRO, nao de ordem.
    const ini = Number(String(nNFIni).trim());
    const fim = Number(String(nNFFin).trim());
    for (const [rotulo, valor, bruto] of [['nNFIni', ini, nNFIni], ['nNFFin', fim, nNFFin]] as Array<[string, number, unknown]>) {
      if (!Number.isInteger(valor) || valor < 1) {
        res.status(400).json({
          erro: `${rotulo} "${bruto}" nao e um numero inteiro maior que zero. `
            + 'Numeracao de NF-e comeca em 1.',
        });
        return;
      }
    }
    if (ini > fim) {
      res.status(400).json({ erro: 'Numero inicial deve ser menor ou igual ao final' });
      return;
    }

    // Inutilizar faixa que contem nota AUTORIZADA e recusado pela SEFAZ, e o
    // historico ja sabe exatamente quais numeros sairam. Barrar aqui devolve a
    // chave da nota — que e o que o operador precisa para entender o que houve.
    try {
      const jaEmitidas = await (await getStorage()).listNotas(emp.cnpj, 1000);
      const conflito = jaEmitidas.find(n =>
        String(n.serie) === String(serieNum)
        && String(n.ambiente ?? '1') === ambiente
        && n.status === 'AUTORIZADA'
        && Number(n.numero) >= ini && Number(n.numero) <= fim);
      if (conflito) {
        res.status(400).json({
          erro: `A faixa ${ini}-${fim} da serie ${serieNum} contem a nota ${conflito.numero}, `
            + 'que esta AUTORIZADA. Numero autorizado nao se inutiliza — se a intencao e '
            + 'desfazer a nota, o caminho e cancelamento.',
          chaveAcesso: conflito.chaveAcesso,
        });
        return;
      }
    } catch { /* sem historico: segue e deixa a SEFAZ decidir */ }

    const cUF = UF_TO_IBGE[emp.uf] || '35';
    const ano = new Date().getFullYear().toString().slice(2);
    const gen = new InutilizacaoXmlGenerator();
    const xml = gen.generate({
      tpAmb: ambiente,
      cUF,
      ano,
      cnpj: emp.cnpj,
      mod: '55',
      serie: String(serieNum),
      nNFIni: String(ini),
      nNFFin: String(fim),
      xJust: justificativa,
    });

    const pfxBuffer = emp.pfxBuffer;
    const signer = new Signer(pfxBuffer, emp.pfxPassword);
    const id = `ID${cUF}${ano}${emp.cnpj}55${String(serieNum).padStart(3, '0')}${String(ini).padStart(9, '0')}${String(fim).padStart(9, '0')}`;
    const signedXml = signer.sign(xml, id);

    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);
    const responseXml = await soapClient.send(signedXml, endpoints.NfeInutilizacao, 'NfeInutilizacao');
    const parsed = parseInutilizacaoResponse(responseXml);

    const sucesso = parsed.cStat === '102';

    // Homologada: a faixa esta MORTA. Sem isto o contador continuava antes dela
    // e /api/proximo-numero seguia sugerindo um numero que a SEFAZ acabou de
    // matar — o sistema conduzindo o operador a uma rejeicao certa.
    // `registerUsedNumber` nunca recua, entao inutilizar uma faixa velha nao
    // mexe num contador que ja passou.
    if (sucesso) {
      await (await getStorage())
        .registerUsedNumber(emp.cnpj, String(serieNum), fim, ambiente)
        .catch(() => { /* a inutilizacao valeu na SEFAZ: nao pode virar erro aqui */ });
    }

    res.json({
      sucesso,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      nProt: parsed.nProt,
      ...(sucesso ? { proximoNumeroLivre: fim + 1 } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/export-xmls — download de todos os XMLs em lote (base64 ZIP)
// ---------------------------------------------------------------------------
app.get('/api/export-xmls', async (req, res) => {
  try {
    if (!(req as any).isAdmin) {
      res.status(403).json({ erro: 'Somente o contador pode exportar XMLs' });
      return;
    }
    const storage = await getStorage();
    const cnpj = (req.query['cnpj'] as string) || undefined;
    const notas = await storage.listNotas(cnpj, 9999);
    const xmls: { nome: string; xml: string }[] = [];

    for (const n of notas) {
      if (!n.chaveAcesso) continue;
      const full = await storage.getNota(n.chaveAcesso);
      if (full?.xml) {
        xmls.push({ nome: `NFe_${n.chaveAcesso}.xml`, xml: full.xml });
      }
    }

    if (!xmls.length) {
      res.status(404).json({ erro: 'Nenhum XML encontrado' });
      return;
    }

    res.json({
      sucesso: true,
      total: xmls.length,
      arquivos: xmls,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/certificado-info — informações do certificado (validade)
// ---------------------------------------------------------------------------
app.get('/api/certificado-info', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const forge = require('node-forge');
    const p12Asn1 = forge.asn1.fromDer(emp.pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, emp.pfxPassword);
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certs = certBags[forge.pki.oids.certBag] || [];

    if (!certs.length) {
      res.json({ erro: 'Nenhum certificado encontrado no PFX' });
      return;
    }

    const cert = certs[0].cert;
    const notBefore = cert.validity.notBefore;
    const notAfter = cert.validity.notAfter;
    const now = new Date();
    const diasRestantes = Math.ceil((notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const subject = cert.subject.attributes.map((a: any) => `${a.shortName}=${a.value}`).join(', ');

    res.json({
      cnpj: emp.cnpj,
      subject,
      validoDesde: notBefore.toISOString(),
      validoAte: notAfter.toISOString(),
      diasRestantes,
      vencido: diasRestantes <= 0,
      alertaVencimento: diasRestantes <= 30,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/certificados-alertas — alertas de vencimento de TODOS os certificados
// ---------------------------------------------------------------------------
app.get('/api/certificados-alertas', async (req, res) => {
  try {
    if (!(req as any).isAdmin) {
      res.status(403).json({ erro: 'Somente o contador' });
      return;
    }
    const store = await getEmpresaStore();
    const empresas = await store.listar();
    const alertas: any[] = [];
    const forge = require('node-forge');

    for (const e of empresas) {
      try {
        const ctx = await store.obterContexto(e.cnpj);
        if (!ctx) continue;
        const p12Asn1 = forge.asn1.fromDer(ctx.pfxBuffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, ctx.pfxPassword);
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const certs = certBags[forge.pki.oids.certBag] || [];
        if (!certs.length) continue;
        const cert = certs[0].cert;
        const notAfter = cert.validity.notAfter;
        const diasRestantes = Math.ceil((notAfter.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        alertas.push({
          cnpj: e.cnpj,
          empresa: e.fantasia || e.razaoSocial,
          validoAte: notAfter.toISOString(),
          diasRestantes,
          vencido: diasRestantes <= 0,
          alerta: diasRestantes <= 30,
        });
      } catch { /* certificado corrompido — pula */ }
    }

    alertas.sort((a, b) => a.diasRestantes - b.diasRestantes);
    res.json(alertas);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/relatorio — relatório fiscal mensal por empresa
// ---------------------------------------------------------------------------
app.get('/api/relatorio', async (req, res) => {
  try {
    if (!(req as any).isAdmin) {
      res.status(403).json({ erro: 'Somente o contador' });
      return;
    }
    const storage = await getStorage();
    const notas = await storage.listNotas(undefined, 9999);

    const mes = (req.query['mes'] as string) || new Date().toISOString().slice(0, 7);
    const filtradas = notas.filter(n =>
      n.ambiente === '1' && n.emitidaEm && n.emitidaEm.startsWith(mes)
    );

    const porEmpresa: Record<string, { autorizadas: number; canceladas: number; valorTotal: number; valorCancelado: number }> = {};
    for (const n of filtradas) {
      const cnpj = n.empresaCnpj || 'desconhecido';
      if (!porEmpresa[cnpj]) porEmpresa[cnpj] = { autorizadas: 0, canceladas: 0, valorTotal: 0, valorCancelado: 0 };
      const v = parseFloat(n.vNF || '0');
      if (n.status === 'CANCELADA') {
        porEmpresa[cnpj].canceladas++;
        porEmpresa[cnpj].valorCancelado += v;
      } else {
        porEmpresa[cnpj].autorizadas++;
        porEmpresa[cnpj].valorTotal += v;
      }
    }

    // NFS-e entra separada, e não somada: são documentos de fiscos diferentes,
    // com tributos diferentes. Juntar num total só esconderia de qual imposto
    // se está falando.
    let servicos: Record<string, { autorizadas: number; canceladas: number; valorTotal: number; valorCancelado: number }> = {};
    let totalNfse = 0;
    try {
      const nfseStore = await getNfseStore();
      const doServico = (await nfseStore.listarNotas(undefined, 9999))
        .filter((n) => n.ambiente === '1' && n.emitidaEm && n.emitidaEm.startsWith(mes));
      totalNfse = doServico.length;
      for (const n of doServico) {
        const cnpj = n.empresaCnpj || 'desconhecido';
        if (!servicos[cnpj]) servicos[cnpj] = { autorizadas: 0, canceladas: 0, valorTotal: 0, valorCancelado: 0 };
        const v = parseFloat(n.valorServico || '0');
        if (n.status === 'CANCELADA') {
          servicos[cnpj].canceladas++;
          servicos[cnpj].valorCancelado += v;
        } else {
          servicos[cnpj].autorizadas++;
          servicos[cnpj].valorTotal += v;
        }
      }
    } catch {
      // Banco sem as tabelas de NFS-e ainda: o relatório da NF-e não deve cair
      // por causa disso.
      servicos = {};
    }

    res.json({
      mes,
      empresas: porEmpresa,
      totalNotas: filtradas.length,
      nfse: { empresas: servicos, totalNotas: totalNfse },
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// Configurações do sistema (SMTP etc.) — salvas no banco criptografadas
// ---------------------------------------------------------------------------
async function getConfigStore(): Promise<any> {
  const dbUrl = urlDoBanco();
  if (!dbUrl) throw new Error('Configuracoes exigem NFE_DB_URL (Postgres)');
  const { Pool } = require('pg');
  const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
  const pool = new Pool({ connectionString: dbUrl, ssl: isLocal ? undefined : { rejectUnauthorized: false }, max: 2 });
  await pool.query(`CREATE TABLE IF NOT EXISTS webapp_config (chave VARCHAR(100) PRIMARY KEY, valor TEXT NOT NULL)`);
  return pool;
}

async function getSmtpConfig(): Promise<{ host: string; port: string; user: string; pass: string; from: string } | null> {
  // Prioridade: banco > env vars
  try {
    const pool = await getConfigStore();
    const r = await pool.query(`SELECT chave, valor FROM webapp_config WHERE chave LIKE 'smtp_%'`);
    if (r.rows.length >= 3) {
      const cfg: Record<string, string> = {};
      for (const row of r.rows) {
        const val = row.chave === 'smtp_pass'
          ? require('./crypto').decryptSecret(row.valor).toString('utf-8')
          : row.valor;
        cfg[row.chave] = val;
      }
      if (cfg['smtp_host'] && cfg['smtp_user'] && cfg['smtp_pass']) {
        return { host: cfg['smtp_host'], port: cfg['smtp_port'] || '587', user: cfg['smtp_user'], pass: cfg['smtp_pass'], from: cfg['smtp_from'] || cfg['smtp_user'] };
      }
    }
  } catch { /* cai nos env vars */ }
  const smtpHost = process.env['SMTP_HOST'];
  const smtpUser = process.env['SMTP_USER'];
  const smtpPass = process.env['SMTP_PASS'];
  if (smtpHost && smtpUser && smtpPass) {
    return { host: smtpHost, port: process.env['SMTP_PORT'] || '587', user: smtpUser, pass: smtpPass, from: process.env['SMTP_FROM'] || smtpUser };
  }
  return null;
}

app.get('/api/configuracoes', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const pool = await getConfigStore();
    const r = await pool.query(`SELECT chave, valor FROM webapp_config WHERE chave LIKE 'smtp_%'`);
    const cfg: Record<string, string> = {};
    for (const row of r.rows) {
      cfg[row.chave] = row.chave === 'smtp_pass' ? '••••••••' : row.valor;
    }
    const envFallback = Boolean(process.env['SMTP_HOST']);
    res.json({ smtp: cfg, configurado: Object.keys(cfg).length >= 3 || envFallback, fonte: Object.keys(cfg).length >= 3 ? 'banco' : (envFallback ? 'env' : 'nenhum') });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/configuracoes', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from } = req.body;
    if (!smtp_host || !smtp_user) {
      res.status(400).json({ erro: 'Campos obrigatorios: smtp_host, smtp_user' });
      return;
    }
    const pool = await getConfigStore();
    const { encryptSecret } = require('./crypto');
    const existing = await pool.query(`SELECT chave FROM webapp_config WHERE chave = 'smtp_pass'`);
    if (!smtp_pass && existing.rows.length === 0) {
      res.status(400).json({ erro: 'Senha SMTP obrigatoria na primeira configuracao' });
      return;
    }
    const upsert = async (chave: string, valor: string) => {
      await pool.query(
        `INSERT INTO webapp_config (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = $2`,
        [chave, valor],
      );
    };
    await upsert('smtp_host', smtp_host);
    await upsert('smtp_port', smtp_port || '587');
    await upsert('smtp_user', smtp_user);
    if (smtp_pass) await upsert('smtp_pass', encryptSecret(smtp_pass));
    await upsert('smtp_from', smtp_from || smtp_user);
    res.json({ sucesso: true, mensagem: 'SMTP configurado com sucesso' });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/configuracoes/testar-email', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const smtp = await getSmtpConfig();
    if (!smtp) {
      res.status(503).json({ erro: 'SMTP nao configurado. Va em Configuracoes > Email.' });
      return;
    }
    const { destinatario } = req.body;
    if (!destinatario) { res.status(400).json({ erro: 'Informe o email destinatario' }); return; }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtp.host, port: Number(smtp.port), secure: Number(smtp.port) === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transporter.sendMail({
      from: `"Ponte SEFAZ" <${smtp.from}>`,
      to: destinatario,
      subject: 'Teste de e-mail — Ponte SEFAZ',
      html: '<h2>Email de teste</h2><p>Se voce recebeu esta mensagem, o SMTP esta configurado corretamente!</p><p style="color:#64748b;font-size:12px">Ponte SEFAZ — Emissor de notas fiscais eletrônicas</p>',
    });
    res.json({ sucesso: true, mensagem: `Email de teste enviado para ${destinatario}` });
  } catch (err: any) {
    res.status(500).json({ erro: `Falha ao enviar: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// POST /api/enviar-email — envia DANFE+XML por email (SMTP configurável)
// ---------------------------------------------------------------------------
app.post('/api/enviar-email', async (req, res) => {
  // Esta rota nao tinha guarda nenhuma, e o download da mesma nota tem duas.
  //
  // A chave de acesso e publica — vai impressa no DANFE de todo mundo. Sem
  // conferir o dono, qualquer cliente de API mandava o XML e o DANFE de
  // QUALQUER outro cliente para o e-mail que quisesse, pelo SMTP da API mae. O
  // gemeo de NFS-e (POST /api/nfse/enviar-email) ja fazia certo, com comentario
  // explicando por que; este ficou para tras.
  if (bloqueiaEscrita(req, res)) return;
  try {
    const { chaveAcesso, destinatarioEmail } = req.body;
    if (!chaveAcesso || !destinatarioEmail) {
      res.status(400).json({ erro: 'Campos obrigatorios: chaveAcesso, destinatarioEmail' });
      return;
    }
    const smtp = await getSmtpConfig();
    if (!smtp) {
      res.status(503).json({ erro: 'Email nao configurado. Va em Configuracoes > Email para configurar o SMTP.' });
      return;
    }
    const smtpHost = smtp.host;
    const smtpPort = smtp.port;
    const smtpUser = smtp.user;
    const smtpPass = smtp.pass;
    const smtpFrom = smtp.from;

    const storage = await getStorage();
    const nota = await storage.getNota(chaveAcesso);
    // Mesma guarda do download (`notaAcessivel`): a chave e publica, o acervo
    // nao. Responde 404, e nao 403, para nao confirmar que a nota existe.
    if (!nota || !(await notaAcessivel(req, nota))) {
      res.status(404).json({ erro: 'Nota nao encontrada para esta empresa.' });
      return;
    }

    const attachments: { filename: string; content: string | Buffer; contentType?: string }[] = [];
    if (nota.xml) {
      attachments.push({ filename: `NFe_${chaveAcesso}.xml`, content: nota.xml, contentType: 'application/xml' });
    }
    if (nota.nfeJson) {
      try {
        const nfeProcXml = nota.xml && nota.xml.includes('<protNFe') ? nota.xml : undefined;
        const pdf = await gerarDanfePdf({
          nfeProcXml,
          nfe: nota.nfeJson,
          chave: chaveAcesso,
          nProt: nota.protocolo || '-',
          dhRecbto: nota.dhRecbto || '',
          // Mandar por e-mail o DANFE de uma nota cancelada, sem marca, e pior
          // que baixar: o documento sai da nossa mao e vai parar no arquivo do
          // destinatario com aparencia de nota boa.
          carimbo: carimboDoStatus(nota.status),
        });
        attachments.push({ filename: `DANFE_${chaveAcesso}.pdf`, content: pdf, contentType: 'application/pdf' });
      } catch { /* DANFE falhou, envia só XML */ }
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const emp = await resolveEmpresa(req);
    const nomeEmpresa = emp.fantasia || emp.razaoSocial;
    await transporter.sendMail({
      from: `"${nomeEmpresa}" <${smtpFrom}>`,
      to: destinatarioEmail,
      subject: `NF-e ${nota.numero || ''}/${nota.serie || ''} - ${nomeEmpresa}`,
      html: `<p>Segue anexo a NF-e <strong>${nota.numero}/${nota.serie}</strong> emitida por <strong>${nomeEmpresa}</strong>.</p>
             <p>Chave de acesso: <code>${chaveAcesso}</code></p>
             <p>Valor: R$ ${nota.vNF || '0.00'}</p>`,
      attachments,
    });

    res.json({ sucesso: true, mensagem: `Email enviado para ${destinatarioEmail}` });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/manifestar — manifestação do destinatário (eventos 210200-210240)
// ---------------------------------------------------------------------------
app.post('/api/manifestar', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const config = getConfig();
    const emp = await resolveEmpresa(req);
    const { chaveAcesso, tipoEvento, justificativa } = req.body;
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.body.ambiente);
    if (!ambiente) return;

    const tiposValidos: Record<string, string> = {
      '210200': 'Confirmacao da Operacao',
      '210210': 'Ciencia da Operacao',
      '210220': 'Desconhecimento da Operacao',
      '210240': 'Operacao nao Realizada',
    };
    if (!chaveAcesso || !tipoEvento || !tiposValidos[tipoEvento]) {
      res.status(400).json({ erro: 'Campos obrigatorios: chaveAcesso, tipoEvento (210200/210210/210220/210240)' });
      return;
    }
    if (tipoEvento === '210240' && (!justificativa || justificativa.length < 15)) {
      res.status(400).json({ erro: 'Operacao nao Realizada exige justificativa (min 15 chars)' });
      return;
    }

    const cUF = UF_TO_IBGE[emp.uf] || '31';
    const nSeq = 1;
    const dhEvento = gerarDhEmi();
    const descEvento = tiposValidos[tipoEvento];

    const detEvento = tipoEvento === '210240'
      ? `<detEvento versao="1.00"><descEvento>${descEvento}</descEvento><xJust>${justificativa}</xJust></detEvento>`
      : `<detEvento versao="1.00"><descEvento>${descEvento}</descEvento></detEvento>`;

    const eventId = `ID${tipoEvento}${chaveAcesso}0${nSeq}`;
    const eventoXml = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<idLote>${Date.now()}</idLote>` +
      `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<infEvento Id="${eventId}">` +
      `<cOrgao>91</cOrgao><tpAmb>${ambiente}</tpAmb>` +
      `<CNPJ>${emp.cnpj}</CNPJ>` +
      `<chNFe>${chaveAcesso}</chNFe>` +
      `<dhEvento>${dhEvento}</dhEvento>` +
      `<tpEvento>${tipoEvento}</tpEvento>` +
      `<nSeqEvento>${nSeq}</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      detEvento +
      `</infEvento></evento></envEvento>`;

    const pfxBuffer = emp.pfxBuffer;
    const signer = new Signer(pfxBuffer, emp.pfxPassword);
    const signedXml = signer.sign(eventoXml, eventId);

    const soapClient = new SoapClient({ timeout: config.timeoutMs, pfxBuffer, pfxPassword: emp.pfxPassword });
    const endpoints = getEndpoints(emp.uf, ambiente);
    const responseXml = await soapClient.send(signedXml, endpoints.NFeRecepcaoEvento, 'NFeRecepcaoEvento');
    const parsed = parseEventoResponse(responseXml);

    const cStat = parsed.infEvento?.cStat || parsed.cStat;
    const xMotivo = parsed.infEvento?.xMotivo || parsed.xMotivo;
    const sucesso = cStat === '135' || cStat === '573';

    // Anotar na nota guardada SO depois do aceite. Registrar antes deixaria a
    // tela dizendo "confirmada" para uma nota que a SEFAZ recusou. 573 e evento
    // duplicado — ja manifestada antes, entao a anotacao vale igual.
    if (sucesso) {
      try {
        await (await getNfeRecebidaStore()).registrarManifestacao(chaveAcesso, tipoEvento);
      } catch { /* a manifestacao valeu na SEFAZ; nao guardar aqui nao a desfaz */ }
    }

    res.json({ sucesso, cStat, xMotivo, descEvento, protocoloEvento: parsed.infEvento?.nProt });
  } catch (err: any) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/consulta-dfe — Distribuição DF-e (NF-e recebidas)
// ---------------------------------------------------------------------------
const DIST_DFE_ENDPOINTS = {
  '1': 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  '2': 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};

/**
 * Uma varredura na Distribuicao DF-e da SEFAZ.
 *
 * Extraida da rota para poder ser reusada pela captura com memoria
 * (`/api/nfe/distribuicao`), que faz varias varreduras seguidas avancando o
 * ponteiro. Duplicar o parse do envelope em dois lugares e o caminho garantido
 * para os dois divergirem na proxima mudanca de layout.
 */
async function varrerDistribuicaoDFe(opts: {
  emp: any;
  ambiente: string;
  ultNSU?: string;
  nsu?: string;
}): Promise<{
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documentos: any[];
}> {
  const config = getConfig();
  const cUF = UF_TO_IBGE[opts.emp.uf] || '31';
  const { DistribuicaoDFeGenerator } = require('../infrastructure/xml/DistribuicaoDFeGenerator');
  const gen = new DistribuicaoDFeGenerator();
  const xml = gen.generate(cUF, opts.emp.cnpj, opts.nsu ? undefined : (opts.ultNSU || '0'), opts.nsu);

  const soapClient = new SoapClient({
    timeout: config.timeoutMs, pfxBuffer: opts.emp.pfxBuffer, pfxPassword: opts.emp.pfxPassword,
  });
  const endpoint = DIST_DFE_ENDPOINTS[opts.ambiente as '1' | '2'] || DIST_DFE_ENDPOINTS['2'];
  const responseXml = await soapClient.send(xml, endpoint, 'NFeDistribuicaoDFe');

  const cStat = responseXml.match(/<cStat[^>]*>(\d+)<\/cStat>/)?.[1] || '';
  const xMotivo = responseXml.match(/<xMotivo[^>]*>([^<]+)<\/xMotivo>/)?.[1] || '';
  const ultNSUResp = responseXml.match(/<ultNSU[^>]*>(\d+)<\/ultNSU>/)?.[1] || (opts.ultNSU || '0');
  const maxNSU = responseXml.match(/<maxNSU[^>]*>(\d+)<\/maxNSU>/)?.[1] || '0';

  // Extrair documentos (docZip com schema=resNFe ou procNFe)
  const documentos: any[] = [];
  const docZipRegex = /<docZip[^>]*NSU="(\d+)"[^>]*schema="([^"]*)"[^>]*>([^<]+)<\/docZip>/g;
  let match;
  while ((match = docZipRegex.exec(responseXml)) !== null) {
    const docNsu = match[1];
    const schema = match[2] || '';
    const b64gz = match[3]!;
    try {
      const zlib = require('zlib');
      const xmlDoc = zlib.gunzipSync(Buffer.from(b64gz, 'base64')).toString('utf-8');

      const chNFe = xmlDoc.match(/<chNFe[^>]*>([^<]+)<\/chNFe>/)?.[1] || '';
      const xNome = xmlDoc.match(/<xNome[^>]*>([^<]+)<\/xNome>/)?.[1] || '';
      const cnpjEmit = xmlDoc.match(/<CNPJ[^>]*>([^<]+)<\/CNPJ>/)?.[1] || '';
      const vNF = xmlDoc.match(/<vNF[^>]*>([^<]+)<\/vNF>/)?.[1] || '';
      const dhEmi = xmlDoc.match(/<dhEmi[^>]*>([^<]+)<\/dhEmi>/)?.[1] || '';
      const tpNF = xmlDoc.match(/<tpNF[^>]*>([^<]+)<\/tpNF>/)?.[1] || '';
      const cSitNFe = xmlDoc.match(/<cSitNFe[^>]*>([^<]+)<\/cSitNFe>/)?.[1] || '';

      documentos.push({
        nsu: docNsu,
        schema,
        chNFe,
        emitente: xNome,
        cnpjEmit,
        vNF,
        dhEmi,
        tpNF,
        cSitNFe,
        xml: schema.includes('procNFe') ? xmlDoc : undefined,
      });
    } catch { /* skip invalid docs */ }
  }

  return { cStat, xMotivo, ultNSU: ultNSUResp, maxNSU, documentos };
}

app.post('/api/consulta-dfe', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.body.ambiente);
    if (!ambiente) return;

    const r = await varrerDistribuicaoDFe({
      emp,
      ambiente,
      ultNSU: req.body.ultNSU || '0',
      nsu: req.body.nsu || undefined,
    });

    // 137 = nenhum documento localizado; 138 = documento(s) localizado(s).
    res.json({
      sucesso: r.cStat === '137' || r.cStat === '138',
      cStat: r.cStat,
      xMotivo: r.xMotivo,
      ultNSU: r.ultNSU,
      maxNSU: r.maxNSU,
      documentos: r.documentos,
      total: r.documentos.length,
    });
  } catch (err: any) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// NF-e recebidas com memoria — o mesmo desenho ja provado na NFS-e
// ---------------------------------------------------------------------------

/**
 * Busca o que chegou desde a ultima vez e GUARDA.
 *
 * A diferenca para `/api/consulta-dfe` e inteira: aqui o ponteiro de NSU mora
 * no servidor. Nao e conforto — consultar a Distribuicao DF-e repetidamente sem
 * avancar o NSU devolve `cStat 656` (consumo indevido) e a SEFAZ bloqueia o
 * CNPJ por UMA HORA. Uma tela em que cada visita recomeca do zero causa isso
 * sozinha, e o bloqueio atinge a empresa inteira, nao so a tela.
 */
app.post('/api/nfe/distribuicao', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    // A distribuicao so existe em producao: a base do ambiente restrito nao tem
    // documento real nenhum, e consultar la e sempre lista vazia.
    const ambiente = '1';
    const store = await getNfeRecebidaStore();
    const b = req.body || {};

    if (b.desdeInicio) await store.zerarPonteiro(emp.cnpj, ambiente);
    let { ultimoNsu, maxNsu } = await store.ponteiro(emp.cnpj, ambiente);

    // Ate 20 varreduras por chamada, como na NFS-e. Cada uma traz ate 50
    // documentos; mais que isso estoura o tempo da funcao serverless.
    const maxLotes = Math.min(Number(b.lotes) || 5, 20);
    let novas = 0;
    let lidas = 0;
    let cStat = '';
    let xMotivo = '';

    for (let i = 0; i < maxLotes; i++) {
      const r = await varrerDistribuicaoDFe({ emp, ambiente, ultNSU: String(ultimoNsu) });
      cStat = r.cStat;
      xMotivo = r.xMotivo;

      // 656 = consumo indevido. Parar na hora e devolver o motivo: insistir e o
      // que transforma um aviso em bloqueio de uma hora.
      if (cStat === '656') break;

      for (const d of r.documentos) {
        if (!d.chNFe) continue;
        lidas++;
        const virou = await store.salvar({
          chaveAcesso: d.chNFe,
          empresaCnpj: emp.cnpj,
          nsu: Number(d.nsu) || 0,
          schema: d.schema || 'resNFe',
          emitenteCnpj: d.cnpjEmit || undefined,
          emitenteNome: d.emitente || undefined,
          valorNota: d.vNF || undefined,
          tipoOperacao: d.tpNF || undefined,
          situacao: d.cSitNFe || undefined,
          emitidaEm: d.dhEmi || undefined,
          xml: d.xml,
        });
        if (virou) novas++;
      }

      const novoUltimo = Number(r.ultNSU) || ultimoNsu;
      maxNsu = Number(r.maxNSU) || maxNsu;
      await store.registrarPonteiro(emp.cnpj, { ultimoNsu: novoUltimo, maxNsu }, ambiente);

      const passo = proximoPasso({
        cStat, nsuAntes: ultimoNsu, nsuDepois: novoUltimo, maxNsu,
      });
      ultimoNsu = novoUltimo;
      if (passo !== 'continuar') break;
    }

    res.json({
      sucesso: cStat !== '656',
      cStat,
      xMotivo,
      novas,
      lidas,
      ultimoNsu,
      maxNsu,
      // Verdadeiro quando o ponteiro alcancou o fim da fila da SEFAZ.
      emDia: maxNsu > 0 && ultimoNsu >= maxNsu,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/nfe/distribuicao', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const store = await getNfeRecebidaStore();
    const limite = Math.min(Number(req.query.limit) || 100, 500);
    const ponteiro = await store.ponteiro(emp.cnpj, '1');
    res.json({ ...ponteiro, notas: await store.listar(emp.cnpj, limite) });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

/**
 * O XML da nota recebida — quando ele existe.
 *
 * A distribuicao entrega quase tudo como RESUMO. O XML completo so vem depois
 * da manifestacao, entao "ainda nao tenho" e resposta legitima aqui, e precisa
 * dizer o proximo passo em vez de um 404 seco.
 */
app.get('/api/nfe/distribuicao/:chave/xml', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const chave = String(req.params.chave).replace(/\D/g, '');
    const store = await getNfeRecebidaStore();
    const nota = await store.obter(chave);
    if (!nota || nota.empresaCnpj !== emp.cnpj) {
      res.status(404).json({ erro: 'Nota nao encontrada para esta empresa.' });
      return;
    }
    if (!nota.xml) {
      res.status(409).json({
        erro: 'Esta nota veio so como resumo — o XML completo ainda nao foi liberado.',
        comoResolver: 'Manifeste a nota (Ciencia da Operacao ja basta) e busque de novo: '
          + 'a SEFAZ so entrega o XML depois da manifestacao.',
      });
      return;
    }
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="nfe-${chave}.xml"`);
    res.send(nota.xml);
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/importar-csv — importação em lote de produtos via CSV
// ---------------------------------------------------------------------------
app.post('/api/importar-csv', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ erro: 'Envie { csv: "conteudo CSV" }. Colunas: codigo;descricao;ncm;cfop;unidade;valorUnitario;cstCsosn;aliqIcms' });
      return;
    }

    const lines = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (lines.length < 2) {
      res.status(400).json({ erro: 'CSV deve ter cabecalho + pelo menos 1 linha de dados' });
      return;
    }

    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const store = await getProdutoStore();
    let importados = 0;
    const erros: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      const descricao = row['descricao'] || row['desc'] || row['produto'] || '';
      const ncm = (row['ncm'] || '').replace(/\D/g, '');
      if (!descricao || !ncm) { erros.push(`Linha ${i + 1}: descricao ou ncm vazio`); continue; }

      try {
        await store.salvar({
          empresaCnpj: emp.cnpj,
          codigo: row['codigo'] || row['cod'] || row['sku'] || String(Date.now()).slice(-6),
          descricao,
          ncm,
          cfop: cfopDeCadastro(row['cfop'] || '5102').cfop || '5102',
          unidade: row['unidade'] || row['un'] || 'UN',
          valorUnitario: row['valorunitario'] || row['valor'] || row['preco'] || undefined,
          origem: row['origem'] || '0',
          cstCsosn: row['cstcsosn'] || row['cst'] || row['csosn'] || (emp.crt === '3' ? '00' : '102'),
          aliqIcms: row['aliqicms'] || row['icms'] || undefined,
          cstIpi: row['cstipi'] || '53',
          cstPis: '99',
          cstCofins: '99',
        });
        importados++;
      } catch (e: any) {
        erros.push(`Linha ${i + 1}: ${e.message}`);
      }
    }

    res.json({ sucesso: true, importados, total: lines.length - 1, erros: erros.length ? erros : undefined });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/importar-xlsx — importação via planilha Excel
// ---------------------------------------------------------------------------
app.post('/api/importar-xlsx', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const { xlsxBase64 } = req.body;
    if (!xlsxBase64) {
      res.status(400).json({ erro: 'Envie { xlsxBase64: "base64 do arquivo .xlsx" }' });
      return;
    }
    const XLSX = require('xlsx');
    const buf = Buffer.from(xlsxBase64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      res.status(400).json({ erro: 'Planilha vazia ou sem dados' });
      return;
    }

    const store = await getProdutoStore();
    let importados = 0;
    const erros: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const norm = (key: string) => {
        const val = r[key] ?? r[key.toLowerCase()] ?? r[key.toUpperCase()] ?? '';
        return String(val).trim();
      };
      const descricao = norm('descricao') || norm('Descricao') || norm('DESCRICAO') || norm('produto') || '';
      const ncm = (norm('ncm') || norm('NCM') || '').replace(/\D/g, '');
      if (!descricao || !ncm) { erros.push(`Linha ${i + 2}: descricao ou ncm vazio`); continue; }

      try {
        await store.salvar({
          empresaCnpj: emp.cnpj,
          codigo: norm('codigo') || norm('Codigo') || norm('COD') || String(Date.now()).slice(-6),
          descricao,
          ncm,
          cfop: cfopDeCadastro(norm('cfop') || norm('CFOP') || '5102').cfop || '5102',
          unidade: norm('unidade') || norm('UN') || 'UN',
          valorUnitario: norm('valorUnitario') || norm('valor_unitario') || norm('preco') || undefined,
          origem: norm('origem') || '0',
          cstCsosn: norm('cstCsosn') || norm('cst_csosn') || norm('CST') || (emp.crt === '3' ? '00' : '102'),
          aliqIcms: norm('aliqIcms') || norm('aliq_icms') || undefined,
          cstIpi: norm('cstIpi') || '53',
          cstPis: '99',
          cstCofins: '99',
        });
        importados++;
      } catch (e: any) {
        erros.push(`Linha ${i + 2}: ${e.message}`);
      }
    }

    res.json({ sucesso: true, importados, total: rows.length, erros: erros.length ? erros : undefined });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// Uso e plano
//
// Nao ha autoatendimento de assinatura. Plano se negocia caso a caso e quem o
// muda e o admin, pela aba de clientes — o checkout que existia aqui nunca
// chegou a ser configurado e so servia para prometer um caminho inexistente.
// ---------------------------------------------------------------------------
import { BillingStore } from './billing';
import { PLANOS as CATALOGO_DE_PLANOS } from './planos';

let _billingStore: BillingStore | null = null;
async function getBillingStore(): Promise<BillingStore> {
  if (_billingStore) return _billingStore;
  const dbUrl = urlDoBanco();
  if (!dbUrl) throw new Error('Billing exige NFE_DB_URL (Postgres)');
  _billingStore = new BillingStore(dbUrl);
  await _billingStore.init();
  return _billingStore;
}

/**
 * O catalogo de planos, pelo que cada um PERMITE.
 *
 * Preco fica de fora de proposito: e negociado caso a caso e nao pertence ao
 * codigo. O que a tela precisa mostrar e o que muda na pratica — quais
 * documentos, quantas notas, quantos CNPJs, se tem webhook.
 */
app.get('/api/billing/planos', (_req, res) => {
  res.json({
    planos: CATALOGO_DE_PLANOS.map(p => ({
      id: p.id,
      nome: p.nome,
      descricao: p.perfil,
      documentos: p.documentos,
      escolheUm: p.escolheUm,
      limiteNotas: p.limiteNotas,
      empresas: p.empresas,
      webhooks: p.webhooks,
      cor: p.cor,
    })),
  });
});

/**
 * Uso do mes contra o limite do plano.
 *
 * O plano sai de `planoDoCliente`, que e a MESMA fonte que o limitador usa para
 * barrar a emissao. Antes vinha de `webapp_billing.plano` — coluna que so o
 * checkout escrevia e que nasce 'free' —, entao a tela dizia um plano e o
 * sistema aplicava outro: cliente MAX via "10 notas/mes" e nao entendia por que
 * o numero nao batia com o combinado.
 */
app.get('/api/billing/uso', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const plano = planoDe(await planoDoCliente(emp.cnpj));
    const store = await getBillingStore();
    const billing = await store.obterOuCriar(emp.cnpj);
    res.json({
      plano: { id: plano.id, nome: plano.nome, descricao: plano.perfil, limiteNotas: plano.limiteNotas },
      notasMes: billing.notasMes,
      mesReferencia: billing.mesReferencia,
      percentualUso: plano.limiteNotas > 0 ? Math.round((billing.notasMes / plano.limiteNotas) * 100) : 0,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// ===========================================================================
// NFS-e — Nota Fiscal de Serviço Eletrônica (Sistema Nacional)
//
// Documento e fisco diferentes da NF-e: quem autoriza é a SEFIN Nacional, o
// transporte é REST em vez de SOAP, e a nota volta autorizada na resposta —
// não há lote nem protocolo a consultar depois.
//
// Duas condições fora do nosso controle precisam estar satisfeitas para a
// emissão passar: o município tem que ser aderente ao Emissor Nacional e o
// CNPJ tem que constar como contribuinte nele. Os erros E0039 e E0084 da SEFIN
// são exatamente esses, e o endpoint os repassa sem traduzir para não mascarar
// a causa.
// ===========================================================================

/** Monta o caso de uso a partir da empresa da requisição. */
function nfseUseCaseDe(emp: EmpresaContext, ambiente: '1' | '2'): NfseUseCase {
  return new NfseUseCase({
    signer: new Signer(emp.pfxBuffer, emp.pfxPassword),
    client: new SefinClient({ pfx: emp.pfxBuffer, senhaPfx: emp.pfxPassword, ambiente }),
    ambiente,
  });
}

/**
 * PDF do DANFSE.
 *
 * Preferência para o oficial do ADN, como o DANFE prefere o sped-da. Cai no
 * gerador local quando o ADN não responde — e isso é o caso normal em
 * homologação, onde o módulo `/danfse` simplesmente não existe.
 */
async function gerarDanfsePdf(
  emp: EmpresaContext,
  nota: { xml?: string; status: string; ambiente: string },
  chave: string,
): Promise<{ pdf: Buffer; origem: 'adn' | 'local' }> {
  // A API de DANFSe do ambiente nacional foi sobrestada em 01/07/2026 pela NT
  // 008/2026 — gerar o documento passou a ser obrigação de quem emite. Não
  // adianta mais tentar o ADN: respondia 404 e caía calado no gerador antigo,
  // que não tem IBS/CBS nem QR Code.
  const pdf = await new DanfseV2Generator().generate(nota.xml || '');

  // O gerador sabe desenhar "CANCELADA", mas so quando o XML diz status 101 — e
  // o XML guardado e o da EMISSAO, que diz 100. O cancelamento e evento
  // posterior e nunca entra nele. Sem isto, a NFS-e cancelada baixava com cara
  // de valida, exatamente como acontecia na NF-e.
  const carimbo = carimboDoStatus(nota.status);
  return { pdf: carimbo ? await carimbarPdf(pdf, carimbo) : pdf, origem: 'local' };
}

/** Endereço da empresa no formato que o DPS espera. */
function enderecoDps(emp: EmpresaContext) {
  return {
    logradouro: emp.endereco.logradouro,
    numero: emp.endereco.numero,
    complemento: emp.endereco.complemento,
    bairro: emp.endereco.bairro,
    codigoMunicipio: emp.endereco.codigoMunicipio,
    uf: emp.uf,
    cep: emp.endereco.cep,
  };
}

// GET /api/nfse/servicos — catálogo de serviços da empresa
app.get('/api/nfse/servicos', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const store = await getNfseStore();
    res.json({ servicos: await store.listarServicos(emp.cnpj) });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// POST /api/nfse/servicos — cadastra ou atualiza um serviço
app.post('/api/nfse/servicos', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    if (!b.codigo || !b.descricao || !b.codigoTributacaoNacional) {
      res.status(400).json({
        erro: 'Informe codigo, descricao e codigoTributacaoNacional.',
        dica: 'O codigo de tributacao nacional tem 6 digitos: item(2) + subitem(2) + desdobro(2). O desdobro comeca em 01.',
      });
      return;
    }
    // Recusa aqui o que a SEFIN recusaria, com a mensagem dizendo o motivo.
    validarServico(String(b.codigoTributacaoNacional), Boolean(b.obra));

    const store = await getNfseStore();
    const salvo = await store.salvarServico({
      empresaCnpj: emp.cnpj,
      codigo: String(b.codigo),
      descricao: String(b.descricao),
      codigoTributacaoNacional: String(b.codigoTributacaoNacional).replace(/\D/g, ''),
      codigoTributacaoMunicipal: b.codigoTributacaoMunicipal || undefined,
      codigoNBS: b.codigoNBS || undefined,
      valorPadrao: numeroFiscal(b.valorPadrao),
      aliquotaIss: numeroFiscal(b.aliquotaIss),
      tributacaoIssqn: String(b.tributacaoIssqn || '1'),
      issRetido: String(b.issRetido || '1'),
      // Percentuais de retencao federal. Vazio nao vira zero: zero e uma
      // decisao ("nao retem"), vazio e "ninguem disse ainda" — e a emissao
      // trata os dois de forma diferente.
      aliqIrrf: b.aliqIrrf || undefined,
      aliqCsll: b.aliqCsll || undefined,
      aliqInss: b.aliqInss || undefined,
      aliqPis: b.aliqPis || undefined,
      aliqCofins: b.aliqCofins || undefined,
    });
    res.json({ sucesso: true, servico: salvo });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// DELETE /api/nfse/servicos/:id
app.delete('/api/nfse/servicos/:id', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const store = await getNfseStore();
    const ok = await store.removerServico(emp.cnpj, Number(req.params.id));
    res.json({ sucesso: ok });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/proximo-numero — próximo número livre da DPS
app.get('/api/nfse/proximo-numero', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const ambiente = resolverAmbiente(req, res, emp.ambiente, req.query.ambiente);
    if (!ambiente) return;
    const serie = String(req.query.serie || '1');
    const store = await getNfseStore();
    res.json({ serie, ambiente, numero: await store.proximoNumero(emp.cnpj, serie, ambiente) });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/historico — notas de serviço emitidas
app.get('/api/nfse/historico', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const store = await getNfseStore();
    const limite = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ notas: await store.listarNotas(emp.cnpj, limite) });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// POST /api/nfse/emitir
app.post('/api/nfse/emitir', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    const ambiente = resolverAmbiente(req, res, emp.ambiente, b.ambiente);
    if (!ambiente) return;

    // Idem NFC-e: precisa existir antes do gate de cota.
    const simulando = querSimular(b.simular) || querSimular(req.query['simular']);

    // Verificar serviço contratado e billing (API clients)
    if ((req as any).tenantCnpj && !(req as any).isAdmin) {
      if (!await verificarServicoContratado(emp.cnpj, 'nfse')) {
        errorResponse(res, 'SERVICE_NOT_ENABLED', { service: 'nfse' }); return;
      }
      // Mesma excecao da NF-e e da NFC-e: previa nao cobra cota.
      if (ambiente === '1' && !simulando) {
        const billing = await verificarBilling(emp.cnpj);
        if (!billing.permitido) {
          errorResponse(res, 'BILLING_REQUIRED', { usado: billing.usado, limite: billing.limite }); return;
        }
      }
    }

    if (!b.tomador || (!b.tomador.cnpj && !b.tomador.cpf && !b.tomador.nif)) {
      res.status(400).json({ erro: 'Informe o tomador com cnpj, cpf ou nif.' });
      return;
    }

    // O município do prestador precisa ter aderido ao Emissor Nacional. Sem
    // isso, a DPS é montada, assinada, transmitida e volta E0037 — um código
    // que não diz ao operador que o problema é a prefeitura dele, não a nota.
    //
    // Só bloqueia quando o ADN RESPONDEU que não emite. ADN fora do ar não pode
    // virar bloqueio: seria impedir de faturar por indisponibilidade de
    // terceiro, e o `sucesso` existe separado do `podeEmitir` justamente para
    // essa distinção não se perder.
    try {
      const convenio = await new SefinClient({
        pfx: emp.pfxBuffer,
        senhaPfx: emp.pfxPassword,
        ambiente,
      }).convenioMunicipio(emp.endereco.codigoMunicipio);
      if (convenio.sucesso && !convenio.podeEmitir) {
        res.status(400).json({
          sucesso: false,
          erro: `O municipio ${emp.endereco.nomeMunicipio}/${emp.uf} (codigo ${emp.endereco.codigoMunicipio}) `
            + 'nao aderiu ao Emissor Nacional de NFS-e, entao nenhuma nota de servico pode ser emitida por ele. '
            + (convenio.podeBaixar
              ? 'Ele participa apenas do Ambiente Nacional, o que permite receber e consultar notas, mas nao emitir. '
              : '')
            + 'A adesao e feita pela prefeitura — fale com ela ou com a contabilidade.',
          codigoMunicipio: emp.endereco.codigoMunicipio,
          podeBaixar: convenio.podeBaixar,
        });
        return;
      }
    } catch { /* indisponibilidade de terceiro não impede emitir */ }

    const store = await getNfseStore();

    // Serviço vem do catálogo (por `servicoCodigo`) ou inline no corpo. O
    // catálogo existe para o ERP não repetir cTribNac e alíquota a cada nota.
    let servico = b.servico || {};
    if (b.servicoCodigo) {
      const doCatalogo = (await store.listarServicos(emp.cnpj))
        .find((s) => s.codigo === String(b.servicoCodigo));
      if (!doCatalogo) {
        res.status(400).json({ erro: `Servico "${b.servicoCodigo}" nao encontrado no catalogo da empresa.` });
        return;
      }
      servico = {
        codigoTributacaoNacional: doCatalogo.codigoTributacaoNacional,
        codigoTributacaoMunicipal: doCatalogo.codigoTributacaoMunicipal,
        codigoNBS: doCatalogo.codigoNBS,
        descricao: servico.descricao || doCatalogo.descricao,
        ...servico,
      };
      if (!b.valorServico && doCatalogo.valorPadrao) b.valorServico = doCatalogo.valorPadrao;
      if (!b.aliquotaIss && doCatalogo.aliquotaIss) b.aliquotaIss = doCatalogo.aliquotaIss;
      if (!b.tributacaoIssqn) b.tributacaoIssqn = doCatalogo.tributacaoIssqn;
      if (!b.issRetido) b.issRetido = doCatalogo.issRetido;
    }

    if (!servico.codigoTributacaoNacional) {
      res.status(400).json({
        erro: 'Informe servico.codigoTributacaoNacional ou servicoCodigo do catalogo.',
      });
      return;
    }

    const serie = String(b.serie || '1');
    const numero = String(b.numero || await store.proximoNumero(emp.cnpj, serie, ambiente));

    const entrada: DpsContextInput = {
      ambiente,
      serie,
      numero,
      dataEmissao: gerarDhEmiDps(),
      competencia: b.competencia || gerarCompetencia(),
      codigoMunicipioEmissor: emp.endereco.codigoMunicipio,
      tipoEmitente: '1',
      prestador: {
        cnpj: emp.cnpj,
        im: emp.im || undefined,
        razaoSocial: emp.razaoSocial,
        endereco: enderecoDps(emp),
        // CRT 1 e 2 são Simples Nacional; 3 é regime normal.
        opSimplesNacional: emp.crt === '3' ? '1' : '3',
        regimeApuracaoSN: emp.crt === '3' ? undefined : '1',
        regimeEspecial: String(b.regimeEspecial || '0') as any,
      },
      tomador: {
        cnpj: b.tomador.cnpj || undefined,
        cpf: b.tomador.cpf || undefined,
        nif: b.tomador.nif || undefined,
        im: b.tomador.im || undefined,
        razaoSocial: b.tomador.razaoSocial || b.tomador.nome || 'CONSUMIDOR',
        endereco: b.tomador.endereco,
        email: b.tomador.email || undefined,
        fone: b.tomador.fone || undefined,
      },
      servico: {
        codigoTributacaoNacional: String(servico.codigoTributacaoNacional).replace(/\D/g, ''),
        codigoTributacaoMunicipal: servico.codigoTributacaoMunicipal || undefined,
        descricao: servico.descricao || 'SERVICO PRESTADO',
        codigoNBS: servico.codigoNBS || undefined,
        codigoMunicipioPrestacao: servico.codigoMunicipioPrestacao || emp.endereco.codigoMunicipio,
        informacoesComplementares: servico.informacoesComplementares || undefined,
        obra: servico.obra || b.obra || undefined,
        comercioExterior: servico.comercioExterior || b.comercioExterior || undefined,
        atividadeEvento: servico.atividadeEvento || b.atividadeEvento || undefined,
      },
      valores: {
        // O gerador normaliza os decimais para o formato do XSD; aqui só
        // repassa o que o ERP mandou, em qualquer notação.
        valorServico: String(b.valorServico ?? '0'),
        descontoIncondicionado: b.descontoIncondicionado,
        descontoCondicionado: b.descontoCondicionado,
        tributacaoISSQN: String(b.tributacaoIssqn || '1'),
        tipoImunidade: b.tipoImunidade,
        exigibilidadeSuspensa: b.exigibilidadeSuspensa,
        beneficioMunicipal: b.beneficioMunicipal,
        aliquotaISS: b.aliquotaIss,
        issRetido: String(b.issRetido || '1') as '1' | '2' | '3',
        deducaoReducao: b.deducaoReducao,
        tributosFederais: b.retencoes || b.tributosFederais,
      },
      // IBS/CBS é opcional no XSD hoje. Só vai quando o ERP pedir, porque o
      // cIndOp não tem valor seguro para assumir — ver /api/docs.
      ibsCbs: b.ibsCbs,
      // Substituição é declarada na nota nova, não por evento (E1861).
      substituicao: b.substituicao,
      intermediario: b.intermediario,
    };

    // Prévia da NFS-e. Tudo que a rota confere antes daqui — tomador, serviço no
    // catálogo, código de tributação, adesão do município ao convênio — já foi
    // conferido, e é justamente onde a emissão costuma parar. O que sobra para a
    // SEFIN nacional é a validação dela, que só o envio revela.
    //
    // Existe porque o contrato exige o botão "Ver prévia" em toda tela de
    // emissão. Sem ele aqui, uma plataforma que seguisse o contrato ligaria esse
    // botão à emissão real — e nota de serviço autorizada não se apaga.
    if (simulando) {
      const valor = Number(String(entrada.valores.valorServico).replace(',', '.')) || 0;
      const aliq = Number(String(entrada.valores.aliquotaISS ?? '0').replace(',', '.')) || 0;
      const iss = Math.round(valor * aliq) / 100;
      res.json({
        simulacao: true,
        sucesso: true,
        modelo: 'nfse',
        ambiente,
        dps: entrada,
        // O ISS é estimativa da alíquota informada; quem fecha a conta é o
        // município, e é por isso que isto se chama prévia.
        estimativa: {
          valorServico: valor.toFixed(2),
          aliquotaIss: aliq.toFixed(2),
          valorIss: iss.toFixed(2),
          valorLiquido: (entrada.valores.issRetido === '1' ? valor : valor - iss).toFixed(2),
        },
        aviso: 'Previa: nada foi transmitido e nenhuma numeracao foi consumida. '
          + 'A validacao final e da SEFIN nacional, no envio.',
      });
      return;
    }

    const resultado = await nfseUseCaseDe(emp, ambiente).emitir(entrada);

    if (!resultado.sucesso) {
      res.status(400).json({
        sucesso: false,
        erros: resultado.erros,
        idDps: resultado.idDps,
        ambiente,
      });
      return;
    }

    // Só avança a numeração depois da autorização: número queimado por
    // rejeição vira buraco na sequência sem necessidade.
    await store.registrarNumeroUsado(emp.cnpj, serie, ambiente, Number(numero));

    await store.salvarNota({
      chaveAcesso: resultado.chaveAcesso!,
      empresaCnpj: emp.cnpj,
      numero: resultado.nota?.numero,
      serie,
      numeroDps: numero,
      idDps: resultado.idDps,
      ambiente,
      tomadorNome: entrada.tomador.razaoSocial,
      tomadorDoc: entrada.tomador.cnpj || entrada.tomador.cpf || '',
      codigoServico: entrada.servico.codigoTributacaoNacional,
      descricaoServico: entrada.servico.descricao,
      valorServico: entrada.valores.valorServico,
      valorIssqn: resultado.nota?.valores.issqn,
      valorLiquido: resultado.nota?.valores.liquido,
      status: 'AUTORIZADA',
      xml: resultado.xmlNfse,
      emitidaEm: new Date().toISOString(),
    });

    despacharWebhook(emp.cnpj, 'nfse.authorized', {
      chaveAcesso: resultado.chaveAcesso,
      numero: resultado.nota?.numero,
      idDps: resultado.idDps,
    }, ambiente);

    res.json({
      sucesso: true,
      chaveAcesso: resultado.chaveAcesso,
      numero: resultado.nota?.numero,
      idDps: resultado.idDps,
      ambiente,
      nota: resultado.nota,
      alertas: resultado.alertas,
      // O XML estava sendo gravado e não devolvido: quem emitia por aqui ficava
      // sem o documento na mão, e nem sabia que havia onde buscá-lo. O PDF vem
      // por rota própria porque a DANFSE oficial é buscada no ADN e não vale
      // atrasar a resposta da emissão por causa dela.
      arquivo: `NFSe_${resultado.chaveAcesso}.xml`,
      xml: resultado.xmlNfse,
      downloads: {
        xml: `/api/nfse/${resultado.chaveAcesso}/xml`,
        pdf: `/api/nfse/${resultado.chaveAcesso}/danfse`,
      },
    });
  } catch (err: any) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// POST /api/nfse/cancelar
app.post('/api/nfse/cancelar', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    const chave = String(b.chaveAcesso || b.chave || '').replace(/\D/g, '');
    if (!chave) {
      res.status(400).json({ erro: 'Informe chaveAcesso (50 digitos).' });
      return;
    }

    const store = await getNfseStore();
    const registrada = await store.obterNota(chave);
    const ambiente = resolverAmbiente(req, res, registrada?.ambiente || emp.ambiente, b.ambiente);
    if (!ambiente) return;

    const resultado = await nfseUseCaseDe(emp, ambiente).cancelar({
      chaveAcesso: chave,
      cnpjAutor: emp.cnpj,
      motivo: String(b.motivo || '1') as any,
      justificativa: String(b.justificativa || ''),
    });

    if (resultado.sucesso) {
      await store.atualizarStatus(chave, 'CANCELADA');
      despacharWebhook(emp.cnpj, 'nfse.cancelled', { chaveAcesso: chave }, ambiente);
    }

    res.status(resultado.sucesso ? 200 : 400).json({
      sucesso: resultado.sucesso,
      chaveAcesso: chave,
      erros: resultado.erros,
    });
  } catch (err: any) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// POST /api/nfse/distribuicao — baixa as NFS-e da empresa do ambiente nacional
//
// É o que funciona hoje. Emitir pelo Emissor Nacional exige município aderente
// a ele, e nenhum dos nossos é; mas todos são aderentes ao Ambiente Nacional,
// então as notas emitidas pelo sistema da prefeitura chegam lá e a empresa
// baixa com o próprio certificado.
// ---------------------------------------------------------------------------
// GET /api/nfse/convenio — o município deixa emitir pelo Sistema Nacional?
//
// Emitir exige que a prefeitura seja aderente ao EMISSOR Nacional; baixar nota
// já emitida exige só o AMBIENTE Nacional. A maioria dos municípios está no
// segundo caso e recusa a emissão com E0039 — sem esta consulta, a única forma
// de descobrir era tentar emitir e ser rejeitado.
//
// A resposta é guardada por algumas horas: adesão muda por convênio assinado,
// não de minuto em minuto, e o ADN limita requisições (429).
// ---------------------------------------------------------------------------
const cacheConvenio = new Map<string, { em: number; valor: any }>();
const CONVENIO_TTL_MS = 6 * 60 * 60 * 1000;

app.get('/api/nfse/convenio', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const municipio = String(req.query['municipio'] || emp.endereco.codigoMunicipio || '')
      .replace(/\D/g, '');
    if (municipio.length !== 7) {
      res.status(400).json({ erro: 'Informe o codigo IBGE do municipio (7 digitos).' });
      return;
    }

    const forcar = String(req.query['recarregar'] || '') === '1';
    const cacheado = cacheConvenio.get(municipio);
    if (!forcar && cacheado && Date.now() - cacheado.em < CONVENIO_TTL_MS) {
      res.json({ ...cacheado.valor, doCache: true });
      return;
    }

    // Consulta só faz sentido em produção: a base restrita não reflete adesão real.
    const cliente = new SefinClient({
      pfx: emp.pfxBuffer, senhaPfx: emp.pfxPassword, ambiente: '1', timeoutMs: 20000,
    });
    const r = await cliente.convenioMunicipio(municipio);
    const info = municipioPorCodigo(municipio);

    const valor = {
      municipio,
      municipioNome: info ? `${info.nome} / ${info.uf}` : municipio,
      podeEmitir: r.podeEmitir,
      podeBaixar: r.podeBaixar,
      sucesso: r.sucesso,
      erro: r.erro,
      consultadoEm: new Date().toISOString(),
    };
    if (r.sucesso) cacheConvenio.set(municipio, { em: Date.now(), valor });
    res.json({ ...valor, doCache: false });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

app.post('/api/nfse/distribuicao', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    // A distribuição só existe em produção — a base do ambiente restrito é de
    // teste e não tem as notas reais da empresa.
    const ambiente = '1';
    const store = await getNfseStore();

    const cliente = new SefinClient({
      pfx: emp.pfxBuffer, senhaPfx: emp.pfxPassword, ambiente, timeoutMs: 25000,
    });

    // Recomeça do ponteiro, ou do zero quando se pede recarga completa.
    let nsu = b.desdeInicio ? 0 : await store.ultimoNsu(emp.cnpj, ambiente);
    const maxLotes = Math.min(Number(b.lotes) || 5, 20);

    let novas = 0;
    let lidos = 0;
    let lotes = 0;
    let limiteAtingido = false;

    for (let i = 0; i < maxLotes; i++) {
      const r = await cliente.distribuirDFe(nsu);
      if (r.limiteAtingido) { limiteAtingido = true; break; }
      if (!r.sucesso || !r.documentos.length) break;

      lotes++;
      for (const doc of r.documentos) {
        lidos++;
        if (!doc.chaveAcesso || !doc.xml) continue;
        const nota = parseNfse(doc.xml);
        const inserida = await store.salvarRecebida({
          chaveAcesso: doc.chaveAcesso,
          empresaCnpj: emp.cnpj,
          nsu: doc.nsu,
          tipoDocumento: doc.tipo,
          numero: nota.numero,
          emitenteCnpj: nota.emitente?.cnpj || nota.emitente?.cpf,
          emitenteNome: nota.emitente?.razaoSocial,
          tomadorDoc: nota.tomador?.cnpj || nota.tomador?.cpf,
          tomadorNome: nota.tomador?.razaoSocial,
          descricaoServico: nota.servico?.descricao,
          valorServico: nota.servico?.valorServico,
          valorLiquido: nota.valores.liquido,
          localEmissao: nota.localEmissao,
          emitidaEm: nota.dataProcessamento || doc.geradoEm,
          xml: doc.xml,
        });
        if (inserida) novas++;
      }

      await store.registrarNsu(emp.cnpj, r.ultimoNsu, ambiente);
      if (r.ultimoNsu <= nsu) break; // não avançou: acabou
      nsu = r.ultimoNsu;

      // O ADN limita a frequência e responde 429. Uma pausa curta entre lotes
      // evita perder a sincronização pela metade.
      await new Promise((r2) => setTimeout(r2, 1200));
    }

    res.json({
      sucesso: true,
      lotes,
      documentosLidos: lidos,
      novas,
      ultimoNsu: nsu,
      limiteAtingido,
      aviso: limiteAtingido
        ? 'O ambiente nacional limitou a frequência (429). O que veio foi guardado; '
          + 'chame de novo em alguns instantes para continuar de onde parou.'
        : undefined,
    });
  } catch (err: any) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// GET /api/nfse/distribuicao — lista o que já foi capturado
app.get('/api/nfse/distribuicao', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const store = await getNfseStore();
    const limite = Math.min(Number(req.query.limit) || 100, 500);
    res.json({
      ultimoNsu: await store.ultimoNsu(emp.cnpj, '1'),
      notas: await store.listarRecebidas(emp.cnpj, limite),
    });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/distribuicao/:chave/xml — XML da nota capturada
app.get('/api/nfse/distribuicao/:chave/xml', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const chave = String(req.params.chave).replace(/\D/g, '');
    const store = await getNfseStore();
    const nota = await store.obterRecebida(chave);
    if (!nota || nota.empresaCnpj !== emp.cnpj || !nota.xml) {
      res.status(404).json({ erro: 'Nota nao encontrada para esta empresa.' });
      return;
    }
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="nfse-${chave}.xml"`);
    res.send(nota.xml);
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// POST /api/nfse/enviar-email — manda DANFSE + XML para o tomador
app.post('/api/nfse/enviar-email', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    const chave = String(b.chaveAcesso || b.chave || '').replace(/\D/g, '');
    const destino = String(b.destinatarioEmail || b.email || '').trim();
    if (!chave || !destino) {
      res.status(400).json({ erro: 'Campos obrigatorios: chaveAcesso, destinatarioEmail' });
      return;
    }

    const smtp = await getSmtpConfig();
    if (!smtp) {
      res.status(503).json({ erro: 'Email nao configurado. Va em Configuracoes > Email para configurar o SMTP.' });
      return;
    }

    const store = await getNfseStore();
    const nota = await store.obterNota(chave);
    // Mesma guarda de tenant do download: a chave é pública, o acervo não.
    if (!nota || nota.empresaCnpj !== emp.cnpj) {
      res.status(404).json({ erro: 'Nota nao encontrada para esta empresa.' });
      return;
    }

    const anexos: { filename: string; content: string | Buffer; contentType?: string }[] = [];
    if (nota.xml) {
      anexos.push({ filename: `NFSe_${chave}.xml`, content: nota.xml, contentType: 'application/xml' });
      try {
        const { pdf } = await gerarDanfsePdf(emp, nota, chave);
        anexos.push({ filename: `DANFSE_${chave}.pdf`, content: pdf, contentType: 'application/pdf' });
      } catch { /* sem o PDF, manda só o XML */ }
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port),
      secure: Number(smtp.port) === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    const nomeEmpresa = emp.fantasia || emp.razaoSocial;
    const valor = Number(nota.valorServico || 0)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const teste = nota.ambiente === '2'
      ? '<p><strong>Nota emitida em ambiente de teste — sem valor fiscal.</strong></p>' : '';

    await transporter.sendMail({
      from: `"${nomeEmpresa}" <${smtp.from}>`,
      to: destino,
      subject: `NFS-e ${nota.numero || nota.numeroDps} - ${nomeEmpresa}`,
      html: `${teste}<p>Segue anexa a NFS-e <strong>${nota.numero || nota.numeroDps}</strong> `
        + `emitida por <strong>${nomeEmpresa}</strong>.</p>`
        + `<p>Serviço: ${nota.descricaoServico || '-'}</p>`
        + `<p>Valor: ${valor}</p>`
        + `<p>Chave de acesso: <code>${chave}</code></p>`,
      attachments: anexos,
    });

    res.json({ sucesso: true, mensagem: `Email enviado para ${destino}` });
  } catch (err: any) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// POST /api/nfse/analise-fiscal — pede análise fiscal para cancelar
//
// Recurso para quando o prazo de cancelamento do município venceu e a
// substituição não serve — serviço não prestado, por exemplo, onde não há nota
// correta para colocar no lugar.
app.post('/api/nfse/analise-fiscal', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const b = req.body || {};
    const chave = String(b.chaveAcesso || b.chave || '').replace(/\D/g, '');
    if (!chave) {
      res.status(400).json({ erro: 'Informe chaveAcesso (50 digitos).' });
      return;
    }

    const store = await getNfseStore();
    const registrada = await store.obterNota(chave);
    const ambiente = resolverAmbiente(req, res, registrada?.ambiente || emp.ambiente, b.ambiente);
    if (!ambiente) return;

    const r = await nfseUseCaseDe(emp, ambiente).solicitarAnaliseFiscal({
      chaveAcesso: chave,
      cnpjAutor: emp.cnpj,
      motivo: String(b.motivo || '1') as any,
      justificativa: String(b.justificativa || ''),
    });

    res.status(r.sucesso ? 200 : 400).json({
      sucesso: r.sucesso,
      chaveAcesso: chave,
      erros: r.erros,
      proximoPasso: r.sucesso
        ? 'O fisco responde com deferimento (e105104) ou indeferimento (e105105). '
          + `Acompanhe em GET /api/nfse/${chave}/eventos/e105104`
        : undefined,
    });
  } catch (err: any) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// DELETE /api/nfse/homologacao — limpa as notas de teste
app.delete('/api/nfse/homologacao', async (req, res) => {
  if (bloqueiaEscrita(req, res)) return;
  try {
    const emp = await resolveEmpresa(req);
    const store = await getNfseStore();
    res.json({ sucesso: true, removidas: await store.apagarHomologacao(emp.cnpj) });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/:chave/eventos/:tipo — eventos registrados na SEFIN
//
// O status guardado aqui só reflete o que passou por este sistema. Município
// cancelando de ofício ou tomador rejeitando a nota não aparecem sem consultar.
app.get('/api/nfse/:chave/eventos/:tipo', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const chave = String(req.params.chave).replace(/\D/g, '');
    const store = await getNfseStore();
    const registrada = await store.obterNota(chave);
    const ambiente = resolverAmbiente(req, res, registrada?.ambiente || emp.ambiente, req.query.ambiente);
    if (!ambiente) return;

    const seq = Number(req.query.seq) || 1;
    const r = await nfseUseCaseDe(emp, ambiente).consultarEvento(chave, String(req.params.tipo), seq);

    if (!r.sucesso) {
      res.status(404).json({
        sucesso: false,
        erro: 'Evento nao encontrado para esta nota.',
        chaveAcesso: chave,
        tipoEvento: req.params.tipo,
      });
      return;
    }
    res.json({ sucesso: true, chaveAcesso: chave, tipoEvento: req.params.tipo, eventoXml: r.eventoXml });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/:chave/xml — XML da nota autorizada
app.get('/api/nfse/:chave/xml', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const chave = String(req.params.chave).replace(/\D/g, '');
    const store = await getNfseStore();
    const nota = await store.obterNota(chave);

    // Guarda de tenant: sem isso, uma chave conhecida leria a nota de outra
    // empresa. A NFS-e é pública na consulta do município, mas o XML aqui é do
    // acervo do cliente.
    if (!nota || nota.empresaCnpj !== emp.cnpj) {
      res.status(404).json({ erro: 'Nota nao encontrada para esta empresa.' });
      return;
    }
    if (!nota.xml) {
      res.status(404).json({ erro: 'XML nao guardado para esta nota.' });
      return;
    }
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="nfse-${chave}.xml"`);
    res.send(nota.xml);
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/:chave/danfse — PDF
app.get('/api/nfse/:chave/danfse', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const chave = String(req.params.chave).replace(/\D/g, '');
    const store = await getNfseStore();
    const nota = await store.obterNota(chave);
    if (!nota || nota.empresaCnpj !== emp.cnpj || !nota.xml) {
      res.status(404).json({ erro: 'Nota nao encontrada para esta empresa.' });
      return;
    }

    const { pdf, origem } = await gerarDanfsePdf(emp, nota, chave);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="danfse-${chave}.pdf"`);
    // Deixa visível qual dos dois geradores respondeu, sem precisar abrir o PDF.
    res.setHeader('X-Danfse-Origem', origem);
    res.send(pdf);
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/nfse/:chave — consulta na SEFIN (registrada por último: as rotas
// literais acima precisam vencer o parâmetro)
app.get('/api/nfse/:chave', async (req, res) => {
  try {
    const emp = await resolveEmpresa(req);
    const chave = String(req.params.chave).replace(/\D/g, '');
    const store = await getNfseStore();
    const registrada = await store.obterNota(chave);
    const ambiente = resolverAmbiente(req, res, registrada?.ambiente || emp.ambiente, req.query.ambiente);
    if (!ambiente) return;

    const r = await nfseUseCaseDe(emp, ambiente).consultar(chave);
    if (!r.sucesso) {
      res.status(404).json({ sucesso: false, erro: 'NFS-e nao encontrada na SEFIN.', chaveAcesso: chave });
      return;
    }
    res.json({ sucesso: true, nota: r.nota, statusLocal: registrada?.status });
  } catch (err: any) {
    res.status(400).json({ erro: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/docs — documentação completa da API para integração ERP
// ---------------------------------------------------------------------------
/**
 * GET /api/openapi.json — a API descrita no formato padrao.
 *
 * `/api/docs` e para pessoa ler; este e para maquina. Com ele o desenvolvedor
 * do cliente importa no Postman/Insomnia e gera o cliente HTTP tipado na
 * linguagem dele, em vez de transcrever endpoint por endpoint na mao — que era
 * a unica opcao ate agora.
 *
 * Descreve o caminho que um ERP realmente usa. Rotas administrativas ficam de
 * fora de proposito: elas exigem senha mestra e nao sao do cliente.
 */
function specOpenApi(base: string): Record<string, any> {
  const seg = [{ ApiKey: [] as string[] }];

  const erro = (descricao: string) => ({
    description: descricao,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'API Fiscal — NF-e, NFC-e e NFS-e',
      version: '3.0',
      description:
        'Emissao de documentos fiscais eletronicos.\n\n'
        + 'Comece por GET /api/me: ele diz o CNPJ, o ambiente permitido, os servicos '
        + 'contratados e os limites do seu plano.\n\n'
        + 'ATENCAO: rejeicao da SEFAZ vem em HTTP 200 com "sucesso": false — checar '
        + 'so o status HTTP faz rejeicao virar sucesso. E HTTP 502 com "indefinido": true '
        + 'significa que NAO se sabe se a nota saiu: consulte pela chave antes de reemitir.',
    },
    servers: [{ url: base }],
    security: seg,
    components: {
      securitySchemes: {
        ApiKey: {
          type: 'apiKey', in: 'header', name: 'x-api-key',
          description: 'Chave do cliente (nfe_live_* ou nfe_test_*). Ela ja fixa o CNPJ — nao envie x-empresa-cnpj.',
        },
      },
      schemas: {
        Erro: {
          type: 'object',
          properties: {
            erro: { type: 'string', description: 'Mensagem para a pessoa ler' },
            detalhes: { type: 'array', items: { type: 'string' }, description: 'Nomeia o campo errado' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' },
              },
            },
          },
        },
        Endereco: {
          type: 'object',
          required: ['logradouro', 'numero', 'bairro', 'codigoMunicipio', 'nomeMunicipio', 'uf', 'cep'],
          properties: {
            logradouro: { type: 'string' }, numero: { type: 'string' }, complemento: { type: 'string' },
            bairro: { type: 'string' },
            codigoMunicipio: { type: 'string', description: 'IBGE, 7 digitos. E ele que a SEFAZ confere, nao o nome' },
            nomeMunicipio: { type: 'string' }, uf: { type: 'string', minLength: 2, maxLength: 2 },
            cep: { type: 'string' },
          },
        },
        ItemNota: {
          type: 'object',
          required: ['descricao', 'ncm', 'cfop', 'quantidade', 'valorUnitario'],
          properties: {
            codigo: { type: 'string', description: 'Codigo no catalogo. Informe-o e a API completa a classificacao fiscal sozinha' },
            descricao: { type: 'string' }, ncm: { type: 'string' },
            cfop: { type: 'string', description: 'O 1o digito e corrigido pelo sentido da nota' },
            unidade: { type: 'string' }, quantidade: { type: 'string' }, valorUnitario: { type: 'string' },
            desconto: { type: 'string' },
            origem: { type: 'string', description: 'Obrigatorio. 0 = nacional; importada muda a aliquota interestadual para 4%' },
            cstIcms: { type: 'string', description: 'CST no regime normal, CSOSN no Simples — o CRT decide qual' },
            aliqIcms: { type: 'string' },
            ibscbs: {
              type: 'object',
              description: 'Reforma Tributaria. Vazio = tributacao integral (CST 000). Aliquota zero e CST 200 com reducao de 100%',
              properties: {
                cst: { type: 'string', example: '200' },
                cClassTrib: { type: 'string', example: '200014', description: 'Comeca pelos 3 digitos do CST' },
                pRedAliq: { type: 'string', example: '100', description: 'So com CST 200 fora da tabela embutida' },
              },
            },
          },
        },
        NotaFiscal: {
          type: 'object',
          required: ['destinatario', 'itens', 'pagamento'],
          properties: {
            serie: { type: 'string' },
            numero: { type: 'string', description: 'Omita e a API usa o proximo da serie/ambiente' },
            ambiente: { type: 'string', enum: ['1', '2'], description: '1 producao, 2 homologacao' },
            simular: { type: 'boolean', description: 'true monta e valida SEM transmitir e sem consumir cota' },
            tipoOperacao: { type: 'string', enum: ['0', '1'] },
            finalidade: { type: 'string', enum: ['1', '2', '3', '4'], description: '4 = devolucao; exige notasReferenciadas' },
            notasReferenciadas: { type: 'array', items: { type: 'string' } },
            naturezaOperacao: { type: 'string' },
            destinatario: {
              type: 'object',
              properties: {
                cnpj: { type: 'string' }, cpf: { type: 'string', description: 'Use cnpj OU cpf, nunca os dois' },
                razaoSocial: { type: 'string' }, indIEDest: { type: 'string', enum: ['1', '2', '9'] },
                ie: { type: 'string' }, email: { type: 'string' },
                endereco: { $ref: '#/components/schemas/Endereco' },
              },
            },
            itens: { type: 'array', items: { $ref: '#/components/schemas/ItemNota' } },
            pagamento: { type: 'object' },
          },
        },
        RespostaEmissao: {
          type: 'object',
          properties: {
            sucesso: { type: 'boolean', description: 'false com HTTP 200 = rejeicao da SEFAZ' },
            chaveAcesso: { type: 'string' }, protocolo: { type: 'string' },
            cStat: { type: 'string' }, xMotivo: { type: 'string' },
            xml: { type: 'string' }, danfePdf: { type: 'string', format: 'byte' },
            avisos: { type: 'array', items: { type: 'string' }, description: 'Suposicoes que o servidor precisou fazer' },
            cfopAjustado: { type: 'array', items: { type: 'object' } },
            indefinido: { type: 'boolean', description: 'So no 502: nao se sabe se a nota saiu' },
          },
        },
      },
    },
    paths: {
      '/api/me': {
        get: {
          summary: 'Quem sou eu com esta chave',
          description: 'Primeiro comando de qualquer integracao. Nao gasta cota e nao fala com a SEFAZ.',
          responses: { '200': { description: 'Empresa, credencial, plano, servicos e uso do mes' }, '401': erro('Chave invalida ou revogada') },
        },
      },
      '/api/status': {
        get: {
          summary: 'A SEFAZ esta no ar?',
          parameters: [{ name: 'ambiente', in: 'query', schema: { type: 'string', enum: ['1', '2'] } }],
          responses: { '200': { description: 'cStat 107 = em operacao' } },
        },
      },
      '/api/proximo-numero': {
        get: {
          summary: 'Proximo numero livre da serie',
          description: 'A contagem e POR SERIE E POR AMBIENTE. Pedir sem o ambiente devolve o numero do outro.',
          parameters: [
            { name: 'serie', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'ambiente', in: 'query', required: true, schema: { type: 'string', enum: ['1', '2'] } },
          ],
          responses: { '200': { description: 'numero, serie e ambiente' } },
        },
      },
      '/api/emitir': {
        post: {
          summary: 'Emitir NF-e (modelo 55)',
          description: 'Com "simular": true monta e valida sem transmitir.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NotaFiscal' } } } },
          responses: {
            '200': { description: 'Autorizada, OU rejeitada com sucesso:false', content: { 'application/json': { schema: { $ref: '#/components/schemas/RespostaEmissao' } } } },
            '400': erro('Dado invalido — `detalhes` nomeia o campo'),
            '402': erro('Cota do plano esgotada'),
            '403': erro('Servico nao contratado ou ambiente proibido'),
            '429': erro('Limite de requisicoes — espere o Retry-After'),
            '502': erro('Envio nao confirmado. Consulte pela chave; NAO reemita'),
            '503': erro('SEFAZ fora do ar. A nota NAO saiu e o numero continua livre; tente de novo'),
          },
        },
      },
      '/api/emitir-nfce': {
        post: {
          summary: 'Emitir NFC-e (modelo 65)',
          description: 'Cupom fiscal. Exige CSC cadastrado na empresa. O destinatario e OPCIONAL '
            + '(consumidor nao identificado e o caso normal), mas `cnpj` e `cpf` juntos sao recusados '
            + 'com 400 — escolher um em silencio faria o cupom sair autorizado no nome errado. '
            + 'Serie vai de 0 a 889 e o CFOP e corrigido para 5xxx automaticamente (`cfopAjustado` '
            + 'na resposta), porque no modelo 65 so existe operacao interna. '
            + 'Aceita `simular: true`, com a mesma resposta da NF-e mais `modelo: "65"`.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NotaFiscal' } } } },
          responses: {
            '200': { description: 'Autorizada, com QR Code' },
            '400': erro('Dado invalido'),
            '502': erro('Envio nao confirmado. Consulte pela chave; NAO reemita'),
            '503': erro('SEFAZ fora do ar. O cupom NAO saiu e o numero continua livre; tente de novo'),
          },
        },
      },
      '/api/nfse/emitir': {
        post: {
          summary: 'Emitir NFS-e',
          description: 'Nota de servico pelo Emissor Nacional. Documento e fisco DIFERENTES da NF-e: '
            + 'quem autoriza e a SEFIN Nacional, o transporte e REST, e a nota volta autorizada na '
            + 'propria resposta — nao ha lote nem protocolo a consultar depois. '
            + 'O servico vem do catalogo da empresa (`servicoCodigo`) ou inline (objeto `servico`).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['valorServico'],
              properties: {
                ambiente: { type: 'string', enum: ['1', '2'], description: '1 = producao, 2 = producao restrita. Padrao: o da empresa.' },
                serie: { type: 'string', example: '1', description: '1 a 5 digitos, nunca zero.' },
                numero: { type: 'string', description: 'Numero da DPS. Omita para usar o proximo livre.' },
                competencia: { type: 'string', example: '2026-08-01', description: 'AAAA-MM-DD, o mes de referencia. Padrao: primeiro dia do mes atual.' },
                servicoCodigo: { type: 'string', description: 'Codigo do servico no catalogo da empresa. Dispensa o objeto `servico`.' },
                servico: {
                  type: 'object',
                  properties: {
                    codigoTributacaoNacional: { type: 'string', example: '010101',
                      description: 'Item(2) + subitem(2) + desdobro(2) da LC 116. O desdobro comeca em 01 — nao existe "00".' },
                    descricao: { type: 'string', description: 'Discriminacao do servico prestado.' },
                    codigoMunicipioPrestacao: { type: 'string', description: 'Codigo IBGE. Padrao: municipio do prestador.' },
                    obra: {
                      type: 'object',
                      description: 'Obrigatorio nos subitens de obra (07.02, 07.04 a 07.08, 07.17 e 07.19) e PROIBIDO nos demais. '
                        + 'Informe codigoObra (CNO/CEI), codigoCIB ou endereco.',
                    },
                  },
                },
                valorServico: { type: 'string', example: '1500.00', description: 'Aceita "1.500,00" ou "1500.00".' },
                aliquotaIss: { type: 'string', description: 'Percentual do ISS. O valor que vale e o apurado pelo municipio.' },
                issRetido: { type: 'string', enum: ['0', '1'], description: '1 quando o tomador retem o ISS.' },
                deducaoReducao: { type: 'object', description: 'Reduz a base do ISS. Informe { percentual } OU { valor } — nunca os dois, o XSD aceita so um.' },
                tomador: { type: 'object', description: 'CNPJ ou CPF, razao social e endereco do tomador.' },
                simular: { type: 'boolean', description: 'Monta e valida sem transmitir. Nao consome numeracao nem cota.' },
              },
            } } },
          },
          responses: {
            '200': { description: 'Autorizada — a nota ja volta aqui, com XML e DANFSe.' },
            '400': erro('Dado invalido, ou municipio fora do convenio do Emissor Nacional (E0037)'),
          },
        },
      },
      '/api/consultar': {
        get: {
          summary: 'Situacao da nota na SEFAZ',
          description: 'E o que se usa depois de um 502 indefinido, ANTES de reemitir.',
          parameters: [{ name: 'chave', in: 'query', required: true, schema: { type: 'string', minLength: 44, maxLength: 44 } }],
          responses: { '200': { description: 'cStat, xMotivo e protocolo' } },
        },
      },
      '/api/cancelar': {
        post: {
          summary: 'Cancelar nota autorizada',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['chaveAcesso', 'justificativa'], properties: {
              chaveAcesso: { type: 'string' }, protocolo: { type: 'string' },
              justificativa: { type: 'string', minLength: 15 }, ambiente: { type: 'string', enum: ['1', '2'] },
            } } } },
          },
          responses: { '200': { description: 'Evento registrado (cStat 135)' }, '400': erro('Justificativa curta ou nota nao encontrada') },
        },
      },
      '/api/carta-correcao': {
        post: {
          summary: 'Carta de correcao (CC-e)',
          description: 'Nao serve para valor, imposto, quantidade, data nem troca de destinatario. O texto vai COMPLETO: a ultima carta substitui as anteriores.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['chaveAcesso', 'correcao'], properties: {
              chaveAcesso: { type: 'string' }, correcao: { type: 'string', minLength: 15 },
              nSeqEvento: { type: 'integer', default: 1, description: 'Sobe a cada carta da mesma nota' },
              ambiente: { type: 'string', enum: ['1', '2'] },
            } } } },
          },
          responses: { '200': { description: 'Evento registrado' }, '400': erro('Texto curto ou sequencia repetida') },
        },
      },
      '/api/inutilizar': {
        post: {
          summary: 'Inutilizar faixa de numeracao',
          description: 'Mata uma faixa de numeracao que nao vai ser usada. '
            + 'Homologada (cStat 102), a faixa some para sempre e o contador pula para depois dela. '
            + 'Numero ja AUTORIZADO nao se inutiliza — o caminho ali e cancelamento.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['serie', 'nNFIni', 'nNFFin', 'justificativa'],
              properties: {
                serie: { type: 'string', example: '1', description: 'Serie da faixa. De 0 a 889 — 890+ e reservada pela SEFAZ.' },
                nNFIni: { type: 'string', example: '10', description: 'Primeiro numero da faixa, inteiro >= 1.' },
                nNFFin: { type: 'string', example: '15', description: 'Ultimo numero da faixa. Para inutilizar um numero so, igual ao inicial.' },
                justificativa: { type: 'string', example: 'Falha na numeracao sequencial do sistema emissor',
                  description: 'Minimo de 15 caracteres, exigencia da SEFAZ.' },
                ambiente: { type: 'string', enum: ['1', '2'], description: 'Padrao: o ambiente da empresa.' },
              },
            } } },
          },
          responses: {
            '200': { description: 'Homologada (cStat 102). Resposta traz `proximoNumeroLivre`.' },
            '400': erro('Faixa invalida, serie fora de 0-889, ou faixa contendo nota autorizada'),
          },
        },
      },
      '/api/nota/{chave}/xml': {
        get: {
          summary: 'XML da nota — o documento fiscal',
          parameters: [{ name: 'chave', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'XML', content: { 'application/xml': {} } }, '404': erro('Nao encontrada para esta empresa') },
        },
      },
      '/api/nota/{chave}/danfe': {
        get: {
          summary: 'DANFE em PDF',
          description: 'Nota cancelada sai com CANCELADA carimbado na diagonal.',
          parameters: [{ name: 'chave', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'PDF', content: { 'application/pdf': {} } } },
        },
      },
      '/api/historico': {
        get: {
          summary: 'Notas emitidas',
          parameters: [{ name: 'ambiente', in: 'query', schema: { type: 'string', enum: ['1', '2'] } }],
          responses: { '200': { description: 'Lista' } },
        },
      },
      '/api/produtos': {
        get: { summary: 'Catalogo de produtos', responses: { '200': { description: 'Lista' } } },
        post: { summary: 'Cadastrar/atualizar produto', responses: { '200': { description: 'Salvo' } } },
      },
      '/api/classificar': {
        get: {
          summary: 'Classificacao fiscal por NCM',
          description: 'Devolve CFOP, CST/CSOSN, aliquota, reducao de base, MVA e cBenef prontos.',
          parameters: [{ name: 'ncm', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Classificacao' } },
        },
      },
      '/api/docs': {
        get: { summary: 'Documentacao completa, para pessoa ler', responses: { '200': { description: 'JSON' } } },
      },
    },
  };
}

app.get('/api/openapi.json', (req, res) => {
  res.json(specOpenApi(baseUrl(req)));
});

/**
 * GET /api/postman.json — a mesma API, no formato que o Postman importa.
 *
 * Gerada a partir da OpenAPI, e nao escrita a mao: uma colecao mantida em
 * paralelo vira uma segunda descricao da API para manter em dia, e nasce
 * desatualizada no primeiro endpoint novo.
 *
 * A chave vai como VARIAVEL de colecao, nunca embutida em cada requisicao —
 * assim o integrador troca de chave (ou de ambiente) num lugar so, e nao sai
 * colando credencial em vinte lugares.
 */
app.get('/api/postman.json', (req, res) => {
  const base = baseUrl(req);
  const spec = specOpenApi(base);

  const exemploDoSchema = (schema: any, spec: any, profundidade = 0): any => {
    if (!schema || profundidade > 6) return null;
    if (schema.$ref) {
      const nome = String(schema.$ref).split('/').pop()!;
      return exemploDoSchema(spec.components?.schemas?.[nome], spec, profundidade + 1);
    }
    if (schema.example !== undefined) return schema.example;
    if (schema.enum) return schema.enum[0];
    if (schema.type === 'array') return [exemploDoSchema(schema.items, spec, profundidade + 1)];
    if (schema.type === 'object' || schema.properties) {
      const o: Record<string, any> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        o[k] = exemploDoSchema(v, spec, profundidade + 1);
      }
      return o;
    }
    if (schema.type === 'number' || schema.type === 'integer') return 0;
    if (schema.type === 'boolean') return false;
    return schema.description ? `<${schema.description}>` : '';
  };

  const itens: any[] = [];
  for (const [caminho, metodos] of Object.entries(spec.paths ?? {})) {
    for (const [metodo, op] of Object.entries(metodos as Record<string, any>)) {
      const partes = caminho.replace(/^\//, '').split('/');
      const corpo = op.requestBody?.content?.['application/json']?.schema;

      itens.push({
        name: op.summary || `${metodo.toUpperCase()} ${caminho}`,
        request: {
          method: metodo.toUpperCase(),
          header: [
            { key: 'x-api-key', value: '{{apiKey}}', type: 'text' },
            ...(corpo ? [{ key: 'Content-Type', value: 'application/json', type: 'text' }] : []),
          ],
          ...(corpo ? {
            body: {
              mode: 'raw',
              raw: JSON.stringify(exemploDoSchema(corpo, spec), null, 2),
              options: { raw: { language: 'json' } },
            },
          } : {}),
          url: {
            raw: `{{baseUrl}}${caminho}`,
            host: ['{{baseUrl}}'],
            path: partes,
            // Parametro de caminho vira variavel do Postman, para o integrador
            // preencher no lugar em vez de editar a URL.
            variable: (op.parameters ?? [])
              .filter((p: any) => p.in === 'path')
              .map((p: any) => ({ key: p.name, value: '', description: p.description })),
            query: (op.parameters ?? [])
              .filter((p: any) => p.in === 'query')
              .map((p: any) => ({ key: p.name, value: '', description: p.description, disabled: !p.required })),
          },
          description: op.description || op.summary,
        },
      });
    }
  }

  res.setHeader('Content-Disposition', 'attachment; filename="api-fiscal.postman_collection.json"');
  res.json({
    info: {
      name: spec.info.title,
      description: spec.info.description
        + '\n\nColecao gerada a partir de GET /api/openapi.json — sempre em dia com a API.'
        + '\n\nPreencha a variavel `apiKey` com a sua chave antes de disparar qualquer requisicao.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: base, type: 'string' },
      { key: 'apiKey', value: '', type: 'string' },
    ],
    item: itens,
  });
});

app.get('/api/docs', (req, res) => {
  const BASE = baseUrl(req);
  res.json({
    titulo: 'Ponte SEFAZ — API REST para integração com ERP',
    versao: '3.0',
    baseUrl: BASE,
    autenticacao: {
      descricao: 'Todas as chamadas (exceto /api/ping e /api/importar-modelo) exigem autenticacao via header x-api-key.',
      modos: [
        {
          modo: 'API Key (RECOMENDADO para integracao ERP)',
          formato: 'nfe_live_xxxxx (producao) ou nfe_test_xxxxx (homologacao)',
          header: 'x-api-key: nfe_live_SUA_CHAVE',
          escopo: 'A chave e vinculada a UMA empresa no banco. O header x-empresa-cnpj e IGNORADO — nao ha como acessar outro CNPJ com ela.',
          onde_obter: 'Painel > aba Empresas > botao "API Keys" > "Gerar nova chave"',
          permissoes: '"full" = emitir/cancelar/consultar | "readonly" = apenas consultas (GET)',
          revogacao: 'Revogavel a qualquer momento pelo painel, sem afetar as demais chaves.',
        },
        {
          modo: 'Senha mestra (admin)',
          header: 'x-api-key: SENHA_MESTRA + x-empresa-cnpj: CNPJ',
          escopo: 'Acesso total a TODAS as empresas. Use apenas no painel administrativo do contador.',
          alerta: 'NUNCA compartilhe a senha mestra com clientes ou integracoes externas — ela da acesso a todos os tenants.',
        },
        {
          modo: 'Senha da empresa',
          header: 'x-api-key: SENHA_EMPRESA + x-empresa-cnpj: CNPJ',
          escopo: 'Opera somente a empresa informada. Voltado ao operador humano no painel.',
        },
      ],
      // O painel procura `headers_obrigatorios`; enquanto o nome aqui era
      // `headers`, a secao de autenticacao da documentacao NUNCA renderizava —
      // some justamente a parte que explica como autenticar.
      headers_obrigatorios: [
        { nome: 'x-api-key', tipo: 'string', obrigatorio: true, descricao: 'API Key (nfe_live_*/nfe_test_*), senha mestra ou senha da empresa' },
        { nome: 'x-empresa-cnpj', tipo: 'string (14 digitos)', obrigatorio: 'Só com senha mestra/senha da empresa', descricao: 'CNPJ da empresa emitente. IGNORADO quando se usa API Key (o CNPJ vem da chave).' },
        { nome: 'Content-Type', tipo: 'string', obrigatorio: 'Em POST', descricao: 'application/json' },
      ],
      curl_exemplo: `curl -s -H "x-api-key: nfe_live_SUA_CHAVE" ${BASE}/api/status`,
      alertas: [
        'Com API Key voce NAO precisa enviar x-empresa-cnpj — a empresa ja vem travada na chave',
        'Uma API Key vazada expoe apenas a empresa dela; revogue no painel e gere outra',
        'A senha mestra da acesso a todas as empresas — mantenha restrita ao contador',
        'Chaves readonly retornam 403 em qualquer operacao de escrita (emitir, cancelar, inutilizar)',
      ],
    },
    reforma_tributaria: {
      titulo: 'IBS/CBS — Reforma Tributaria (NT 2025.002)',
      resumo: 'A API ja gera o grupo IBS/CBS automaticamente em todo item. Nenhuma mudanca e necessaria na sua integracao para emitir.',
      contexto: 'O grupo IBS/CBS por item ja foi anunciado como obrigatorio a partir de 03/08/2026, mas o Ato Tecnico Conjunto RFB/CGIBS 1/2026 (31/07/2026) adiou as validacoes nos DF-e, e a NT 2025.002 v1.51 moveu a regra UB12-10 (rejeicao 1115) para "implementacao futura", sem data nova. Hoje a AUSENCIA do grupo nao rejeita.',
      atencao_risco_invertido: 'A nota de esclarecimento RFB/CGIBS de 06/08/2026 deixou claro que caiu a REJEICAO, nao o dever de destacar. E o efeito pratico se inverteu: grupo INFORMADO atrai todas as regras de validacao dele. Hoje o risco esta em preencher errado, nao em deixar de preencher.',
      calendario: [
        { data: '01/07/2026', quem: 'Regime Normal (CRT 3)', onde: 'Homologacao', situacao: 'Em vigor' },
        { data: '03/08/2026', quem: 'Regime Normal (CRT 3)', onde: 'PRODUCAO', situacao: 'Validacoes suspensas pelo Ato Tecnico Conjunto RFB/CGIBS 1/2026' },
        { data: '01/01/2027', quem: 'Simples Nacional (CRT 1/2)', onde: 'Producao', situacao: 'Futuro — Ato Conjunto RFB/CGIBS 4/2026, art. 1o, par. 1o' },
      ],
      aliquotas_2026: {
        pIBSUF: '0,1% — IBS estadual',
        pIBSMun: '0% — IBS municipal (fase de teste)',
        pCBS: '0,9% — CBS federal',
        observacao: 'Ano de transicao: as aliquotas sao simbolicas e a LC 214/2025 dispensa o recolhimento de quem emitir os documentos corretamente.',
        validacao: 'A SEFAZ confere estes percentuais na autorizacao. Sao os valores que a API ja aplica por padrao — nao ha o que configurar.',
      },
      padrao_aplicado: {
        CST: '000',
        cClassTrib: '000001',
        significado: 'Tributacao integral — a venda comum de mercadoria.',
        alerta: 'Produtos com tratamento proprio (aliquota reduzida, isencao, imunidade, monofasia) exigem outro par CST/cClassTrib. Tributacao integral nao e um valor neutro: e uma afirmacao sobre o produto. Confirme com a contabilidade e sobrescreva no item ou no cadastro do produto.',
      },
      aliquota_zero_e_reducao: {
        descricao: 'Nao existe CST de aliquota zero na tabela oficial. Aliquota zero se escreve como CST 200 (aliquota reduzida) com o grupo de reducao de 100%. E o caso de fruta fresca, hortalica e ovo (LC 214/2025, art. 148 e Anexo XV).',
        como_funciona: 'Com CST 200 a API monta o grupo gRed (pRedAliq e pAliqEfet) e aplica a reducao sobre as aliquotas oficiais. Reducao de 100% resulta em vIBS e vCBS iguais a 0,00, com a aliquota cheia continuando declarada ao lado.',
        de_onde_vem_o_percentual: 'Da tabela oficial de cClassTrib da RTC. A API traz embutido o 200014 (horticolas, frutas e ovos — 100%). Para qualquer outro cClassTrib de CST 200, informe itens[].ibscbs.pRedAliq: a API recusa a emissao em vez de adivinhar o percentual, porque chutar reducao e errar tributo.',
        par_conferido: 'Os tres primeiros digitos do cClassTrib sao o proprio CST. A API recusa o par incompativel antes de transmitir — a SEFAZ rejeitaria com 1024.',
      },
      sobrescrever_por_item: {
        descricao: 'Envie o objeto "ibscbs" dentro do item para usar outra classificacao tributaria.',
        alerta_aliquota: 'As aliquotas sao fixadas pela SEFAZ e VALIDADAS na autorizacao: enviar valor diferente do oficial retorna cStat 1026 "Aliquota do IBS da UF invalida". Comprovado em teste. Para zerar o tributo NAO mexa nas aliquotas — use CST 200 com a reducao, que e a forma prevista no leiaute.',
        campos: [
          { nome: 'itens[].ibscbs.cst', tipo: 'string', obrigatorio: false, descricao: 'CST do IBS/CBS. Padrao: "000" (tributacao integral). Ao informar, informe tambem o cClassTrib' },
          { nome: 'itens[].ibscbs.cClassTrib', tipo: 'string', obrigatorio: 'Sim, quando informar cst', descricao: 'Classificacao tributaria, comecando pelos tres digitos do CST. Padrao: "000001"' },
          { nome: 'itens[].ibscbs.pRedAliq', tipo: 'string', obrigatorio: 'So com CST 200 e cClassTrib fora da tabela embutida', descricao: 'Percentual de reducao de aliquota. "100" = aliquota zero' },
          { nome: 'itens[].ibscbs.vBC', tipo: 'string', obrigatorio: false, descricao: 'Base de calculo. Padrao: valor do produto' },
          { nome: 'itens[].ibscbs.pIBSUF', tipo: 'string', obrigatorio: false, descricao: 'Aliquota IBS estadual. Padrao: "0.1000". A SEFAZ rejeita valores fora do oficial' },
          { nome: 'itens[].ibscbs.pIBSMun', tipo: 'string', obrigatorio: false, descricao: 'Aliquota IBS municipal. Padrao: "0.0000"' },
          { nome: 'itens[].ibscbs.pCBS', tipo: 'string', obrigatorio: false, descricao: 'Aliquota CBS. Padrao: "0.9000". A SEFAZ rejeita valores fora do oficial' },
        ],
        exemplo: {
          codigo: 'BAN01', descricao: 'BANANA PRATA CX 20KG', ncm: '08039000', cfop: '5102',
          unidade: 'CX', quantidade: '1', valorUnitario: '100.00',
          origem: '0', cstIcms: '102',
          // 200014 e o codigo de horticolas, frutas e ovos: reducao de 100%, que
          // sai como vIBS e vCBS zerados. Este exemplo ja trouxe "200001", que e
          // outra hipotese legal — codigo errado em exemplo vira codigo errado
          // em producao.
          ibscbs: { cst: '200', cClassTrib: '200014' },
        },
      },
      cobertura: 'Aplicado a NF-e (modelo 55) e NFC-e (modelo 65), em todas as 27 UFs.',
    },
    webhooks: {
      titulo: 'Webhooks — saber o resultado sem ficar consultando',
      descricao: 'A API faz POST na URL cadastrada quando o documento muda de estado. Cadastro pelo painel, em Clientes API.',
      payload: '{ "event": "nfe.authorized", "timestamp": "ISO-8601", "ambiente": "1", "data": { ... } }',
      assinatura: {
        header: 'X-Webhook-Signature',
        algoritmo: 'HMAC-SHA256 sobre o CORPO CRU da requisicao',
        segredo: 'Aparece UMA vez, na criacao do webhook. Guarde: nao e recuperavel.',
        alerta: 'Confira a assinatura antes de confiar no corpo. Sem isso qualquer um que descubra a URL consegue forjar um aviso de nota autorizada.',
      },
      eventos: [
        'nfe.authorized', 'nfe.rejected', 'nfe.cancelled',
        'nfce.authorized', 'nfse.authorized', 'nfse.cancelled',
      ],
      ambiente: 'Cadastre um endpoint POR AMBIENTE. Endpoint sem ambiente recebe os dois — e ai nota de teste dispara o mesmo evento que nota real, com o seu ERP dando baixa em pedido por causa de uma homologacao.',
      entrega: {
        timeout: '10 segundos',
        retry: 'Falha de rede ou 5xx (mais 408 e 429) e reenviada, com espera crescente: 5, 10, 20, 40 minutos, ate 5 tentativas.',
        quando_o_reenvio_acontece: 'O reenvio sai numa varredura AGENDADA, nao no instante em que a espera vence. As esperas acima sao pisos, nao horarios: uma entrega cuja espera venceu logo depois de uma varredura so sai na proxima. Nao conte com o webhook como relogio — se o seu processo depende do tempo exato, consulte a nota pela chave.',
        sem_retry: 'Falha 4xx nao e reenviada — o endpoint recusou o formato, e repetir a mesma coisa nao conserta.',
        recomendacao: 'Responda 2xx rapido e processe em fila do seu lado. Processamento demorado dentro do webhook vira timeout, e timeout vira reenvio.',
      },
    },
    limites_de_requisicao: {
      titulo: 'Rate limit — o que fazer com 429',
      descricao: 'O limite por minuto vem do plano contratado. Consulte o seu em GET /api/me.',
      headers: [
        { nome: 'X-RateLimit-Limit', descricao: 'Teto de requisicoes por minuto do seu plano' },
        { nome: 'X-RateLimit-Remaining', descricao: 'Quantas ainda cabem na janela atual' },
        { nome: 'X-RateLimit-Reset', descricao: 'Segundos ate a janela zerar' },
        { nome: 'Retry-After', descricao: 'So no 429: quantos segundos esperar' },
      ],
      ao_receber_429: 'Espere os segundos do Retry-After e tente de novo. NAO reduza o intervalo, nao paralelize mais e nao repita em loop — isso mantem o limite estourado.',
      observacao: 'A contagem e por instancia do servico. Em pico, o teto efetivo pode ser um pouco maior que o do plano — trate o limite como piso garantido, nao como cota exata.',
    },
    envelope_de_erro: {
      titulo: 'Como ler um erro',
      formatos: [
        {
          quando: 'Erro de negocio (plano, servico, limite)',
          corpo: '{ "success": false, "error": { "code": "BILLING_REQUIRED", "message": "...", "requestId": "..." } }',
          uso: 'O `code` e estavel e serve para o seu `switch`; a `message` e para a pessoa ler.',
        },
        {
          quando: 'Erro de dado enviado',
          corpo: '{ "erro": "mensagem", "detalhes": ["campo X ausente"] }',
          uso: '`detalhes` nomeia o campo — e a informacao mais util da resposta. Nao a descarte.',
        },
        {
          quando: 'Rejeicao da SEFAZ',
          corpo: 'HTTP 200 com { "sucesso": false, "cStat": "539", "xMotivo": "..." }',
          uso: 'ATENCAO: vem em HTTP 200. Checar so o status HTTP faz rejeicao virar sucesso na sua tela.',
        },
        {
          quando: 'Envio nao confirmado',
          corpo: 'HTTP 502 com { "indefinido": true, "chaveAcesso": "...", "comoResolver": "..." }',
          uso: 'A nota PODE ter sido autorizada. Consulte pela chave antes de reemitir — reemitir as cegas duplica.',
        },
        {
          quando: 'SEFAZ fora do ar',
          corpo: 'HTTP 503 com { "sefazIndisponivel": true, "indefinido": false, "contingencia": "..." }',
          uso: 'Diferente do 502: aqui a nota NAO saiu e a numeracao continua livre — pode tentar de novo, '
            + 'sem consultar chave nenhuma. Acompanhe o retorno por GET /api/status. '
            + 'Este emissor NAO emite em contingencia (SVC): enquanto a SEFAZ estiver fora, nao ha como autorizar.',
        },
      ],
      requestId: 'Quando presente, mande o `requestId` ao suporte: e por ele que se acha a requisicao no log.',
    },
    gerenciamento_de_chaves: {
      descricao: 'Endpoints administrativos para emitir e revogar credenciais de integracao (exigem senha mestra).',
      endpoints: [
        {
          metodo: 'POST', path: '/api/empresas/:cnpj/keys',
          descricao: 'Gera uma API Key para a empresa. O valor em claro so aparece nesta resposta.',
          campos: [
            { nome: 'nome', tipo: 'string', obrigatorio: false, descricao: 'Identificacao da integracao. Ex: "ERP Producao"' },
            { nome: 'escopo', tipo: 'string', obrigatorio: false, valores: '"full" ou "readonly"', padrao: '"full"' },
          ],
          curl: `curl -X POST -H "x-api-key: SENHA_MESTRA" -H "Content-Type: application/json" -d '{"nome":"ERP Producao","escopo":"full"}' ${BASE}/api/empresas/12345678000199/keys`,
          resposta: '{ "sucesso": true, "chave": "nfe_live_...", "aviso": "Guarde esta chave agora...", "registro": {...} }',
        },
        {
          metodo: 'GET', path: '/api/empresas/:cnpj/keys',
          descricao: 'Lista as chaves da empresa (apenas prefixo, nunca o valor completo).',
          curl: `curl -H "x-api-key: SENHA_MESTRA" ${BASE}/api/empresas/12345678000199/keys`,
        },
        {
          metodo: 'DELETE', path: '/api/keys/:id',
          descricao: 'Revoga a chave imediatamente. Integracoes que a usam passam a receber 401.',
          curl: `curl -X DELETE -H "x-api-key: SENHA_MESTRA" ${BASE}/api/keys/12`,
        },
      ],
    },
    fluxo_tipico_erp: {
      titulo: 'Fluxo completo de integracao ERP',
      passos: [
        { passo: 1, endpoint: 'GET /api/ping', descricao: 'Verificar se a API esta online e configurada' },
        { passo: 2, endpoint: 'GET /api/status', descricao: 'Verificar se a SEFAZ esta em operacao (cStat 107)' },
        { passo: 3, endpoint: 'GET /api/proximo-numero?serie=800&modelo=55', descricao: 'Obter proximo numero disponivel para a serie' },
        { passo: 4, endpoint: 'POST /api/emitir', descricao: 'Emitir a NF-e com dados do pedido. Retorna chaveAcesso, protocolo, xml e danfePdf' },
        { passo: 5, acao: 'Armazenar no ERP', descricao: 'Salvar chaveAcesso (44 digitos) e protocolo no banco do ERP' },
        { passo: 6, endpoint: 'GET /api/nota/:chave/danfe', descricao: 'Baixar DANFE em PDF para impressao ou envio' },
        { passo: 7, endpoint: 'POST /api/enviar-email', descricao: 'Enviar DANFE + XML por email ao destinatario (opcional)' },
      ],
      fluxo_cancelamento: [
        { passo: 1, endpoint: 'POST /api/cancelar', descricao: 'Cancelar NF-e ate 24h apos autorizacao. Requer chaveAcesso + protocolo + justificativa (min 15 chars)' },
      ],
      fluxo_correcao: [
        { passo: 1, endpoint: 'POST /api/carta-correcao', descricao: 'Emitir CC-e para corrigir dados. NAO altera valores ou itens. Requer chaveAcesso + correcao (min 15 chars)' },
      ],
    },
    categorias: [
      {
        nome: '1. Emissao de NF-e (Modelo 55)',
        endpoints: [
          {
            metodo: 'POST', path: '/api/emitir',
            descricao: 'Emitir NF-e modelo 55. Aceita formato FLAT (simplificado para ERP) ou formato aninhado.',
            campos: [
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, valores: '"1" = producao, "2" = homologacao', padrao: 'Usa o ambiente da empresa cadastrada' },
              { nome: 'serie', tipo: 'string', obrigatorio: false, valores: '"1" a "889"', padrao: '"1"' },
              { nome: 'numero', tipo: 'string', obrigatorio: false, valores: 'Numero da NF-e', padrao: 'Proximo disponivel' },
              { nome: 'naturezaOperacao', tipo: 'string', obrigatorio: false, valores: 'Ex: VENDA, DEVOLUCAO, REMESSA', padrao: '"VENDA"' },
              { nome: 'finalidade', tipo: 'string', obrigatorio: false, valores: '"1"=Normal, "2"=Complementar, "3"=Ajuste, "4"=Devolucao', padrao: '"1"' },
              { nome: 'notaReferenciada', tipo: 'string ou array', obrigatorio: 'sim quando finalidade for "2" ou "4"', valores: 'Chave de acesso (44 digitos) da nota original. Aceita array para referenciar varias', padrao: 'vazio' },
              { nome: 'tipoOperacao', tipo: 'string', obrigatorio: false, valores: '"1"=Saida, "0"=Entrada', padrao: '"1"' },
              { nome: 'indFinal', tipo: 'string', obrigatorio: false, valores: '"1"=Consumidor final, "0"=Nao', padrao: '"1"' },
              { nome: 'modFrete', tipo: 'string', obrigatorio: false, valores: '"0"=Emitente, "1"=Destinatario, "9"=Sem frete', padrao: '"9"' },
              { nome: 'informacoesAdicionais', tipo: 'string OU objeto', obrigatorio: false, valores: 'String simples (vira infCpl) ou { "fisco": "...", "complementar": "..." } para separar os dois campos do XML', padrao: 'vazio' },
            ],
            campos_destinatario: [
              { nome: 'destinatario.cnpj', tipo: 'string (14 digitos)', obrigatorio: 'cnpj OU cpf', descricao: 'CNPJ do destinatario. Usar cnpj OU cpf, nunca ambos' },
              { nome: 'destinatario.cpf', tipo: 'string (11 digitos)', obrigatorio: 'cnpj OU cpf', descricao: 'CPF do destinatario pessoa fisica' },
              { nome: 'destinatario.razaoSocial', tipo: 'string', obrigatorio: true, descricao: 'Em homologacao, a SEFAZ substitui por texto padrao' },
              { nome: 'destinatario.indIEDest', tipo: 'string', obrigatorio: false, descricao: '"1"=Contribuinte, "2"=Isento, "9"=Nao contribuinte. Padrao: "9"' },
              { nome: 'destinatario.ie', tipo: 'string', obrigatorio: false, descricao: 'Inscricao Estadual (obrigatorio se indIEDest="1")' },
              { nome: 'destinatario.email', tipo: 'string', obrigatorio: false, descricao: 'Email do destinatario' },
            ],
            campos_endereco: [
              { nome: 'destinatario.endereco.logradouro', tipo: 'string', obrigatorio: true, descricao: 'Rua, Av, etc' },
              { nome: 'destinatario.endereco.numero', tipo: 'string', obrigatorio: true, descricao: 'Numero do endereco' },
              { nome: 'destinatario.endereco.bairro', tipo: 'string', obrigatorio: true, descricao: 'Bairro' },
              { nome: 'destinatario.endereco.codigoMunicipio', tipo: 'string (7 digitos)', obrigatorio: true, descricao: 'Codigo IBGE do municipio. Ex: "3530607" = Mogi das Cruzes' },
              { nome: 'destinatario.endereco.nomeMunicipio', tipo: 'string', obrigatorio: true, descricao: 'Nome do municipio em MAIUSCULAS. ATENCAO: o campo chama nomeMunicipio, NAO municipio' },
              { nome: 'destinatario.endereco.uf', tipo: 'string (2 chars)', obrigatorio: true, descricao: 'Sigla da UF. Ex: "SP", "RJ", "MG"' },
              { nome: 'destinatario.endereco.cep', tipo: 'string (8 digitos)', obrigatorio: true, descricao: 'CEP sem hifen' },
            ],
            campos_itens_flat: [
              { nome: 'itens[].codigo', tipo: 'string', obrigatorio: true, descricao: 'Codigo interno do produto no ERP' },
              { nome: 'itens[].descricao', tipo: 'string', obrigatorio: true, descricao: 'Descricao do produto' },
              { nome: 'itens[].ncm', tipo: 'string (8 digitos)', obrigatorio: true, descricao: 'Codigo NCM do produto' },
              { nome: 'itens[].cfop', tipo: 'string (4 digitos)', obrigatorio: true, descricao: 'CFOP da operacao. Ex: "5102"=Venda interna, "6102"=Venda interestadual' },
              { nome: 'itens[].unidade', tipo: 'string', obrigatorio: false, descricao: 'Unidade de medida. Padrao: "UN"' },
              { nome: 'itens[].quantidade', tipo: 'string|number', obrigatorio: true, descricao: 'Quantidade do item' },
              { nome: 'itens[].valorUnitario', tipo: 'string|number', obrigatorio: true, descricao: 'Valor unitario do item' },
              { nome: 'itens[].origem', tipo: 'string', obrigatorio: false, descricao: '"0"=Nacional, "1"=Import direta, "2"=Import indireta. Padrao: "0"' },
              { nome: 'itens[].cstIcms', tipo: 'string', obrigatorio: false, descricao: 'CST ICMS (CRT 3) ou CSOSN (CRT 1). Ex: "00","10","20","60" para CRT3; "102","500" para CRT1. Padrao: "00" ou "102"' },
              { nome: 'itens[].aliqIcms', tipo: 'string|number', obrigatorio: false, descricao: 'Aliquota ICMS em %. Ex: "18". Padrao: "0"' },
              { nome: 'itens[].cstPis', tipo: 'string', obrigatorio: false, descricao: 'CST PIS. Padrao: "99"' },
              { nome: 'itens[].cstCofins', tipo: 'string', obrigatorio: false, descricao: 'CST COFINS. Padrao: "99"' },
              { nome: 'itens[].cstIpi', tipo: 'string', obrigatorio: false, descricao: 'CST IPI. Padrao: "53" (nao tributado)' },
              { nome: 'itens[].ean', tipo: 'string', obrigatorio: false, descricao: 'Codigo de barras EAN/GTIN. Se omitido, usa "SEM GTIN"' },
              { nome: 'itens[].cest', tipo: 'string', obrigatorio: false, descricao: 'Codigo CEST (substituicao tributaria)' },
            ],
            campos_pagamento: [
              { nome: 'pagamento.forma', tipo: 'string', obrigatorio: true, descricao: 'Codigo da forma de pagamento. Ex: "01"=Dinheiro, "03"=Credito, "04"=Debito, "17"=PIX' },
              { nome: 'pagamento.valor', tipo: 'string|number', obrigatorio: true, descricao: 'Valor total do pagamento (deve bater com soma dos itens)' },
              { nome: 'pagamento.troco', tipo: 'string|number', obrigatorio: false, descricao: 'Valor do troco (se houver)' },
            ],
            alertas: [
              'O campo do endereco chama "nomeMunicipio", NAO "municipio". Usar "municipio" causa REJEICAO 225 (Falha no Schema XML)',
              'O campo do indicador IE chama "indIEDest", NAO "indicadorIE"',
              'Para itens com formato FLAT (sem objeto icms{}), a API normaliza automaticamente para o formato aninhado',
              'Se a empresa e Simples Nacional (CRT 1 ou 2), use CSOSN (ex: "102"). Se Regime Normal (CRT 3), use CST (ex: "00")',
              'A soma dos itens (quantidade * valorUnitario) deve bater com pagamento.valor',
              'Em HOMOLOGACAO (ambiente "2"), a razaoSocial do destinatario e substituida automaticamente pela SEFAZ',
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "ambiente": "2",
  "serie": "800",
  "destinatario": {
    "cnpj": "11222333000181",
    "razaoSocial": "EMPRESA TESTE LTDA",
    "indIEDest": "9",
    "endereco": {
      "logradouro": "Rua Teste",
      "numero": "100",
      "bairro": "Centro",
      "codigoMunicipio": "3530607",
      "nomeMunicipio": "MOGI DAS CRUZES",
      "uf": "SP",
      "cep": "08710000"
    }
  },
  "itens": [{
    "codigo": "PROD001",
    "descricao": "Mesa escritorio",
    "ncm": "94033000",
    "cfop": "5102",
    "unidade": "UN",
    "quantidade": "2",
    "valorUnitario": "75.00",
    "origem": "0",
    "cstIcms": "00",
    "aliqIcms": "18",
    "cstPis": "99",
    "cstCofins": "99"
  }],
  "pagamento": { "forma": "01", "valor": "150.00" }
}' ${BASE}/api/emitir`,
            response_sucesso: {
              sucesso: true, chaveAcesso: '35260734051105000191558000000000021621440983',
              protocolo: '135260006947477', dhRecbto: '2026-07-24T13:13:20-03:00',
              cStat: '100', xMotivo: 'Autorizado o uso da NF-e',
              arquivo: 'NFe_35260734051105000191558000000000021621440983.xml',
              xml: '(XML completo nfeProc com assinatura e protocolo)',
              danfePdf: '(base64 do PDF DANFE pronto para impressao)',
            },
            response_erro: { sucesso: false, cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML do lote de NFe' },
          },
        ],
      },
      {
        nome: '2. Emissao de NFC-e (Modelo 65)',
        endpoints: [
          {
            metodo: 'POST', path: '/api/emitir-nfce',
            descricao: 'Emitir NFC-e modelo 65 (cupom fiscal). Requer CSC configurado na empresa.',
            campos: [
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, valores: '"1" ou "2"', padrao: 'ambiente da empresa' },
              { nome: 'serie', tipo: 'string', obrigatorio: false, padrao: '"1"' },
              { nome: 'itens[]', tipo: 'array', obrigatorio: true, descricao: 'Mesmo formato dos itens da NF-e (flat ou aninhado)' },
              { nome: 'pagamento', tipo: 'object', obrigatorio: true, descricao: 'Mesmo formato da NF-e: { forma, valor }' },
              { nome: 'destinatario', tipo: 'object', obrigatorio: false, descricao: 'Opcional para NFC-e. Se informado: cpf (ou cnpj, nunca os dois) + razaoSocial' },
            ],
            alertas: [
              'A empresa precisa ter CSC (Codigo de Seguranca do Contribuinte) cadastrado. Configure em Empresas > CSC',
              'NFC-e so aceita operacao interna: a API corrige o primeiro digito do CFOP para 5 sozinha '
                + 'e devolve o que mudou em cfopAjustado',
              'cnpj E cpf preenchidos juntos sao recusados com 400. Nao ha escolha automatica: o descartado '
                + 'sairia autorizado no nome errado, sem rejeicao para avisar',
              'Serie fora de 0-889 e recusada com 400 (a SEFAZ reserva 890-999 e responde cStat 244)',
              'NFC-e NAO aceita destinatario PJ com IE (indIEDest diferente de "9")',
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 12345678000199" \\
  -H "Content-Type: application/json" \\
  -d '{
  "ambiente": "2",
  "itens": [{
    "codigo": "PROD001",
    "descricao": "Refrigerante Lata",
    "ncm": "22021000",
    "cfop": "5102",
    "quantidade": "2",
    "valorUnitario": "5.00",
    "cstIcms": "00",
    "aliqIcms": "18",
    "cstPis": "99",
    "cstCofins": "99"
  }],
  "pagamento": { "forma": "17", "valor": "10.00" }
}' ${BASE}/api/emitir-nfce`,
            response_sucesso: { sucesso: true, chaveAcesso: '(44 digitos)', protocolo: '(15 digitos)', xml: '(nfeProc XML)', danfePdf: '(base64 PDF)', qrCode: '(URL QR Code para impressao)' },
          },
        ],
      },
      {
        nome: '3. Emissao de NFS-e (Sistema Nacional)',
        resumo: 'Nota de SERVICO, pelo Emissor Nacional (padrao ABRASF/RFB) — nao pela '
          + 'prefeitura. O municipio do prestador precisa ter aderido: se nao aderiu, a API '
          + 'recusa ANTES de transmitir e diz que o problema e a prefeitura, e nao a nota. '
          + 'A partir de 01/09/2026 as empresas do Simples que prestam servico so emitem por aqui.',
        endpoints: [
          {
            metodo: 'GET', path: '/api/nfse/convenio',
            descricao: 'O municipio do prestador emite pelo Emissor Nacional? Consulte ANTES de '
              + 'integrar: sem adesao, nenhuma nota sai, e nao ha o que ajustar do lado do ERP.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/convenio`,
            response_sucesso: { sucesso: true, podeEmitir: true, podeBaixar: true, codigoMunicipio: '3136702' },
          },
          {
            metodo: 'POST', path: '/api/nfse/emitir',
            descricao: 'Emitir NFS-e. O ISS e calculado pela tributacao informada; a numeracao '
              + 'e por serie e ambiente.',
            campos: [
              { nome: 'ambiente', tipo: "'1' | '2'", obrigatorio: false, descricao: '1 producao, 2 homologacao. Sem informar, usa o da empresa.' },
              { nome: 'serie', tipo: 'string', obrigatorio: false, descricao: 'Serie da DPS. Padrao: 1.' },
              { nome: 'numero', tipo: 'number', obrigatorio: false, descricao: 'Sem informar, a API pega o proximo da serie.' },
              { nome: 'competencia', tipo: 'string (AAAA-MM-DD)', obrigatorio: false, descricao: 'Mes de competencia do servico. Padrao: hoje.' },
              { nome: 'tomador.cnpj', tipo: 'string (14 digitos)', obrigatorio: 'um dos tres', descricao: 'CNPJ do tomador.' },
              { nome: 'tomador.cpf', tipo: 'string (11 digitos)', obrigatorio: 'um dos tres', descricao: 'CPF do tomador.' },
              { nome: 'tomador.nif', tipo: 'string', obrigatorio: 'um dos tres', descricao: 'Identificacao fiscal, para tomador no exterior.' },
              { nome: 'tomador.razaoSocial', tipo: 'string', obrigatorio: true },
              { nome: 'tomador.email', tipo: 'string', obrigatorio: false },
              { nome: 'tomador.endereco', tipo: 'objeto', obrigatorio: false, descricao: 'Mesma forma do destinatario da NF-e.' },
              { nome: 'servicoCodigo', tipo: 'string', obrigatorio: true, descricao: 'Codigo de tributacao nacional (cTribNac) — o item da LC 116.' },
              { nome: 'servico', tipo: 'string', obrigatorio: true, descricao: 'Descricao do servico prestado.' },
              { nome: 'valorServico', tipo: 'number', obrigatorio: true },
              { nome: 'aliquotaIss', tipo: 'number', obrigatorio: false, descricao: 'Em porcento. No Simples, quem define e o regime — nao informe.' },
              { nome: 'issRetido', tipo: 'boolean', obrigatorio: false, descricao: 'ISS retido na fonte pelo tomador.' },
              { nome: 'tributacaoIssqn', tipo: 'string', obrigatorio: false, descricao: 'Tributavel, isento, imune, exigibilidade suspensa. Imunidade sem o tipo e recusada (E0592).' },
              { nome: 'obra', tipo: 'objeto', obrigatorio: 'em servico de construcao', descricao: 'Alguns subitens da LC 116 EXIGEM o grupo de obra (E0370) e outros o RECUSAM (E0372).' },
              { nome: 'comercioExterior', tipo: 'objeto', obrigatorio: 'em exportacao', descricao: 'Exportacao sem este grupo e recusada com E0330.' },
              { nome: 'simular', tipo: 'boolean', obrigatorio: false, descricao: 'Monta e valida SEM transmitir. Nao consome cota.' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
  "tomador": { "cnpj": "12345678000190", "razaoSocial": "CLIENTE LTDA" },
  "servicoCodigo": "010701",
  "servico": "Suporte tecnico mensal",
  "valorServico": 1500.00
}' ${BASE}/api/nfse/emitir`,
            response_sucesso: { sucesso: true, chaveAcesso: 'NFS35...', numero: 42, serie: '1', dataEmissao: '2026-08-28T09:00:00-03:00' },
          },
          {
            metodo: 'POST', path: '/api/nfse/cancelar',
            descricao: 'Cancelar NFS-e emitida.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string', obrigatorio: true },
              { nome: 'motivo', tipo: 'string', obrigatorio: true },
            ],
            curl_exemplo: `curl -s -X POST -H "x-api-key: SUA_CHAVE" -H "Content-Type: application/json" \\
  -d '{"chaveAcesso":"NFS35...","motivo":"Servico nao prestado"}' ${BASE}/api/nfse/cancelar`,
          },
          {
            metodo: 'GET', path: '/api/nfse/{chave}',
            descricao: 'Consultar uma NFS-e. `/xml` e `/danfse` baixam o XML e o PDF.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/CHAVE`,
          },
          {
            metodo: 'GET', path: '/api/nfse/historico?limit=50',
            descricao: 'Listar as NFS-e emitidas pela empresa.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/nfse/historico?limit=50"`,
          },
          {
            metodo: 'GET', path: '/api/nfse/proximo-numero?serie=1',
            descricao: 'O proximo numero livre da serie. Util para o ERP reservar antes de emitir.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/nfse/proximo-numero?serie=1"`,
          },
          {
            metodo: 'GET', path: '/api/nfse/distribuicao',
            descricao: 'NFS-e RECEBIDAS pela empresa, do Ambiente Nacional.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/distribuicao`,
          },
          {
            metodo: 'POST', path: '/api/nfse/enviar-email',
            descricao: 'Enviar a NFS-e (PDF + XML) por email. Requer SMTP configurado.',
            curl_exemplo: `curl -s -X POST -H "x-api-key: SUA_CHAVE" -H "Content-Type: application/json" \\
  -d '{"chaveAcesso":"NFS35...","destinatarioEmail":"cliente@email.com"}' ${BASE}/api/nfse/enviar-email`,
          },
        ],
        avisos: [
          'Municipio sem adesao ao Emissor Nacional recusa ANTES de transmitir, com a mensagem '
          + 'dizendo que a adesao e feita pela prefeitura. Nao ha ajuste no ERP que contorne isso.',
          'ADN fora do ar NAO bloqueia a emissao: indisponibilidade de terceiro nao pode impedir '
          + 'de faturar.',
          'A partir de 01/09/2026, empresa do Simples que presta servico so emite pelo Emissor '
          + 'Nacional (Resolucao CGSN 189/2026).',
        ],
      },
      {
        nome: '4. Cancelamento, Correcao e Inutilizacao',
        endpoints: [
          {
            metodo: 'POST', path: '/api/cancelar',
            descricao: 'Cancelar NF-e autorizada. Prazo maximo: 24 horas apos autorizacao.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (44 digitos)', obrigatorio: true, descricao: 'Chave de acesso da NF-e a cancelar' },
              { nome: 'protocolo', tipo: 'string (15 digitos)', obrigatorio: true, descricao: 'Protocolo de autorizacao retornado no POST /api/emitir' },
              { nome: 'justificativa', tipo: 'string (min 15 chars)', obrigatorio: true, descricao: 'Motivo do cancelamento' },
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, padrao: 'ambiente da empresa' },
            ],
            alertas: [
              'O campo "protocolo" e OBRIGATORIO. E o numero retornado no campo "protocolo" do POST /api/emitir',
              'A justificativa deve ter no MINIMO 15 caracteres',
              'Apos 24h, o cancelamento pode ser rejeitado pela SEFAZ',
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "chaveAcesso": "35260734051105000191558000000000021621440983",
  "protocolo": "135260006947477",
  "justificativa": "Erro no preenchimento dos dados da nota fiscal",
  "ambiente": "2"
}' ${BASE}/api/cancelar`,
            response_sucesso: { sucesso: true, cStat: '135', xMotivo: 'Evento registrado e vinculado a NF-e', protocoloEvento: '135260006947551' },
            response_erro: { sucesso: false, cStat: '501', xMotivo: 'Rejeicao: Prazo de cancelamento excedido' },
          },
          {
            metodo: 'POST', path: '/api/carta-correcao',
            descricao: 'Emitir Carta de Correcao eletronica (CC-e). NAO altera valores, itens ou impostos.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (44 digitos)', obrigatorio: true, descricao: 'Chave de acesso da NF-e' },
              { nome: 'correcao', tipo: 'string (min 15 chars)', obrigatorio: true, descricao: 'Texto da correcao. Ex: endereco, CFOP, dados do transportador' },
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, padrao: 'ambiente da empresa' },
            ],
            alertas: [
              'CC-e NAO corrige: valores, quantidades, aliquotas, dados do emitente (CNPJ/IE), numero/serie',
              'CC-e corrige: endereco destinatario, CFOP, dados do transportador, peso, informacoes adicionais',
              'Pode emitir ate 20 CC-e por NF-e. Cada nova substitui a anterior',
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "chaveAcesso": "35260734051105000191558000000000021621440983",
  "correcao": "Correcao do endereco do destinatario: Rua Nova 456, Bairro Centro, CEP 08710100",
  "ambiente": "2"
}' ${BASE}/api/carta-correcao`,
            response_sucesso: { sucesso: true, cStat: '135', xMotivo: 'Evento registrado e vinculado a NF-e', protocoloEvento: '135260006947501' },
          },
          {
            metodo: 'POST', path: '/api/inutilizar',
            descricao: 'Inutilizar faixa de numeracao. Use quando numeros foram pulados (ex: falha no sistema).',
            campos: [
              { nome: 'serie', tipo: 'string', obrigatorio: true, descricao: 'Serie da NF-e. Faixa permitida: "0" a "889"' },
              { nome: 'nNFIni', tipo: 'string|number', obrigatorio: true, descricao: 'Numero inicial da faixa. ATENCAO: o campo chama nNFIni, NAO numeroInicial' },
              { nome: 'nNFFin', tipo: 'string|number', obrigatorio: true, descricao: 'Numero final da faixa. ATENCAO: o campo chama nNFFin, NAO numeroFinal' },
              { nome: 'justificativa', tipo: 'string (min 15 chars)', obrigatorio: true, descricao: 'Motivo da inutilizacao' },
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, padrao: 'ambiente da empresa' },
            ],
            alertas: [
              'Os campos chamam "nNFIni" e "nNFFin", NAO "numeroInicial"/"numeroFinal"',
              'Serie deve estar entre 0 e 889 (SEFAZ rejeita serie >= 890)',
              'Numeros ja utilizados (autorizados ou cancelados) NAO podem ser inutilizados',
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "serie": "850",
  "nNFIni": "1",
  "nNFFin": "3",
  "justificativa": "Numeracao reservada para testes nao utilizada",
  "ambiente": "2"
}' ${BASE}/api/inutilizar`,
            response_sucesso: { sucesso: true, cStat: '102', xMotivo: 'Inutilizacao de numero homologado', nProt: '135260006947538' },
          },
        ],
      },
      {
        nome: '5. Consultas e Historico',
        endpoints: [
          {
            metodo: 'GET', path: '/api/status',
            descricao: 'Verificar se a SEFAZ esta em operacao.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/status"`,
            response_sucesso: { online: true, cStat: '107', xMotivo: 'Servico em operacao', ambiente: 'PRODUCAO' },
          },
          {
            metodo: 'GET', path: '/api/consultar?chave=CHAVE_44_DIGITOS',
            descricao: 'Consultar situacao de uma NF-e na SEFAZ em tempo real.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/consultar?chave=35260734051105000191558000000000021621440983"`,
            response_sucesso: { chaveAcesso: '35260734051105000191558000000000021621440983', cStat: '100', xMotivo: 'Autorizado o uso da NF-e' },
          },
          {
            metodo: 'GET', path: '/api/historico',
            descricao: 'Listar notas emitidas. Filtra por empresa do header x-empresa-cnpj.',
            campos: [
              { nome: 'limit', tipo: 'query param', obrigatorio: false, descricao: 'Limite de resultados. Padrao: 100' },
              { nome: 'todas', tipo: 'query param', obrigatorio: false, descricao: '"1" para listar de todas as empresas (requer admin)' },
            ],
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/historico?limit=10"`,
            response_sucesso: [{ chaveAcesso: '35260734051105000191558000000000021621440983', empresaCnpj: '34051105000191', numero: '2', serie: '800', ambiente: '2', destNome: 'EMPRESA TESTE LTDA', destDoc: '11222333000181', vNF: '150.00', protocolo: '135260006947477', status: 'AUTORIZADA', emitidaEm: '2026-07-24T16:13:24.127Z' }],
          },
          {
            metodo: 'GET', path: '/api/nota/:chave/xml',
            descricao: 'Baixar XML completo da NF-e (nfeProc). Retorna Content-Type: text/xml.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/nota/35260734051105000191558000000000021621440983/xml" -o nota.xml`,
          },
          {
            metodo: 'GET', path: '/api/nota/:chave/danfe',
            descricao: 'Baixar DANFE em PDF. Retorna Content-Type: application/pdf.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/nota/35260734051105000191558000000000021621440983/danfe" -o danfe.pdf`,
          },
          {
            metodo: 'GET', path: '/api/proximo-numero',
            descricao: 'Obter proximo numero disponivel para emissao.',
            campos: [
              { nome: 'serie', tipo: 'query param', obrigatorio: false, descricao: 'Serie da NF-e. Padrao: "1"' },
              { nome: 'modelo', tipo: 'query param', obrigatorio: false, descricao: '"55" (NF-e) ou "65" (NFC-e). Padrao: "55"' },
            ],
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/proximo-numero?serie=800&modelo=55"`,
            response_sucesso: { serie: '800', numero: 3, storage: 'postgres' },
          },
          {
            metodo: 'GET', path: '/api/relatorio',
            descricao: 'Relatorio fiscal mensal consolidado por empresa.',
            campos: [
              { nome: 'mes', tipo: 'query param', obrigatorio: true, descricao: 'Formato YYYY-MM. Ex: "2026-07"' },
              { nome: 'cnpj', tipo: 'query param', obrigatorio: false, descricao: 'Filtrar por CNPJ especifico' },
            ],
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" "${BASE}/api/relatorio?mes=2026-07"`,
            response_sucesso: { mes: '2026-07', empresas: { '34051105000191': { autorizadas: 5, canceladas: 1, valorTotal: 1500.00, valorCancelado: 150.00 } }, totalNotas: 6 },
          },
          {
            metodo: 'GET', path: '/api/export-xmls',
            descricao: 'Exportar todos os XMLs do mes em um arquivo ZIP.',
            campos: [
              { nome: 'mes', tipo: 'query param', obrigatorio: true, descricao: 'Formato YYYY-MM' },
              { nome: 'cnpj', tipo: 'query param', obrigatorio: false, descricao: 'Filtrar por empresa' },
            ],
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" "${BASE}/api/export-xmls?cnpj=34051105000191&mes=2026-07" -o xmls.zip`,
          },
        ],
      },
      {
        nome: '6. Manifestacao e DF-e',
        endpoints: [
          {
            metodo: 'POST', path: '/api/manifestar',
            descricao: 'Manifestacao do destinatario sobre NF-e recebida.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (44 digitos)', obrigatorio: true, descricao: 'Chave da NF-e recebida' },
              { nome: 'tipoEvento', tipo: 'string', obrigatorio: true, descricao: '"210200"=Confirmacao, "210210"=Ciencia, "210220"=Desconhecimento, "210240"=Nao Realizada' },
              { nome: 'justificativa', tipo: 'string', obrigatorio: 'Sim para 210240', descricao: 'Motivo (obrigatorio para "Nao Realizada")' },
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, padrao: 'ambiente da empresa' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "chaveAcesso": "35260700000000000000550010000000011234567890",
  "tipoEvento": "210210"
}' ${BASE}/api/manifestar`,
            response_sucesso: { sucesso: true, cStat: '135', descEvento: 'Ciencia da Operacao' },
          },
          {
            metodo: 'POST', path: '/api/consulta-dfe',
            descricao: 'Consultar NF-e recebidas via Distribuicao DF-e (SEFAZ Ambiente Nacional).',
            campos: [
              { nome: 'ultNSU', tipo: 'string', obrigatorio: false, descricao: 'Ultimo NSU consultado. Padrao: "0" (busca desde o inicio)', padrao: '"0"' },
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, padrao: 'ambiente da empresa' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{"ultNSU":"0"}' ${BASE}/api/consulta-dfe`,
            response_sucesso: { sucesso: true, ultNSU: '000000000000150', maxNSU: '000000000000200', documentos: [{ NSU: '000000000000001', schema: 'resNFe', chNFe: '(44 digitos)', CNPJ: '(emitente)', xNome: '(razao social)', vNF: '100.00' }] },
          },
        ],
      },
      {
        nome: '7. Cadastros (Empresas, Produtos)',
        endpoints: [
          {
            metodo: 'GET', path: '/api/empresas',
            descricao: 'Listar todas as empresas cadastradas.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" ${BASE}/api/empresas`,
            response_sucesso: [{ cnpj: '34051105000191', razaoSocial: '3A COMERCIO DE VEICULOS MULTIMARCAS LTDA', ie: '454642662110', crt: '3', uf: 'SP', ambiente: '1', municipio: 'MOGI DAS CRUZES', ativa: true }],
          },
          {
            metodo: 'POST', path: '/api/empresas',
            descricao: 'Cadastrar nova empresa ou atualizar existente. Enviar certificado PFX em base64.',
            campos: [
              { nome: 'cnpj', tipo: 'string (14 digitos)', obrigatorio: true },
              { nome: 'razaoSocial', tipo: 'string', obrigatorio: true },
              { nome: 'ie', tipo: 'string', obrigatorio: true, descricao: 'Inscricao Estadual' },
              { nome: 'crt', tipo: 'string', obrigatorio: true, descricao: '"1"=Simples Nacional, "2"=Simples excesso, "3"=Regime Normal' },
              { nome: 'uf', tipo: 'string (2 chars)', obrigatorio: true },
              { nome: 'ambiente', tipo: 'string', obrigatorio: true, descricao: '"1"=Producao, "2"=Homologacao' },
              { nome: 'pfxBase64', tipo: 'string', obrigatorio: true, descricao: 'Certificado digital A1 (.pfx) codificado em base64' },
              { nome: 'pfxPassword', tipo: 'string', obrigatorio: true, descricao: 'Senha do certificado PFX' },
            ],
          },
          {
            metodo: 'DELETE', path: '/api/empresas/:cnpj',
            descricao: 'Remover empresa cadastrada (somente admin).',
            curl_exemplo: `curl -s -X DELETE -H "x-api-key: SUA_SENHA" ${BASE}/api/empresas/12345678000199`,
          },
          {
            metodo: 'GET', path: '/api/produtos',
            descricao: 'Listar produtos cadastrados da empresa.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" ${BASE}/api/produtos`,
          },
          {
            metodo: 'POST', path: '/api/produtos',
            descricao: 'Cadastrar ou atualizar produto.',
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "codigo": "PROD001",
  "descricao": "Mesa escritorio MDF",
  "ncm": "94033000",
  "cfop": "5102",
  "unidade": "UN",
  "valorUnitario": "450.00",
  "cstCsosn": "00",
  "aliqIcms": "18",
  "origem": "0"
}' ${BASE}/api/produtos`,
          },
          {
            metodo: 'GET', path: '/api/certificado-info',
            descricao: 'Informacoes do certificado digital A1 da empresa.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" -H "x-empresa-cnpj: 34051105000191" ${BASE}/api/certificado-info`,
            response_sucesso: { cnpj: '34051105000191', subject: '3A COMERCIO DE VEICULOS...:34051105000191', validoAte: '2026-10-09T13:21:56.000Z', diasRestantes: 77, vencido: false, alertaVencimento: false },
          },
          {
            metodo: 'GET', path: '/api/certificados-alertas',
            descricao: 'Listar todas as empresas com status do certificado (vencimento, alertas).',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" ${BASE}/api/certificados-alertas`,
          },
        ],
      },
      {
        nome: '6b. NFS-e — Nota Fiscal de Servico (Sistema Nacional)',
        aviso: 'Documento diferente da NF-e: quem autoriza e a SEFIN Nacional, nao a SEFAZ. '
          + 'A chave tem 50 digitos (a da NF-e tem 44) e a nota volta autorizada na propria resposta, sem protocolo a consultar depois.',
        pre_requisitos: [
          'EMITIR pelo Emissor Nacional exige que o municipio seja aderente a ele. Consulte em GET /parametrizacao/{municipio}/convenio no ADN: o campo aderenteEmissorNacional precisa ser 1. Quando nao e, a SEFIN recusa com E0039.',
          'E exige tambem que o CNPJ conste como contribuinte naquele municipio (cadastros CNPJ e CNC NFS-e). Quando nao consta, a SEFIN recusa com E0084.',
          'Os dois sao credenciamento junto a prefeitura — nenhuma alteracao na integracao resolve.',
          'BAIXAR notas ja emitidas NAO exige nada disso: basta o municipio ser aderente ao AMBIENTE Nacional (aderenteAmbienteNacional = 1), o que e o caso da maioria. Use POST /api/nfse/distribuicao.',
        ],
        limite_conhecido: 'O grupo ibsCbs tem estrutura confirmada como aceita pelo schema da SEFIN, '
          + 'mas a validade dos codigos nao pode ser verificada: a recusa por credenciamento (E0084) acontece '
          + 'antes da validacao do IBS/CBS. Por isso codigoIndicadorOperacao nao tem valor padrao — confirme com '
          + 'a contabilidade antes de usar em producao.',
        endpoints: [
          {
            metodo: 'POST', path: '/api/nfse/emitir',
            descricao: 'Emitir NFS-e. O servico vem do catalogo (servicoCodigo) ou inline (objeto servico).',
            campos: [
              { nome: 'ambiente', tipo: 'string', obrigatorio: false, valores: '"1" = producao, "2" = producao restrita', padrao: 'Ambiente da empresa' },
              { nome: 'serie', tipo: 'string', obrigatorio: false, valores: '1 a 5 digitos, nunca zero', padrao: '"1"' },
              { nome: 'numero', tipo: 'string', obrigatorio: false, valores: 'Numero da DPS, sem zero a esquerda', padrao: 'Proximo disponivel' },
              { nome: 'competencia', tipo: 'string', obrigatorio: false, valores: 'AAAA-MM-DD (mes de referencia)', padrao: 'Primeiro dia do mes atual' },
              { nome: 'servicoCodigo', tipo: 'string', obrigatorio: false, descricao: 'Codigo do servico no catalogo da empresa. Dispensa informar o objeto servico' },
              { nome: 'servico.codigoTributacaoNacional', tipo: 'string (6 digitos)', obrigatorio: 'sim, se nao usar servicoCodigo', descricao: 'Item(2) + subitem(2) + desdobro(2) da LC 116. O desdobro comeca em 01 — nao existe "00"' },
              { nome: 'servico.descricao', tipo: 'string', obrigatorio: false, descricao: 'Discriminacao do servico prestado' },
              { nome: 'servico.codigoMunicipioPrestacao', tipo: 'string (IBGE)', obrigatorio: false, padrao: 'Municipio do prestador' },
              { nome: 'servico.obra', tipo: 'objeto', obrigatorio: 'sim nos subitens de obra', descricao: 'Informe codigoObra (CNO/CEI), codigoCIB ou endereco { cep, logradouro, numero, bairro }. Obrigatorio em 07.02, 07.04 a 07.08, 07.17 e 07.19; PROIBIDO nos demais' },
              { nome: 'valorServico', tipo: 'string', obrigatorio: true, descricao: 'Aceita "1.500,00" ou "1500.00"' },
              { nome: 'aliquotaIss', tipo: 'string', obrigatorio: false, descricao: 'Percentual do ISS. O valor que vale e o apurado pelo municipio' },
              { nome: 'deducaoReducao', tipo: 'objeto', obrigatorio: false, descricao: 'Reduz a base do ISS (subempreitada, material aplicado). Informe { percentual } OU { valor } — nunca os dois, o XSD aceita so um' },
              { nome: 'retencoes.valorRetidoINSS', tipo: 'string', obrigatorio: false, descricao: 'Contribuicao previdenciaria retida (vRetCP no XSD)' },
              { nome: 'retencoes.valorRetidoIRRF', tipo: 'string', obrigatorio: false, descricao: 'IR retido na fonte' },
              { nome: 'retencoes.valorRetidoCSLL', tipo: 'string', obrigatorio: false, descricao: 'CSLL retida' },
              { nome: 'retencoes.pisCofins', tipo: 'objeto', obrigatorio: false, descricao: 'PIS e COFINS vao num grupo unico com CST comum ("00" a "09"), diferente da NF-e: { cst, baseCalculo, aliquotaPis, aliquotaCofins, valorPis, valorCofins, retido }' },
              { nome: 'intermediario', tipo: 'objeto', obrigatorio: false, descricao: 'Quem intermediou o negocio. Mesma estrutura do tomador: { cnpj ou cpf, razaoSocial, endereco, im, fone, email }' },
              { nome: 'servico.atividadeEvento', tipo: 'objeto', obrigatorio: false, descricao: 'Show, feira ou congresso: { nome, dataInicio, dataFim (AAAA-MM-DD), e codigoEvento OU endereco } — o XSD aceita um dos dois, nunca ambos' },
              { nome: 'ibsCbs', tipo: 'objeto', obrigatorio: false, descricao: 'IBS/CBS da Reforma Tributaria. Opcional no XSD hoje, tende a virar obrigatorio como na NF-e. Estrutura diferente da NF-e: vai uma vez por nota e declara so a situacao tributaria — { codigoIndicadorOperacao (6 digitos, Anexo VII, OBRIGATORIO), cst (padrao "000"), classificacaoTributaria (padrao "000001"), indicadorDestinatario ("0" tomador e o destinatario), usoConsumoPessoal, codigoCreditoPresumido }' },
              { nome: 'issRetido', tipo: 'string', obrigatorio: false, valores: '"1" = NAO retido, "2" = retido pelo tomador, "3" = retido pelo intermediario', padrao: '"1"', descricao: 'ATENCAO: a polaridade e o contrario da intuicao. No XSD (tpRetISSQN) o "1" significa NAO retido. Trocar os dois inverte quem paga o ISS na nota. Com "2" ou "3" o endereco do tomador passa a ser obrigatorio (E0237)' },
              { nome: 'tributacaoIssqn', tipo: 'string', obrigatorio: false, valores: '"1" tributavel, "2" imunidade, "3" exportacao, "4" nao incidencia', padrao: '"1"', descricao: 'Duas opcoes exigem grupo adicional: "2" exige tipoImunidade (E0592) e "3" exige servico.comercioExterior (E0330)' },
              { nome: 'tipoImunidade', tipo: 'string', obrigatorio: 'sim quando tributacaoIssqn = "2"', valores: '"0" nao informado, "1" CF 150 VI a, "2" templos, "3" partidos/sindicatos/entidades, "4" livros e jornais, "5" fonogramas brasileiros' },
              { nome: 'exigibilidadeSuspensa', tipo: 'objeto', obrigatorio: false, descricao: 'Suspensao da cobranca: { tipo ("1" judicial, "2" administrativo), numeroProcesso }. O XSD exige 30 digitos; o numero do CNJ tem 20 e a API completa com zeros a esquerda' },
              { nome: 'beneficioMunicipal', tipo: 'objeto', obrigatorio: false, descricao: 'Beneficio concedido pelo municipio: { numero (14 digitos), valorReducao OU percentualReducao }. O numero e gerado pelo Sistema Nacional quando o municipio cadastra o beneficio, nao escolhido pelo emitente — numero inexistente retorna E0541' },
              { nome: 'servico.comercioExterior', tipo: 'objeto', obrigatorio: 'sim quando tributacaoIssqn = "3"', descricao: 'Todos obrigatorios: { modoPrestacao, vinculoEntrePartes, codigoMoeda (3 digitos BACEN, 220 = dolar EUA), valorMoedaEstrangeira, mecanismoFomentoPrestador, mecanismoFomentoTomador, movimentacaoTemporaria, compartilharComMdic }. Opcionais: numeroDeclaracaoImportacao, numeroRegistroExportacao' },
              { nome: 'tomador.cnpj / tomador.cpf', tipo: 'string', obrigatorio: 'um dos dois', descricao: 'Quem contratou o servico' },
              { nome: 'tomador.razaoSocial', tipo: 'string', obrigatorio: false, padrao: '"CONSUMIDOR"' },
              { nome: 'tomador.endereco', tipo: 'objeto', obrigatorio: false, descricao: '{ logradouro, numero, bairro, codigoMunicipio, uf, cep }' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
  "ambiente": "2",
  "servico": { "codigoTributacaoNacional": "010101", "descricao": "DESENVOLVIMENTO DE SISTEMAS" },
  "valorServico": "1500.00",
  "aliquotaIss": "2.90",
  "tomador": { "cnpj": "33645647000120", "razaoSocial": "CLIENTE LTDA" }
}' ${BASE}/api/nfse/emitir`,
            response_sucesso: {
              sucesso: true,
              chaveAcesso: '<50 digitos>',
              numero: '451',
              idDps: 'DPS...',
              nota: { valores: { baseCalculo: '1500.00', aliquotaAplicada: '2.90', issqn: '43.50', liquido: '1456.50' } },
            },
            observacao: 'A numeracao so avanca apos a autorizacao — nota rejeitada nao queima numero. '
              + 'Antes de enviar, a API pergunta a SEFIN se ja existe nota para aquele DPS, para que um timeout anterior nao vire duplicata.',
          },
          {
            metodo: 'POST', path: '/api/nfse/cancelar',
            descricao: 'Cancelar NFS-e (evento e101101). O prazo e definido pelo municipio, nao pelo Sistema Nacional.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (50 digitos)', obrigatorio: true },
              { nome: 'motivo', tipo: 'string', obrigatorio: false, valores: '"1" erro na emissao, "2" servico nao prestado, "9" outros', padrao: '"1"' },
              { nome: 'justificativa', tipo: 'string', obrigatorio: true, descricao: 'Minimo de 15 e maximo de 255 caracteres — o XSD recusa textos curtos' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
  "chaveAcesso": "<50 digitos>",
  "motivo": "1",
  "justificativa": "Servico faturado em duplicidade para o mesmo cliente"
}' ${BASE}/api/nfse/cancelar`,
          },
          {
            metodo: 'POST', path: '/api/nfse/analise-fiscal',
            descricao: 'Pedir analise fiscal para cancelar a nota. Recurso para quando o prazo de cancelamento '
              + 'do municipio venceu e a substituicao nao serve — servico nao prestado, por exemplo, onde nao ha '
              + 'nota correta para colocar no lugar. O fisco responde com deferimento (e105104) ou indeferimento '
              + '(e105105), que aparecem na consulta de eventos.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (50 digitos)', obrigatorio: true },
              { nome: 'motivo', tipo: 'string', obrigatorio: false, valores: '"1" erro na emissao, "2" servico nao prestado, "9" outros', padrao: '"1"', descricao: 'A documentacao do XSD cita um "3", mas a enumeracao nao o aceita' },
              { nome: 'justificativa', tipo: 'string', obrigatorio: true, descricao: 'Minimo de 15 caracteres' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{ "chaveAcesso": "<50 digitos>", "motivo": "2", "justificativa": "Servico nao foi prestado ao cliente" }' \\
  ${BASE}/api/nfse/analise-fiscal`,
          },
          {
            metodo: 'GET', path: '/api/nfse/{chave}',
            descricao: 'Consultar a NFS-e na SEFIN pela chave de acesso.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/<50 digitos>`,
          },
          {
            metodo: 'GET', path: '/api/nfse/{chave}/eventos/{tipo}?seq=1',
            descricao: 'Consultar eventos registrados sobre a nota. Necessario porque o status guardado aqui '
              + 'so reflete o que passou por esta API: cancelamento de oficio pelo municipio (e305101), bloqueio '
              + '(e305102) ou rejeicao pelo tomador acontecem sem passar por nos.',
            campos: [
              { nome: 'tipo', tipo: 'string (path)', obrigatorio: true, descricao: 'Tipo do evento: e101101 cancelamento, e105102 cancelamento por substituicao, e305101 cancelamento de oficio, e305102 bloqueio' },
              { nome: 'seq', tipo: 'number (query)', obrigatorio: false, padrao: '1', descricao: 'Numero sequencial. Cancelamento so ocorre uma vez, entao e sempre 1' },
            ],
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/nfse/<50 digitos>/eventos/e101101"`,
          },
          {
            metodo: 'POST', path: '/api/nfse/emitir (com substituicao)',
            descricao: 'Substituir uma NFS-e. NAO existe endpoint de substituicao: a SEFIN recusa o evento '
              + 'e105102 no POST de eventos com E1861. Emite-se a nota CORRETA declarando qual ela substitui, '
              + 'e o Sistema Nacional cancela a antiga ao autorizar. E o caminho quando o prazo de cancelamento '
              + 'do municipio ja venceu.',
            campos: [
              { nome: 'substituicao.chaveSubstituida', tipo: 'string (50 digitos)', obrigatorio: true, descricao: 'Chave da nota que sai de circulacao. Chave invalida retorna E0042' },
              { nome: 'substituicao.motivo', tipo: 'string (2 digitos)', obrigatorio: true, valores: '"01" desenquadramento do Simples, "02" enquadramento no Simples, "03" inclusao retroativa de imunidade/isencao, "04" exclusao retroativa, "05" rejeicao pelo tomador ou intermediario, "99" outros', descricao: 'ATENCAO: dois digitos, diferente dos codigos de cancelamento que tem um' },
              { nome: 'substituicao.descricaoMotivo', tipo: 'string', obrigatorio: false, descricao: 'Opcional aqui, ao contrario do cancelamento. Se informado, minimo de 15 caracteres' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
  "ambiente": "2",
  "servico": { "codigoTributacaoNacional": "010101", "descricao": "SERVICO CORRIGIDO" },
  "valorServico": "1500.00",
  "tomador": { "cnpj": "33645647000120", "razaoSocial": "CLIENTE LTDA" },
  "substituicao": { "chaveSubstituida": "<50 digitos da nota antiga>", "motivo": "05" }
}' ${BASE}/api/nfse/emitir`,
          },
          {
            metodo: 'GET', path: '/api/nfse/{chave}/xml',
            descricao: 'Baixar o XML da NFS-e autorizada.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/<50 digitos>/xml -o nfse.xml`,
          },
          {
            metodo: 'GET', path: '/api/nfse/{chave}/danfse',
            descricao: 'Baixar o DANFSE em PDF.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/<50 digitos>/danfse -o danfse.pdf`,
          },
          {
            metodo: 'POST', path: '/api/nfse/distribuicao',
            descricao: 'Baixar as NFS-e da empresa do Ambiente Nacional (ADN) — as que ela emitiu pelo sistema '
              + 'da prefeitura e as que recebeu de fornecedores, com o XML completo e autorizado. '
              + 'NAO depende de credenciamento no Emissor Nacional: e o caminho que funciona quando o municipio '
              + 'usa emissor proprio, que e a maioria dos casos.',
            campos: [
              { nome: 'lotes', tipo: 'number', obrigatorio: false, padrao: '5', descricao: 'Quantos lotes buscar por chamada (max 20). Cada lote traz ate 50 notas' },
              { nome: 'desdeInicio', tipo: 'boolean', obrigatorio: false, padrao: 'false', descricao: 'true recomeca do NSU 0 e recarrega tudo; false continua de onde parou' },
            ],
            response_sucesso: { sucesso: true, lotes: 2, documentosLidos: 100, novas: 100, ultimoNsu: 100, limiteAtingido: false },
            observacao: 'A leitura e incremental por NSU e o ponteiro fica guardado por empresa. O ADN limita a '
              + 'frequencia e responde 429; quando isso acontece o que veio ja foi guardado e limiteAtingido vem true — '
              + 'basta chamar de novo em alguns instantes.',
            curl_exemplo: `curl -s -X POST -H "x-api-key: SUA_CHAVE" -H "Content-Type: application/json" -d '{"lotes":5}' ${BASE}/api/nfse/distribuicao`,
          },
          {
            metodo: 'GET', path: '/api/nfse/distribuicao?limit=100',
            descricao: 'Listar as NFS-e ja capturadas do Ambiente Nacional.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/nfse/distribuicao?limit=100"`,
          },
          {
            metodo: 'GET', path: '/api/nfse/distribuicao/{chave}/xml',
            descricao: 'Baixar o XML de uma nota capturada.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfse/distribuicao/<50 digitos>/xml -o nfse.xml`,
          },
          {
            metodo: 'POST', path: '/api/nfse/enviar-email',
            descricao: 'Enviar DANFSE (PDF) + XML da NFS-e por email. Requer SMTP configurado.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (50 digitos)', obrigatorio: true },
              { nome: 'destinatarioEmail', tipo: 'string', obrigatorio: true },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{ "chaveAcesso": "<50 digitos>", "destinatarioEmail": "cliente@email.com" }' \\
  ${BASE}/api/nfse/enviar-email`,
          },
          {
            metodo: 'GET', path: '/api/nfse/historico?limit=50',
            descricao: 'Listar as notas de servico emitidas pela empresa.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/nfse/historico?limit=50"`,
          },
          {
            metodo: 'GET', path: '/api/nfse/proximo-numero?serie=1&ambiente=2',
            descricao: 'Proximo numero livre da DPS. A sequencia e por serie E por ambiente: testar em producao restrita nao consome numero de producao.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/nfse/proximo-numero?serie=1&ambiente=2"`,
          },
          {
            metodo: 'GET/POST/DELETE', path: '/api/nfse/servicos',
            descricao: 'Catalogo de servicos da empresa. Cadastrado uma vez, a emissao so precisa do valor.',
            campos: [
              { nome: 'codigo', tipo: 'string', obrigatorio: true, descricao: 'Codigo interno, usado depois em servicoCodigo' },
              { nome: 'descricao', tipo: 'string', obrigatorio: true },
              { nome: 'codigoTributacaoNacional', tipo: 'string (6 digitos)', obrigatorio: true },
              { nome: 'valorPadrao', tipo: 'string', obrigatorio: false },
              { nome: 'aliquotaIss', tipo: 'string', obrigatorio: false },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{ "codigo": "SERV001", "descricao": "Desenvolvimento de sistemas", "codigoTributacaoNacional": "010101", "aliquotaIss": "2.90" }' \\
  ${BASE}/api/nfse/servicos`,
          },
        ],
        erros_comuns: [
          { codigo: 'E0008', significado: 'Data de emissao posterior ao processamento. A API ja aplica a margem necessaria.' },
          { codigo: 'E0039', significado: 'Municipio nao parametrizado para o Emissor Nacional — depende de credenciamento na prefeitura.' },
          { codigo: 'E0084', significado: 'CNPJ sem estabelecimento no municipio emissor, conforme cadastros CNPJ e CNC NFS-e.' },
          { codigo: 'E0310', significado: 'Codigo de tributacao nacional inexistente. Confira o desdobro: comeca em 01, nao em 00.' },
          { codigo: 'E0312', significado: 'Codigo existe, mas o municipio nao o administra.' },
          { codigo: 'E0370', significado: 'Faltou o grupo de obra num servico de construcao civil.' },
          { codigo: 'E0372', significado: 'Grupo de obra enviado num servico que nao e de obra.' },
          { codigo: 'E0042', significado: 'Chave da NFS-e a ser substituida invalida ou inexistente.' },
          { codigo: 'E1861', significado: 'Substituicao tentada como evento. Nao existe esse caminho: declare em substituicao.chaveSubstituida ao emitir a nota nova.' },
          { codigo: 'E0330', significado: 'Exportacao de servico sem o grupo de comercio exterior. Informe servico.comercioExterior.' },
          { codigo: 'E0541', significado: 'Codigo do beneficio municipal inexistente. O numero e gerado pelo Sistema Nacional; consulte no ADN em /parametrizacao/{municipio}/{numero}/{competencia}/beneficio.' },
          { codigo: 'E0592', significado: 'Imunidade sem o tipo. Informe tipoImunidade de "0" a "5".' },
          { codigo: 'E0237', significado: 'Endereco do tomador ausente com ISSQN retido. Se voce nao pediu retencao, confira o issRetido: "1" e NAO retido, "2" e retido pelo tomador.' },
          { codigo: 'E1235', significado: 'Falha de schema. Nos valores, quase sempre e decimal com uma casa so, tres casas, ou zero a esquerda — a API normaliza isso antes de enviar.' },
        ],
      },
      {
        nome: '8. Parametros do DANFE (logo e texto fixo)',
        resumo: 'Duas coisas saem impressas no DANFE e NAO vem no XML da nota: a '
          + 'logomarca do emitente e o texto fixo que a empresa repete em toda nota. '
          + 'Sao guardadas por CNPJ e aplicadas em TODA geracao de DANFE — nao ha '
          + 'parametro para passar na emissao.',
        endpoints: [
          {
            metodo: 'GET', path: '/api/danfe/marca',
            descricao: 'Ler a logo e o texto fixo do emitente. Com API Key, o CNPJ vem da chave.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/danfe/marca`,
            response_sucesso: {
              configurada: true, posicao: 'C', logoBase64: '/9j/4AAQSkZJRg...',
              textoPadrao: 'Pagamento via PIX CNPJ 12.345.678/0001-90',
              atualizadaEm: '2026-08-28T09:12:00.000Z',
            },
          },
          {
            metodo: 'POST', path: '/api/danfe/marca',
            descricao: 'Gravar logo, posicao e/ou texto fixo. Campo ausente NAO apaga o que ja '
              + 'estava — logo e texto sao salvos em telas separadas, e um nao pode derrubar o outro.',
            campos: [
              {
                nome: 'logoBase64', tipo: 'string (base64)', obrigatorio: false,
                descricao: 'A imagem SEM o prefixo `data:` (o prefixo tambem e aceito e removido). '
                  + 'ENVIE JPG: o servico que desenha o DANFE roda num PHP sem a extensao `gd`, '
                  + 'e sem ela a biblioteca falha em qualquer PNG, com ou sem transparencia. '
                  + 'String vazia REMOVE a logo. Limite de 400 KB.',
              },
              {
                nome: 'posicao', tipo: "'L' | 'C' | 'R'", obrigatorio: false,
                descricao: 'Onde a logo fica no quadro do emitente: esquerda, centro ou direita. '
                  + 'Qualquer outro valor vira `L`. Logo quadrada costuma ficar melhor em `C`, '
                  + 'porque em `L`/`R` ela come metade da largura e aperta a razao social.',
              },
              {
                nome: 'textoPadrao', tipo: 'string', obrigatorio: false,
                descricao: 'Sai em "Informacoes complementares", somado ao texto do pedido. '
                  + 'Limite de 2000 caracteres: o campo `infCpl` do leiaute 4.00 vai ate 5000 e '
                  + 'e dividido com o texto da emissao e o demonstrativo de IBS/CBS. '
                  + 'String vazia REMOVE o texto.',
              },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
  "posicao": "C",
  "textoPadrao": "Pagamento via PIX CNPJ 12.345.678/0001-90"
}' ${BASE}/api/danfe/marca`,
            response_sucesso: { sucesso: true, posicao: 'C' },
            response_erro: {
              erro: 'PNG nao e desenhado no DANFE. Envie JPG.',
              comoResolver: 'Salve a logo como JPG sobre fundo branco — o DANFE e impresso em '
                + 'papel branco, entao a transparencia nao mudaria o resultado.',
            },
          },
          {
            metodo: 'DELETE', path: '/api/danfe/marca',
            descricao: 'Apagar logo e texto fixo do emitente de uma vez.',
            curl_exemplo: `curl -s -X DELETE -H "x-api-key: SUA_CHAVE" ${BASE}/api/danfe/marca`,
            response_sucesso: { sucesso: true },
          },
          {
            metodo: 'GET', path: '/api/nota/{chave}/danfe',
            descricao: 'Baixar o DANFE em PDF, ja com a logo e o texto fixo aplicados.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nota/CHAVE_44_DIGITOS/danfe -o danfe.pdf`,
          },
        ],
        avisos: [
          'Se a logo falhar por qualquer motivo, o DANFE sai SEM ela — documento fiscal sem '
          + 'enfeite serve; documento que nao sai, nao.',
          'O texto fixo entra no XML na emissao, entao ele vale para a nota inteira: aparece no '
          + 'DANFE e tambem em qualquer visualizador que leia o XML.',
        ],
      },
      {
        nome: '9. Utilitarios e contrato da API',
        endpoints: [
          {
            metodo: 'GET', path: '/api/nfe/distribuicao',
            descricao: 'NF-e RECEBIDAS pela empresa (DF-e). E por aqui que o ERP descobre a nota '
              + 'que um fornecedor emitiu contra o CNPJ dela — a SEFAZ nao avisa, e preciso '
              + 'perguntar. `/{chave}/xml` baixa o XML de uma delas.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/nfe/distribuicao`,
            response_sucesso: { sucesso: true, ultimoNSU: '000000000001284', documentos: [{ chave: '3126...', emitente: 'FORNECEDOR LTDA', valor: '1250.00' }] },
          },
          {
            metodo: 'POST', path: '/api/classificar',
            descricao: 'Sugere NCM, CFOP e tributacao a partir da descricao do produto. Serve '
              + 'para o ERP nao obrigar quem cadastra a saber a tabela de cor — a sugestao vem '
              + 'para conferencia, e nao aplicada sozinha.',
            campos: [
              { nome: 'descricao', tipo: 'string', obrigatorio: true, descricao: 'A descricao do produto, como o vendedor a escreveria.' },
            ],
            curl_exemplo: `curl -s -X POST -H "x-api-key: SUA_CHAVE" -H "Content-Type: application/json" \\
  -d '{"descricao":"molho de pimenta artesanal 150ml"}' ${BASE}/api/classificar`,
            response_sucesso: { ncm: '21039021', cfop: '5102', confianca: 'alta' },
          },
          {
            metodo: 'GET', path: '/api/billing/planos',
            descricao: 'Os planos disponiveis e o que cada um cobre — quais documentos e qual '
              + 'teto mensal.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/billing/planos`,
          },
          {
            metodo: 'GET', path: '/api/openapi.json',
            descricao: 'O contrato da API em OpenAPI 3. Importe no Insomnia, no Swagger UI ou no '
              + 'gerador de cliente da sua linguagem — em vez de escrever as chamadas a mao.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/openapi.json`,
          },
          {
            metodo: 'GET', path: '/api/postman.json',
            descricao: 'A mesma coisa como colecao do Postman, ja com as variaveis de ambiente.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/postman.json -o ponte.postman.json`,
          },
          {
            metodo: 'GET', path: '/api/billing/uso',
            descricao: 'Quanto da cota do mes ja foi usada. Vale consultar ANTES de um lote: '
              + 'estourar o limite no meio da rotina para a emissao com o cliente esperando.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" ${BASE}/api/billing/uso`,
            response_sucesso: { usado: 143, limite: 1000, restante: 857, mes: '2026-08' },
          },
          {
            metodo: 'GET', path: '/api/regras-fiscais?uf=MG',
            descricao: 'As regras fiscais cadastradas (CFOP, CST/CSOSN por NCM e destino). Sem '
              + '`?uf`, usa a UF da empresa — fixar uma UF que nao e a dela devolve lista vazia '
              + 'sem dizer por que.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/regras-fiscais?uf=MG"`,
          },
          {
            metodo: 'GET', path: '/api/produtos/sugestoes?q=TERMO',
            descricao: 'Autocompletar produto pelo que ja foi cadastrado — para o ERP oferecer '
              + 'o item sem obrigar a digitar NCM e CFOP de novo.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_CHAVE" "${BASE}/api/produtos/sugestoes?q=pimenta"`,
          },
          {
            metodo: 'POST', path: '/api/importar-xlsx',
            descricao: 'Importar catalogo de produtos em lote (XLSX ou CSV pelo `/api/importar-csv`). '
              + 'Responde quantos entraram e quantos foram recusados, com o motivo de cada um.',
            curl_exemplo: `curl -s -X POST -H "x-api-key: SUA_CHAVE" -F "arquivo=@produtos.xlsx" ${BASE}/api/importar-xlsx`,
          },
          {
            metodo: 'POST', path: '/api/enviar-email',
            descricao: 'Enviar DANFE (PDF) + XML por email. Requer SMTP configurado.',
            campos: [
              { nome: 'chaveAcesso', tipo: 'string (44 digitos)', obrigatorio: true },
              { nome: 'destinatarioEmail', tipo: 'string', obrigatorio: true, descricao: 'Email do destinatario' },
            ],
            curl_exemplo: `curl -s -X POST \\
  -H "x-api-key: SUA_SENHA" \\
  -H "x-empresa-cnpj: 34051105000191" \\
  -H "Content-Type: application/json" \\
  -d '{
  "chaveAcesso": "35260734051105000191558000000000021621440983",
  "destinatarioEmail": "cliente@email.com"
}' ${BASE}/api/enviar-email`,
            response_sucesso: { sucesso: true, mensagem: 'Email enviado com sucesso' },
          },
          {
            metodo: 'GET', path: '/api/ncm/buscar?q=TERMO',
            descricao: 'Buscar NCM por descricao do produto.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" "${BASE}/api/ncm/buscar?q=camiseta"`,
            response_sucesso: { disponivel: true, itens: [{ codigo: '61012000', descricao: 'De algodao' }, { codigo: '61013000', descricao: 'De fibras sinteticas' }] },
          },
          {
            metodo: 'GET', path: '/api/tipos-operacao',
            descricao: 'Listar tipos de operacao fiscal disponiveis.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" ${BASE}/api/tipos-operacao`,
            response_sucesso: [{ valor: 'venda_revenda', label: 'Venda / Revenda (comercio)' }, { valor: 'venda_producao', label: 'Venda producao propria (industria)' }],
          },
          {
            metodo: 'GET', path: '/api/cfop?tipo=venda&destino=interna',
            descricao: 'Obter CFOP automatico por tipo de operacao e destino.',
            curl_exemplo: `curl -s -H "x-api-key: SUA_SENHA" "${BASE}/api/cfop?tipo=venda_revenda&destino=interna"`,
            response_sucesso: { cfop: '5102', operacao: 'venda_revenda', entrada: false, interestadual: false },
          },
          {
            metodo: 'GET', path: '/api/ping',
            descricao: 'Health check. NAO requer autenticacao.',
            curl_exemplo: `curl -s ${BASE}/api/ping`,
            response_sucesso: { ok: true, configurado: true, autenticacao: true },
          },
          {
            metodo: 'GET', path: '/api/importar-modelo',
            descricao: 'Baixar modelo XLSX para importacao de produtos. NAO requer autenticacao.',
            curl_exemplo: `curl -s ${BASE}/api/importar-modelo -o modelo_importacao.xlsx`,
          },
        ],
      },
    ],
    codigos_status: {
      '100': 'Autorizado o uso da NF-e',
      '101': 'Cancelamento de NF-e homologado',
      '102': 'Inutilizacao de numero homologado',
      '103': 'Lote recebido com sucesso',
      '104': 'Lote processado',
      '105': 'Lote em processamento (aguardar e reconsultar)',
      '106': 'Lote nao localizado',
      '107': 'Servico em Operacao',
      '108': 'Servico paralisado momentaneamente',
      '109': 'Servico paralisado sem previsao',
      '110': 'Uso Denegado',
      '135': 'Evento registrado e vinculado a NF-e',
      '136': 'Evento registrado mas nao vinculado a NF-e',
      '155': 'Cancelamento fora de prazo aceito (homologado)',
      '204': 'Duplicidade de NF-e (chave de acesso ja existe)',
      '205': 'NF-e esta denegada na base da SEFAZ',
      '206': 'NF-e ja esta inutilizada na base da SEFAZ',
      '217': 'NF-e nao consta na base de dados da SEFAZ',
      '218': 'NF-e ja esta cancelada na base da SEFAZ',
      '225': 'Falha no Schema XML do lote de NFe (XML invalido)',
      '249': 'UF da Chave de Acesso diverge da UF autorizadora',
      '539': 'Duplicidade de NF-e com diferenca na chave de acesso',
      '573': 'Duplicidade de evento (ja registrado anteriormente)',
    },
    formas_pagamento: {
      '01': 'Dinheiro',
      '02': 'Cheque',
      '03': 'Cartao de Credito',
      '04': 'Cartao de Debito',
      '05': 'Credito Loja',
      '10': 'Vale Alimentacao',
      '11': 'Vale Refeicao',
      '12': 'Vale Presente',
      '13': 'Vale Combustivel',
      '14': 'Duplicata Mercantil',
      '15': 'Boleto Bancario',
      '16': 'Deposito Bancario',
      '17': 'PIX',
      '18': 'Transferencia bancaria, Carteira Digital',
      '90': 'Sem Pagamento',
      '99': 'Outros',
    },
    erros_comuns: [
      { erro: 'Rejeicao 225 — Falha no Schema XML', causa: 'Campo "nomeMunicipio" no endereco do destinatario esta faltando ou com nome errado. Use "nomeMunicipio", NAO "municipio".', solucao: 'Verificar se todos os campos do endereco estao com os nomes corretos: logradouro, numero, bairro, codigoMunicipio, nomeMunicipio, uf, cep' },
      { erro: 'Rejeicao 249 — UF diverge', causa: 'A empresa emitente resolvida nao e a que voce esperava.', solucao: 'Usando API Key nao ha o que ajustar: a chave ja fixa o CNPJ, e o header x-empresa-cnpj e IGNORADO. Confira em GET /api/me qual empresa a sua chave emite.' },
      { erro: '401 Nao autorizado', causa: 'Header x-api-key ausente, com chave invalida ou revogada.', solucao: 'Enviar header x-api-key com a SUA API Key (nfe_live_* ou nfe_test_*). A senha mestra e do administrador da plataforma e nao deve ser usada por integracao — ela da acesso a todas as empresas.' },
      { erro: 'CSC nao configurado', causa: 'Tentou emitir NFC-e sem CSC cadastrado.', solucao: 'Cadastrar CSC via POST /api/empresas/:cnpj/csc com cscId e cscToken' },
      { erro: 'Campos obrigatorios', causa: 'Body JSON incompleto.', solucao: 'Verificar campos obrigatorios na documentacao de cada endpoint' },
      { erro: 'Cannot read properties of undefined', causa: 'Formato de itens incorreto — faltam campos obrigatorios como icms ou origem.', solucao: 'Usar formato FLAT (com campos soltos como origem, cstIcms) — a API normaliza automaticamente' },
    ],
    notas_importantes: [
      'Todos os testes desta documentacao foram executados e validados contra a SEFAZ real em 24/07/2026',
      'A API aceita formato FLAT (campos soltos) e formato ANINHADO (objetos icms, pis, cofins). O formato FLAT e recomendado para ERPs',
      'Em HOMOLOGACAO, a SEFAZ substitui a razao social do destinatario por "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"',
      'O certificado digital A1 (.pfx) e criptografado com AES-256-GCM no banco. A chave mestra fica na variavel de ambiente WEBAPP_MASTER_KEY',
      'Serie 890+ e reservada pela SEFAZ para Nota Fiscal Avulsa. Use series entre 1 e 889',
      'A API retorna o XML completo (nfeProc) com assinatura digital e protocolo de autorizacao — este e o arquivo fiscal oficial',
      'O DANFE PDF e gerado automaticamente via servico sped-da (PHP) e retornado em base64 no campo danfePdf',
    ],
  });
});

// ---------------------------------------------------------------------------
// API CLIENTS — gestão de clientes comerciais da API
// ---------------------------------------------------------------------------

// Dashboard geral
app.get('/api/admin/dashboard', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const clientStore = await getApiClientStore();
    const dash = await clientStore.dashboard();
    let reqHoje = 0, errosHoje = 0;
    try {
      const logStore = await getRequestLogStore();
      const stats = await logStore.estatisticas('__global__');
      reqHoje = stats.hoje.total;
      errosHoje = stats.hoje.erros;
    } catch { /* log store may not have global */ }
    res.json({ ...dash, requisicoesHoje: reqHoje, errosHoje });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Listar clientes API
app.get('/api/admin/clients', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getApiClientStore();
    const result = await store.listar({
      status: req.query.status as ClientStatus,
      plano: req.query.plano as string,
      modalidade: req.query.modalidade === 'plataforma' ? 'plataforma'
        : req.query.modalidade === 'api' ? 'api' : undefined,
      whiteLabel: req.query.whiteLabel === 'true' ? true : req.query.whiteLabel === 'false' ? false : undefined,
      busca: req.query.busca as string,
      limite: Number(req.query.limite) || 50,
      offset: Number(req.query.offset) || 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Criar/atualizar cliente API
app.post('/api/admin/clients', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { empresaCnpj, razaoSocial } = req.body || {};
  if (!empresaCnpj || !razaoSocial) {
    res.status(400).json({ erro: 'CNPJ e Razao Social sao obrigatorios.' });
    return;
  }
  try {
    const store = await getApiClientStore();
    const client = await store.criar(req.body);
    // Dados fiscais chegam junto do cadastro (quase todos vindos da consulta
    // de CNPJ) — sem eles a chave existe mas nao emite.
    if (req.body.fiscal) await store.salvarFiscal(client.empresaCnpj, req.body.fiscal);
    registrarAudit('admin', 'client.created', 'api_client', {
      empresaCnpj: client.empresaCnpj, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, client });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Obter detalhes do cliente
app.get('/api/admin/clients/:cnpj', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getApiClientStore();
    const client = await store.obter(cnpj);
    if (!client) { res.status(404).json({ erro: 'Cliente nao encontrado.' }); return; }
    const svcStore = await getClientServiceStore();
    const servicos = await svcStore.listar(cnpj);
    const limites = await store.obterLimites(cnpj);
    // A comparacao usa os servicos ATIVOS, nao a lista inteira: e a lista ativa
    // que vira aba na plataforma do cliente.
    const ativos = await svcStore.obterAtivos(cnpj);
    const divergenciaPlano = divergenciaDePlano(client.plano, ativos);
    res.json({ ...client, servicos, limites, ...(divergenciaPlano ? { divergenciaPlano } : {}) });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Atualizar cliente
app.patch('/api/admin/clients/:cnpj', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getApiClientStore();
    await store.atualizar(cnpj, req.body);
    registrarAudit('admin', 'client.updated', 'api_client', {
      empresaCnpj: cnpj, after: req.body, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Alterar status do cliente
app.patch('/api/admin/clients/:cnpj/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const { status } = req.body;
    if (!['draft', 'sandbox', 'active', 'past_due', 'suspended', 'cancelled'].includes(status)) {
      res.status(400).json({ erro: 'Status invalido.' }); return;
    }
    const store = await getApiClientStore();
    const before = await store.obter(cnpj);
    await store.atualizarStatus(cnpj, status);
    registrarAudit('admin', 'client.status_changed', 'api_client', {
      empresaCnpj: cnpj, before: { status: before?.status }, after: { status }, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, status });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Atualizar limites do cliente
app.patch('/api/admin/clients/:cnpj/limits', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getApiClientStore();
    await store.atualizarLimites(cnpj, req.body);
    registrarAudit('admin', 'client.limits_changed', 'api_client', {
      empresaCnpj: cnpj, after: req.body, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Excluir cliente API ---
app.delete('/api/admin/clients/:cnpj', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getApiClientStore();
    const client = await store.obter(cnpj);
    if (!client) { res.status(404).json({ erro: 'Cliente nao encontrado.' }); return; }
    await store.excluir(cnpj);
    registrarAudit('admin', 'client.deleted', 'api_client', {
      empresaCnpj: cnpj, before: { razaoSocial: client.razaoSocial, plano: client.plano },
      requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Serviços contratados ---
app.get('/api/admin/clients/:cnpj/services', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getClientServiceStore();
    const servicos = await store.listar(req.params.cnpj);
    res.json({ servicos });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/clients/:cnpj/services', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const { service, configuration } = req.body;
    if (!['nfe', 'nfce', 'nfse', 'cte', 'mdfe'].includes(service)) {
      res.status(400).json({ erro: 'Servico invalido.' }); return;
    }
    // NFC-e exige CSC/token do estado, e o cadastro de cliente de API ainda nao
    // tem onde guardar isso. Vender agora seria entregar um servico que so
    // falha na primeira emissao.
    if (service === 'nfce') {
      res.status(400).json({
        erro: 'NFC-e ainda nao disponivel para cliente de API: falta o cadastro do CSC (token do estado).',
      });
      return;
    }
    const store = await getClientServiceStore();
    await store.ativar(cnpj, service, configuration);
    registrarAudit('admin', 'service.activated', 'client_service', {
      empresaCnpj: cnpj, after: { service }, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete('/api/admin/clients/:cnpj/services/:service', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getClientServiceStore();
    await store.desativar(cnpj, req.params.service as FiscalService);
    registrarAudit('admin', 'service.deactivated', 'client_service', {
      empresaCnpj: cnpj, after: { service: req.params.service }, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Webhooks ---
/**
 * POST /api/admin/webhooks/reprocessar — reenvia as entregas de webhook vencidas.
 *
 * Em serverless nao ha processo de fundo: `setInterval` morre com a invocacao.
 * Por isso o gatilho e uma rota, para ser chamada por cron (Vercel Cron, um
 * monitor externo) ou a mao quando um cliente avisa que ficou fora do ar.
 *
 * Sem isto, `next_retry_at` era gravado e nunca lido: existia a aparencia do
 * retry e nenhum reenvio.
 */
app.post('/api/admin/webhooks/reprocessar', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getWebhookStore();
    const limite = Math.min(500, Math.max(1, Number(req.body?.limite) || 50));
    const r = await store.reprocessarPendentes(limite);
    registrarAudit('admin', 'webhook.reprocessado', 'webhook', {
      after: r, requestId: (req as any).requestId,
    });
    // `r` traz `sucesso` (quantas deram certo). Espalhar depois do literal
    // sobrescreveria o booleano por um numero — e o cliente leria `sucesso: 0`
    // como falha quando nao havia nada pendente.
    res.json({
      ok: true,
      reenviadas: r.reenviadas,
      sucesso: r.sucesso,
      desistidas: r.desistidas,
      observacao: 'Entregas que falharam com 4xx (fora 408 e 429) nao sao reenviadas: o endpoint recusou o formato, e repetir nao conserta.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/clients/:cnpj/webhooks', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getWebhookStore();
    const endpoints = await store.listar(req.params.cnpj);
    const stats = await store.estatisticas(req.params.cnpj);
    res.json({ endpoints, stats });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/clients/:cnpj/webhooks', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const ep = await (await getWebhookStore()).criar({
      empresaCnpj: cnpj, url: req.body.url, events: req.body.events, ambiente: req.body.ambiente,
    });
    registrarAudit('admin', 'webhook.created', 'webhook', {
      empresaCnpj: cnpj, entityId: String(ep.id), requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, webhook: ep });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.patch('/api/admin/webhooks/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getWebhookStore();
    await store.atualizar(Number(req.params.id), req.body);
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete('/api/admin/clients/:cnpj/webhooks/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getWebhookStore();
    const ok = await store.excluir(Number(req.params.id), req.params.cnpj);
    if (!ok) { res.status(404).json({ erro: 'Webhook nao encontrado.' }); return; }
    registrarAudit('admin', 'webhook.deleted', 'webhook', {
      empresaCnpj: req.params.cnpj, entityId: req.params.id, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/webhooks/:id/deliveries', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getWebhookStore();
    const deliveries = await store.listarEntregas(Number(req.params.id), Number(req.query.limite) || 20);
    res.json({ deliveries });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Logs de requisição ---
app.get('/api/admin/clients/:cnpj/logs', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getRequestLogStore();
    const result = await store.listar({
      empresaCnpj: req.params.cnpj,
      service: req.query.service as string,
      errorOnly: req.query.errorOnly === 'true',
      desde: req.query.desde as string,
      ate: req.query.ate as string,
      limite: Number(req.query.limite) || 50,
      offset: Number(req.query.offset) || 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/clients/:cnpj/stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const logStore = await getRequestLogStore();
    const stats = await logStore.estatisticas(req.params.cnpj);
    const webhookStore = await getWebhookStore();
    const webhookStats = await webhookStore.estatisticas(req.params.cnpj);
    res.json({ api: stats, webhooks: webhookStats });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Audit log ---
app.get('/api/admin/audit', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getAuditStore();
    const result = await store.listar({
      empresaCnpj: req.query.cnpj as string,
      action: req.query.action as string,
      entityType: req.query.entityType as string,
      desde: req.query.desde as string,
      ate: req.query.ate as string,
      limite: Number(req.query.limite) || 50,
      offset: Number(req.query.offset) || 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/** O catálogo de planos, para a tela montar seletor e selo sem duplicar regra. */
app.get('/api/admin/planos', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ planos: CATALOGO_PLANOS });
});

/**
 * Painel de um cliente, para quem dá suporte.
 *
 * Junta o que hoje está espalhado em quatro lugares: quanto ele emitiu (notas),
 * o que consumiu do plano (billing), quando tocou a API pela última vez
 * (cadastro) e o que andou fazendo (auditoria). Sem isso, atender um cliente que
 * liga dizendo "não estou conseguindo emitir" começa por adivinhação.
 *
 * Tudo em uma chamada de propósito: quem está no telefone com o cliente não vai
 * abrir quatro telas.
 */
app.get('/api/admin/clients/:cnpj/painel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    const clientStore = await getApiClientStore();
    const cliente = await clientStore.obter(cnpj);
    if (!cliente) { res.status(404).json({ erro: 'Cliente API nao encontrado.' }); return; }

    const limite = Number(req.query['limite']) || 20;

    // Cada peça falha por conta própria: um billing fora do ar não pode esconder
    // as notas, que é justamente o que o suporte precisa ver.
    const [resumo, ultimas, uso, eventos, servicos, chaves] = await Promise.all([
      getStorage().then(s => s.resumoEmpresa(cnpj)).catch(() => null),
      getStorage().then(s => s.listNotas(cnpj, limite)).catch(() => []),
      getBillingStore().then(b => b.obterOuCriar(cnpj)).catch(() => null),
      getAuditStore().then(a => a.listar({ empresaCnpj: cnpj, limite })).catch(() => null),
      getClientServiceStore().then(s => s.obterAtivos(cnpj)).catch(() => []),
      getApiKeyStore().then(k => k.listar(cnpj)).catch(() => []),
    ]);

    res.json({
      cliente: {
        cnpj,
        razaoSocial: cliente.razaoSocial,
        status: cliente.status,
        plano: cliente.plano,
        codigoInterno: cliente.codigoInterno,
        responsavel: cliente.responsavel,
        emailTecnico: cliente.emailTecnico,
        criadoEm: cliente.criadoEm,
        ultimoUsoApi: cliente.ultimoUsoApi,
      },
      // O plano resolvido: a tela nao precisa saber que `business` virou MAX.
      planoDetalhe: planoDe(cliente.plano),
      servicos,
      emissoes: resumo,
      consumoDoPlano: uso
        ? { plano: uso.plano, notasMes: uso.notasMes, referencia: uso.mesReferencia }
        : null,
      credenciais: (chaves || []).map((k: any) => ({
        prefixo: k.prefixo, nome: k.nome, ambiente: k.ambientePermitido,
        escopo: k.escopo, ativa: k.ativa, ultimoUso: k.ultimoUso,
      })),
      ultimasNotas: ultimas,
      auditoria: eventos,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * O histórico de notas de UM cliente, para o admin.
 *
 * O `/api/historico` do próprio cliente é travado no tenant dele — e é assim que
 * tem de ser. Para o suporte olhar as notas de quem pediu ajuda, precisa de um
 * caminho explícito de admin, que fica registrado na auditoria.
 */
app.get('/api/admin/clients/:cnpj/notas', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    const storage = await getStorage();
    const todas = await storage.listNotas(cnpj, Number(req.query['limite']) || 100);
    const amb = req.query['ambiente'];
    res.json(
      amb === '1' || amb === '2'
        ? todas.filter(n => String(n.ambiente) === amb)
        : todas,
    );
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Certificado digital do cliente API ---
app.post('/api/admin/clients/:cnpj/certificado', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const { pfxBase64, pfxPassword } = req.body;
    if (!pfxBase64 || !pfxPassword) {
      res.status(400).json({ erro: 'Certificado (.pfx) e senha sao obrigatorios.' }); return;
    }
    const { encryptSecret } = await import('./crypto.js');
    const pfxBuffer = Buffer.from(pfxBase64, 'base64');
    let vencimento: Date | undefined;
    try {
      const forge = require('node-forge');
      const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfxBuffer.toString('binary')), pfxPassword);
      const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certs = bags[forge.pki.oids.certBag] || [];
      if (certs.length && certs[0].cert) {
        vencimento = new Date(certs[0].cert.validity.notAfter);
      }
    } catch { /* se não conseguir ler a validade, segue sem */ }
    const pfxEncrypted = encryptSecret(pfxBuffer);
    const pfxPwdEncrypted = encryptSecret(pfxPassword);
    const store = await getApiClientStore();
    await store.salvarCertificado(cnpj, pfxEncrypted, pfxPwdEncrypted, vencimento);
    registrarAudit('admin', 'certificate.uploaded', 'api_client', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, vencimento: vencimento?.toISOString() });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/clients/:cnpj/certificado', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getApiClientStore();
    const cert = await store.obterCertificado(req.params.cnpj);
    if (!cert) { res.json({ temCertificado: false }); return; }
    res.json({
      temCertificado: true,
      vencimento: cert.vencimento,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- White-label ---
/**
 * GET  /api/admin/clients/:cnpj/senha-painel — mostra a senha do painel do kit.
 * POST /api/admin/clients/:cnpj/senha-painel — sorteia outra.
 *
 * A senha e sorteada e guardada cifrada; sem estas rotas ela so aparecia no
 * instante da geracao do kit e depois sumia — inclusive para quem administra a
 * plataforma. Suporte por telefone com "nao sei qual e a senha do seu painel"
 * nao e resposta.
 *
 * Trocar aqui NAO troca no site ja publicado do cliente: la a senha vive na
 * variavel APP_ACCESS_PASSWORD do deploy dele. A resposta diz isso.
 */
app.get('/api/admin/clients/:cnpj/senha-painel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const acesso = await obterCredenciaisPlataforma(cnpj);
    registrarAudit('admin', 'plataforma.senha.consultada', 'white_label', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });
    res.json({
      usuario: acesso.usuario,
      senha: acesso.senha,
      primeiroAcesso: acesso.senha === SENHA_PRIMEIRO_ACESSO,
      aviso: acesso.senha === SENHA_PRIMEIRO_ACESSO
        ? 'Senha de PRIMEIRO ACESSO, igual para todo cliente novo. O CNPJ e publico: enquanto ela nao for trocada, quem souber o CNPJ entra no painel deste cliente. Use "Gerar outra" e atualize APP_ACCESS_PASSWORD no deploy dele.'
        : 'Senha ja trocada para este cliente. Ela vive no APP_ACCESS_PASSWORD do deploy dele — se o site nao aceitar, e porque a variavel de la nao foi atualizada.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/clients/:cnpj/senha-painel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const { encryptSecret } = require('./crypto');
    const pool = await getConfigStore();
    const senha = sortearSenha(18);
    await pool.query(
      `INSERT INTO webapp_config (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [`plataforma_senha:${cnpj}`, encryptSecret(senha)],
    );
    registrarAudit('admin', 'plataforma.senha.rotacionada', 'white_label', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });
    res.json({
      sucesso: true,
      usuario: cnpj,
      senha,
      aviso: 'Senha trocada aqui. Para valer no site do cliente, atualize APP_ACCESS_PASSWORD no deploy dele — senha nova aqui e site antigo la continuam independentes.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/clients/:cnpj/whitelabel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getWhiteLabelStore();
    const config = await store.obterOuPadrao(req.params.cnpj);
    const tokens = store.gerarDesignTokens(config);
    res.json({ config, tokens });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/clients/:cnpj/whitelabel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getWhiteLabelStore();
    await store.salvar({ ...req.body, empresaCnpj: cnpj });
    // Liga a marca propria — e SO isso. Esta linha ja significou tambem "este
    // cliente tem plataforma", porque `whiteLabelAtiva` fazia os dois papeis:
    // um cliente de API que pedia a logo dele no DANFE era reclassificado
    // aqui, sozinho, e passava a aparecer nas listas de plataforma. A
    // modalidade agora e coluna propria e ninguem a muda pelas costas.
    const clientStore = await getApiClientStore();
    await clientStore.atualizar(cnpj, { whiteLabelAtiva: true });
    registrarAudit('admin', 'whitelabel.saved', 'white_label', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * Consulta pública de CNPJ (BrasilAPI) — preenche o cadastro sozinho.
 * Fica no servidor porque o navegador esbarra em CORS chamando direto.
 */
const CNAE_SEGMENTOS: [number, number, string][] = [
  [1, 3, 'Agronegocio'], [5, 9, 'Extrativa'], [10, 12, 'Alimentos'],
  [13, 33, 'Industria'], [35, 39, 'Utilidades'], [41, 43, 'Construcao'],
  [45, 45, 'Veiculos'], [46, 46, 'Atacado'], [47, 47, 'Varejo'],
  [49, 53, 'Transporte'], [55, 56, 'Alimentos'], [58, 63, 'Tecnologia'],
  [64, 66, 'Financeiro'], [68, 68, 'Imobiliario'], [69, 75, 'Servicos'],
  [77, 82, 'Servicos'], [85, 85, 'Educacao'], [86, 88, 'Saude'],
];

/**
 * Credenciais de acesso das plataformas geradas.
 *
 * Por decisão do operador, o mesmo par vale para TODOS os clientes: ele abre
 * qualquer plataforma recém-gerada sem procurar senha, revisa, e só depois
 * troca por dentro do sistema do cliente.
 *
 * O valor é sorteado uma vez e guardado criptografado — não fica escrito no
 * repositório. E segue para o construtor pelo cofre de secrets, nunca dentro
 * do prompt ou do manifest: assim uma senha compartilhada entre clientes ao
 * menos não é copiada para o histórico do construtor e para o Git de cada
 * projeto gerado.
 */
const SENHA_ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function sortearSenha(tamanho: number): string {
  const bytes = require('crypto').randomBytes(tamanho) as Buffer;
  let s = '';
  for (let i = 0; i < tamanho; i++) s += SENHA_ALFABETO[bytes[i]! % SENHA_ALFABETO.length];
  return s;
}

/** Senha de primeiro acesso dos templates gerados. Decisão do dono do produto. */
const SENHA_PRIMEIRO_ACESSO = '000000';

/**
 * Credenciais do painel do template gerado: usuário = CNPJ, senha = 000000.
 *
 * É uma decisão de operação, tomada com o risco na mesa: o CNPJ é público —
 * sai na nota, no site, no cartão — então qualquer pessoa que o conheça entra
 * no painel do cliente enquanto a senha não for trocada. O que se ganha é
 * onboarding sem consulta: dá para entregar o acesso por telefone.
 *
 * A senha vive no `APP_ACCESS_PASSWORD` do deploy de CADA cliente, então
 * trocá-la é por cliente e não afeta os outros: use o botão "Gerar outra" no
 * detalhe do cliente (ou `POST /api/admin/clients/:cnpj/senha-painel`) e
 * atualize a variável no deploy dele. Uma vez trocada, esta função devolve a
 * senha nova — o `000000` vale só até a primeira troca.
 *
 * Histórico: antes disto todos os clientes dividiam UMA senha aleatória, o que
 * era pior — não era trocável por cliente e ninguém sabia qual era, nem o
 * administrador.
 */
async function obterCredenciaisPlataforma(cnpj?: string): Promise<{ usuario: string; senha: string }> {
  const limpo = String(cnpj ?? '').replace(/\D/g, '');
  // O login é o CNPJ do próprio cliente: um dado que ele sabe de cor e que
  // identifica a plataforma dele sem ambiguidade.
  const usuario = limpo || process.env['PLATAFORMA_LOGIN_PADRAO'] || 'admin';
  if (!limpo) {
    return { usuario, senha: process.env['PLATAFORMA_SENHA_PADRAO'] || SENHA_PRIMEIRO_ACESSO };
  }

  const { decryptSecret } = require('./crypto');
  const pool = await getConfigStore();
  // Só existe linha quando alguém TROCOU a senha daquele cliente. Sem linha, é
  // porque ainda está no primeiro acesso.
  const r = await pool.query(
    `SELECT valor FROM webapp_config WHERE chave = $1`,
    [`plataforma_senha:${limpo}`],
  );
  if (r.rows.length) {
    try {
      return { usuario, senha: decryptSecret(r.rows[0].valor).toString('utf-8') };
    } catch { /* valor ilegível: cai no primeiro acesso */ }
  }
  return { usuario, senha: SENHA_PRIMEIRO_ACESSO };
}

/**
 * Acerta o primeiro dígito do CFOP conforme o sentido e o destino da operação,
 * preservando os três últimos — que são a natureza escolhida pelo usuário na
 * regra do NCM. 5949 vira 6949 para fora do estado e 1949 numa entrada.
 */
/**
 * Quem pediu prévia quer prévia, escrito como for.
 *
 * Antes só o booleano `true` valia. `simular: "true"` — a forma que sai de
 * qualquer formulário, querystring ou corpo montado à mão — caía no caminho da
 * emissão real: o operador clicava em "ver prévia" e recebia nota fiscal
 * autorizada, sem erro e sem aviso. Na dúvida entre simular e emitir, simular.
 */
export function querSimular(valor: unknown): boolean {
  if (valor === true || valor === 1) return true;
  return ['1', 'true', 'sim', 's', 'yes'].includes(String(valor ?? '').trim().toLowerCase());
}

/**
 * Primeiro dígito do CFOP: sentido da nota cruzado com o destino.
 *
 * `destino` segue o idDest da SEFAZ — '1' dentro do estado, '2' outro estado,
 * '3' exterior.
 */
function digitoCfop(entrada: boolean, destino: string): string {
  const faixa = entrada ? ['1', '2', '3'] : ['5', '6', '7'];
  const i = destino === '3' ? 2 : destino === '2' ? 1 : 0;
  return faixa[i]!;
}

function ajustarSentidoCfop(cfop: string, opts: { entrada: boolean; interestadual: boolean }): string {
  const d = String(cfop || '').replace(/\D/g, '');
  if (d.length !== 4) return d;
  return digitoCfop(opts.entrada, opts.interestadual ? '2' : '1') + d.slice(1);
}

/**
 * CFOP de cadastro: campo de SAIDA nao aceita codigo de entrada.
 *
 * O catalogo de produtos e a tabela de regras guardam o CFOP da VENDA — no caso
 * da regra, o campo se chama `cfop_saida` com todas as letras. Mesmo assim os
 * dois salvavam 1102 (compra para comercializacao) sem reclamar.
 *
 * O estrago e discreto porque a emissao conserta: `corrigirSentidoCfop` troca o
 * primeiro digito antes de montar o XML, e a nota sai certa. So que o cadastro
 * continua errado para sempre, e a tela de produtos mostra o 1102 salvo — que e
 * exatamente a divergencia que aparece quando alguem confere a nota contra o
 * cadastro e encontra dois CFOPs diferentes para o mesmo item.
 *
 * Corrigir aqui em vez de recusar preserva a importacao de catalogo que ja vem
 * errada de outro sistema; devolver o ajuste impede que a correcao seja muda.
 */
export function cfopDeCadastro(cfop: string | undefined): { cfop: string; ajuste?: { de: string; para: string } } {
  const d = String(cfop ?? '').replace(/\D/g, '');
  if (d.length !== 4) return { cfop: d };
  // 1xxx (entrada interna) -> 5xxx, 2xxx (entrada interestadual) -> 6xxx.
  // 3xxx (importacao) vira 7xxx, a exportacao correspondente.
  const paraSaida: Record<string, string> = { '1': '5', '2': '6', '3': '7' };
  const novo = paraSaida[d[0]!];
  if (!novo) return { cfop: d };
  const corrigido = novo + d.slice(1);
  return { cfop: corrigido, ajuste: { de: d, para: corrigido } };
}

/**
 * Acerta o primeiro dígito do CFOP de cada item pelo que a nota realmente é.
 *
 * O CFOP carrega duas coisas: a natureza da operação, nos três últimos dígitos,
 * e o sentido com o destino, no primeiro. A natureza é decisão de quem cadastrou
 * o produto e não se mexe. O primeiro dígito não é escolha — é consequência de a
 * nota ser de entrada ou saída e de o destinatário estar dentro do estado, fora
 * dele ou no exterior. O Emissor sabe as duas coisas antes de montar o XML.
 *
 * Sem isto, um CFOP de saída numa nota de entrada só é descoberto na rejeição
 * 519, depois de a nota ter sido montada, assinada e transmitida — e a prévia
 * dava verde, porque o XSD aceita 5102 numa entrada: quem recusa é a regra de
 * negócio da SEFAZ, não o schema.
 *
 * Trocar só o primeiro dígito preserva a operação: 5102 numa entrada interna
 * vira 1102, que é exatamente a compra correspondente àquela venda.
 */
export function corrigirSentidoCfop(
  itens: any[],
  opts: { entrada: boolean; destino: string },
): { itens: any[]; ajustes: Array<{ item: number; de: string; para: string }> } {
  const primeiro = digitoCfop(opts.entrada, opts.destino);
  const ajustes: Array<{ item: number; de: string; para: string }> = [];

  const corrigidos = (itens || []).map((it, i) => {
    const cfop = String(it?.cfop ?? '').replace(/\D/g, '');
    // CFOP ausente ou malformado não é assunto daqui: quem reclama é a validação
    // de schema, com mensagem própria.
    if (cfop.length !== 4 || cfop[0] === primeiro) return it;
    const novo = primeiro + cfop.slice(1);
    ajustes.push({ item: i + 1, de: cfop, para: novo });
    return { ...it, cfop: novo };
  });

  return { itens: corrigidos, ajustes };
}

/** "Aliança Alimentos" -> "alianca-alimentos" (sem acento, sem espaço). */
function slugify(texto: string): string {
  const semAcento = texto.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  return semAcento.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function segmentoPorCnae(cnae: unknown): string {
  const div = Math.floor(Number(cnae || 0) / 100000);
  if (!div) return 'Servicos';
  const faixa = CNAE_SEGMENTOS.find(([ini, fim]) => div >= ini && div <= fim);
  return faixa ? faixa[2] : 'Servicos';
}

app.get('/api/admin/cnpj/:cnpj', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) { res.status(400).json({ erro: 'CNPJ deve ter 14 digitos.' }); return; }
  try {
    const axios = require('axios');
    const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      timeout: 8000,
      validateStatus: (s: number) => s < 500,
    });
    if (r.status === 404) { res.status(404).json({ erro: 'CNPJ nao encontrado na Receita Federal.' }); return; }
    if (r.status >= 400) { res.status(502).json({ erro: 'Consulta indisponivel no momento.' }); return; }
    const d = r.data || {};
    const ddd = String(d.ddd_telefone_1 || '').replace(/\D/g, '');
    // CRT: 1 Simples, 2 Simples com excesso de sublimite, 3 Regime Normal.
    // O MEI declara como Simples; o operador pode corrigir na tela.
    const crt = d.opcao_pelo_simples || d.opcao_pelo_mei ? '1' : '3';
    res.json({
      cnpj,
      razaoSocial: d.razao_social || '',
      fantasia: d.nome_fantasia || '',
      municipio: d.municipio || '',
      uf: d.uf || '',
      situacao: d.descricao_situacao_cadastral || '',
      ativa: String(d.descricao_situacao_cadastral || '').toUpperCase() === 'ATIVA',
      atividade: d.cnae_fiscal_descricao || '',
      segmento: segmentoPorCnae(d.cnae_fiscal),
      email: d.email || '',
      telefone: ddd || '',
      crt,
      simples: !!d.opcao_pelo_simples,
      // Endereco fiscal — o codigo IBGE do municipio e obrigatorio na NF-e.
      endereco: {
        // A Receita separa o tipo do nome: "ESTRADA" + "LINHA UM". Sem juntar,
        // o emitente sairia na nota como "LINHA UM".
        logradouro: [d.descricao_tipo_de_logradouro, d.logradouro]
          .map((p: unknown) => String(p ?? '').trim())
          .filter(Boolean)
          .join(' '),
        numero: String(d.numero || '') || 'S/N',
        complemento: d.complemento || '',
        bairro: d.bairro || '',
        codMunicipio: String(d.codigo_municipio_ibge || ''),
        nomeMunicipio: d.municipio || '',
        cep: String(d.cep || '').replace(/\D/g, ''),
      },
    });
  } catch (err: any) {
    res.status(502).json({ erro: 'Nao foi possivel consultar o CNPJ: ' + (err.message || 'falha de rede') });
  }
});

// --- Cadastro fiscal do cliente (IE, regime, endereco do emitente) ---
app.get('/api/admin/clients/:cnpj/fiscal', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getApiClientStore();
    const fiscal = await store.obterFiscal(req.params.cnpj.replace(/\D/g, ''));
    if (!fiscal) { res.status(404).json({ erro: 'Cliente API nao encontrado.' }); return; }
    res.json({ fiscal });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.put('/api/admin/clients/:cnpj/fiscal', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const store = await getApiClientStore();
    if (!(await store.obter(cnpj))) { res.status(404).json({ erro: 'Cliente API nao encontrado.' }); return; }

    // Estes campos entram no XML: recusar aqui evita nota rejeitada com erro
    // ilegivel na SEFAZ. UF e normalizada antes de conferir.
    const b = req.body || {};
    const uf = String(b.uf || '').trim().toUpperCase();
    const erros: string[] = [];
    if (uf && !/^[A-Z]{2}$/.test(uf)) erros.push('UF deve ter 2 letras');
    if (b.codMunicipio && !/^\d{7}$/.test(String(b.codMunicipio).trim())) erros.push('Codigo IBGE do municipio deve ter 7 digitos');
    if (b.crt && !['1', '2', '3'].includes(String(b.crt))) erros.push('Regime tributario invalido');
    if (b.ambiente && !['1', '2'].includes(String(b.ambiente))) erros.push('Ambiente invalido');
    const cep = String(b.cep || '').replace(/\D/g, '');
    if (cep && cep.length !== 8) erros.push('CEP deve ter 8 digitos');
    if (erros.length) { res.status(400).json({ erro: erros.join('; ') + '.' }); return; }

    await store.salvarFiscal(cnpj, { ...b, uf: uf || undefined });
    registrarAudit('admin', 'client.fiscal_updated', 'api_client', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, fiscal: await store.obterFiscal(cnpj) });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Chaves de API do cliente ---
// Existe /api/empresas/:cnpj/keys, mas ela exige a empresa cadastrada como
// emitente do Emissor. Cliente de API e entidade propria e nunca esta la, entao
// nao havia como emitir a credencial dele por lugar nenhum.
app.get('/api/admin/clients/:cnpj/keys', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const keyStore = await getApiKeyStore();
    res.json({ keys: await keyStore.listar(req.params.cnpj.replace(/\D/g, '')) });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/clients/:cnpj/keys', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const clientStore = await getApiClientStore();
    const client = await clientStore.obter(cnpj);
    if (!client) { res.status(404).json({ erro: 'Cliente API nao encontrado.' }); return; }
    if (client.status === 'cancelled' || client.status === 'suspended') {
      res.status(400).json({ erro: `Cliente ${client.status === 'cancelled' ? 'cancelado' : 'suspenso'} nao pode receber novas chaves.` });
      return;
    }

    // Cliente ainda em sandbox so recebe credencial de homologacao — a chave nao
    // pode valer mais que o status comercial do cliente.
    //
    // Cliente ativo recebe, por padrao, uma chave que opera nos dois ambientes.
    // E o que permite a plataforma dele ter "ver previa" (homologacao) e "emitir"
    // (producao) sem trocar credencial no meio do caminho: a nota e ensaiada e
    // emitida com a mesma chave, e a escolha fica na tela, onde o operador ve.
    // Quem quiser uma chave restrita continua pedindo pelo campo `ambiente`.
    const pedido = String(req.body?.ambiente || '').trim();
    const ambientePermitido: AmbientePermitido = client.status !== 'active'
      ? 'homologacao'
      : pedido === 'homologacao' || pedido === 'producao' ? pedido : 'ambos';

    const keyStore = await getApiKeyStore();
    const { chave, registro } = await keyStore.criar({
      empresaCnpj: cnpj,
      nome: String(req.body?.nome || '').trim() || 'Integracao',
      ambiente: ambientePermitido === 'producao' ? '1' : '2',
      escopo: req.body?.escopo === 'readonly' ? 'readonly' : 'full',
      ambientePermitido,
    });

    registrarAudit('admin', 'apikey.created', 'api_key', {
      empresaCnpj: cnpj, entityId: String(registro.id), requestId: (req as any).requestId,
    });

    res.json({
      sucesso: true,
      chave,
      registro,
      aviso: 'Guarde esta chave agora — ela nao pode ser exibida novamente.',
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Templates de plataforma ---
app.get('/api/admin/templates', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getPlatformTemplateStore();
    const templates = await store.listarTemplates(req.query.status as any);
    res.json({ templates });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/templates', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const nome = String(req.body?.name || '').trim();
    if (!nome) { res.status(400).json({ erro: 'Informe o nome do template.' }); return; }
    // Slug derivado do nome: o usuário não precisa inventar um identificador.
    const slug = String(req.body?.slug || '').trim() || slugify(nome);
    const store = await getPlatformTemplateStore();
    const tpl = await store.criarTemplate({
      name: nome,
      slug,
      version: String(req.body?.version || '1.0').trim() || '1.0',
      description: req.body?.description,
      supportedModules: req.body?.supportedModules,
      content: req.body?.content,
    });
    registrarAudit('admin', 'template.created', 'platform_template', {
      entityId: String(tpl.id), requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, template: tpl });
  } catch (err: any) {
    const msg = err.code === '23505' ? 'Ja existe um template com esse slug e versao' : err.message;
    res.status(err.code === '23505' ? 409 : 500).json({ erro: msg });
  }
});

app.post('/api/admin/templates/:id/publish', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getPlatformTemplateStore();
    await store.publicar(Number(req.params.id));
    registrarAudit('admin', 'template.published', 'platform_template', {
      entityId: req.params.id, requestId: (req as any).requestId,
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// --- Gerador de plataforma (Kit Lovable) ---
/**
 * O manifest de um cliente — a unica peca que difere entre plataformas.
 *
 * Vive fora das rotas porque tres delas precisam do mesmo resultado: a que
 * devolve o kit em JSON, a que monta o `.zip` e a que publica no repositorio.
 * Montar em cada uma daria tres manifests que divergem no primeiro campo novo —
 * e foi exatamente assim que as guardas de emissao se perderam entre a NF-e e a
 * NFC-e.
 *
 * Devolve `erro` em vez de lancar: os tres casos de recusa (cliente inexistente,
 * sem servico contratado, sem modelo) sao respostas 400/404 com texto proprio, e
 * nao falhas de servidor.
 */
async function montarManifestDoCliente(
  cnpj: string,
  opts: { templateId?: unknown; templateSlug?: string; templateVersion?: string; apiBaseUrl?: string } = {},
): Promise<
  | { erro: string; status: number }
  | { manifest: PlatformManifest; template: PlatformTemplate; servicos: FiscalService[]; branding: any }
> {
  const clientStore = await getApiClientStore();
  const client = await clientStore.obter(cnpj);
  if (!client) return { erro: 'Cliente API nao encontrado.', status: 404 };

  const svcStore = await getClientServiceStore();
  const servicos = await svcStore.obterAtivos(cnpj);
  if (!servicos.length) {
    return {
      erro: 'Nenhum servico contratado. Ative NF-e, NFC-e ou NFS-e no detalhe do cliente.',
      status: 400,
    };
  }

  const wlStore = await getWhiteLabelStore();
  const branding = await wlStore.obterOuPadrao(cnpj);

  const tplStore = await getPlatformTemplateStore();
  const template = opts.templateId
    ? await tplStore.obterTemplatePorId(Number(opts.templateId))
    : await tplStore.obterTemplate(opts.templateSlug || 'fiscal-platform', opts.templateVersion);
  if (!template) return { erro: 'Template nao encontrado.', status: 404 };

  // VERCEL_URL é a URL DAQUELE deploy: muda a cada publicação e responde 302
  // por trás da proteção de deploy. A plataforma do cliente ficaria apontando
  // para um endereço que morre no próximo push. Usa-se o domínio estável.
  const dominioEstavel = process.env['API_PUBLIC_URL']
    || (process.env['VERCEL_PROJECT_PRODUCTION_URL']
      ? `https://${process.env['VERCEL_PROJECT_PRODUCTION_URL']}`
      : '');

  const manifest = tplStore.gerarManifest({
    empresa: {
      cnpj,
      razaoSocial: client.razaoSocial,
      fantasia: client.fantasia,
      // A plataforma precisa da UF para decidir CFOP interno x interestadual.
      uf: (await clientStore.obterFiscal(cnpj))?.uf,
    },
    branding,
    modules: servicos,
    template,
    apiBaseUrl: opts.apiBaseUrl || dominioEstavel || 'https://nfe-emissor.vercel.app',
    clientId: client.codigoInterno || `CLI_${cnpj.slice(0, 8)}`,
  });

  return { manifest, template, servicos, branding };
}

app.post('/api/admin/clients/:cnpj/generate-platform', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');

    // O cliente de API é entidade própria — não exigimos que ele também
    // exista como empresa emitente do Emissor.
    const clientStore = await getApiClientStore();
    const client = await clientStore.obter(cnpj);
    if (!client) { res.status(404).json({ erro: 'Cliente API nao encontrado.' }); return; }

    const svcStore = await getClientServiceStore();
    const servicos = await svcStore.obterAtivos(cnpj);
    if (!servicos.length) { res.status(400).json({ erro: 'Nenhum servico contratado. Ative NF-e, NFC-e ou NFS-e no detalhe do cliente.' }); return; }

    const wlStore = await getWhiteLabelStore();
    const branding = await wlStore.obterOuPadrao(cnpj);

    const tplStore = await getPlatformTemplateStore();
    // Aceita o id numérico vindo do seletor da tela ou o slug de uma integração.
    // Sem `templateId` explicito, vai SEMPRE no modelo canonico. O painel
    // deixou de perguntar de proposito: escolher modelo gerava especificacao
    // diferente, e todo cliente tem de sair na mesma estrutura — o que muda de
    // um para outro e a marca, que vem do white-label.
    const template = req.body.templateId
      ? await tplStore.obterTemplatePorId(Number(req.body.templateId))
      : await tplStore.obterTemplate(req.body.templateSlug || 'fiscal-platform', req.body.templateVersion);
    if (!template) { res.status(404).json({ erro: 'Template nao encontrado.' }); return; }

    // VERCEL_URL é a URL DAQUELE deploy: muda a cada publicação e responde 302
    // por trás da proteção de deploy. A plataforma do cliente ficaria apontando
    // para um endereço que morre no próximo push. Usa-se o domínio estável.
    const dominioEstavel = process.env['API_PUBLIC_URL']
      || (process.env['VERCEL_PROJECT_PRODUCTION_URL']
        ? `https://${process.env['VERCEL_PROJECT_PRODUCTION_URL']}`
        : '');
    const apiBaseUrl = req.body.apiBaseUrl || dominioEstavel || 'https://nfe-emissor.vercel.app';

    const manifest = tplStore.gerarManifest({
      empresa: {
        cnpj,
        razaoSocial: client.razaoSocial,
        fantasia: client.fantasia,
        // A plataforma precisa da UF para decidir CFOP interno x interestadual.
        uf: (await clientStore.obterFiscal(cnpj))?.uf,
      },
      branding,
      modules: servicos,
      template,
      apiBaseUrl,
      clientId: client.codigoInterno || `CLI_${cnpj.slice(0, 8)}`,
    });

    const genId = await tplStore.registrarGeracao({
      empresaCnpj: cnpj,
      templateId: template.id!,
      templateVersion: template.version,
      branding,
      modules: servicos,
      features: manifest.features,
      generatedBy: 'admin',
    });

    await clientStore.atualizar(cnpj, {
      templateId: template.slug,
      templateVersion: template.version,
    });

    registrarAudit('admin', 'platform.generated', 'platform_generation', {
      empresaCnpj: cnpj, entityId: String(genId), requestId: (req as any).requestId,
    });

    // Gerar prompt Lovable
    const lovablePrompt = gerarLovablePrompt(manifest, template, servicos);

    // Valores prontos para colar no gerenciador de secrets do construtor. O
    // segredo da API NAO vai aqui nem no manifest: se fosse, ficaria no
    // historico do construtor e no Git do projeto do cliente.
    // Por CNPJ: um kit nao pode abrir o painel de outro cliente.
    const acesso = await obterCredenciaisPlataforma(cnpj);
    const credenciais = {
      APP_USER: acesso.usuario,
      APP_ACCESS_PASSWORD: acesso.senha,
      // Assina a sessao e ninguem digita: sortear por geracao nao custa nada.
      SESSION_SECRET: require('crypto').randomBytes(32).toString('base64url'),
      FISCAL_API_KEY: null as string | null, // só existe em claro no momento em que a chave é gerada
    };

    // Duas variaveis, nao cinco. Cada uma a mais e uma chance a mais de errar um
    // digito copiando de um lugar para outro — e as outras tres o modelo resolve
    // sozinho: o usuario e o CNPJ (ja vai no manifest), o segredo de sessao e
    // derivado da chave da API, e a URL tem padrao.
    const envExample = `# Configuração da plataforma ${manifest.company.brandName}
#
# Sao DUAS. Lidas SOMENTE no servidor — nenhuma pode ganhar prefixo VITE_, que
# manda o valor inteiro para o navegador. E nenhuma entra no repositorio.

# Chave de API deste cliente. Ela ja fixa o CNPJ.
FISCAL_API_KEY={{COLE_A_CHAVE_DE_API_DO_CLIENTE}}

# Senha do painel. O usuario e o CNPJ, que e publico — sai na nota, no site, no
# cartao. Enquanto esta senha nao for trocada, quem souber o CNPJ entra aqui.
# Troque em Clientes API > "Gerar outra" e atualize o valor neste deploy.
APP_ACCESS_PASSWORD=${credenciais.APP_ACCESS_PASSWORD}

# ── Opcionais: so preencha para fugir do padrao ──────────────────────────────
# APP_USER — vazio = o CNPJ do manifest (${manifest.company.cnpj}).
# SESSION_SECRET — vazio = derivado da chave da API por HMAC. Preencher so se
#   precisar atravessar uma troca de chave sem derrubar as sessoes abertas.
# FISCAL_API_URL — vazio = ${manifest.api.baseUrl}
`;

    res.json({
      sucesso: true,
      geracaoId: genId,
      manifest,
      lovablePrompt,
      envExample,
      credenciais,
      template: { slug: template.slug, version: template.version },
      servicos,
      // Pre-preenche o campo do repositorio e mostra o que ja foi publicado ali:
      // a pergunta "eu ja mandei isso pra ela?" some da cabeca de quem opera.
      ...(client.repositoryUrl ? { repositoryUrl: client.repositoryUrl } : {}),
      ...(client.ultimaPublicacaoCommit
        ? {
          ultimaPublicacao: {
            commit: client.ultimaPublicacaoCommit,
            branch: client.ultimaPublicacaoBranch,
            em: client.ultimaPublicacaoEm,
          },
        }
        : {}),
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Histórico de gerações
/**
 * O repositorio do cliente, pronto, em um `.zip`.
 *
 * O modelo vem do GitHub e o `platform.manifest.json` e trocado pelo do cliente.
 * As abas ja nascem certas porque o manifest carrega os modulos contratados —
 * nao existe "modelo de NF-e" e "modelo de NFS-e" separados, e nao deve existir:
 * seriam dois lugares para corrigir cada defeito.
 *
 * Nao precisa de credencial nenhuma: o modelo mora no proprio Emissor, em
 * `platform-template/`. A primeira versao buscava num repositorio do GitHub, e
 * isso estava errado por dois motivos — o repositorio era o projeto de um
 * cliente (com secrets e vida propria), e ler repositorio privado exige token de
 * escrita na conta.
 */
app.get('/api/admin/clients/:cnpj/kit.zip', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');
    const kit = await montarManifestDoCliente(cnpj, req.query as any);
    if ('erro' in kit) { res.status(kit.status).json({ erro: kit.erro }); return; }

    const arquivos = await baixarModelo();
    arquivos.set(
      CAMINHO_MANIFEST,
      Buffer.from(JSON.stringify(kit.manifest, null, 2) + '\n', 'utf8'),
    );

    const zip = montarZip(arquivos);
    // O nome do arquivo carrega a marca porque quem gera tres kits seguidos
    // acaba com tres downloads iguais na pasta e sobe o do cliente errado.
    const nome = `plataforma-${slugify(kit.manifest.company.brandName || cnpj)}.zip`;
    registrarAudit('admin', 'platform.kit_baixado', 'api_client', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(zip);
  } catch (err: any) {
    res.status(502).json({ erro: `Nao foi possivel montar o kit: ${err.message}` });
  }
});

/**
 * Publica o modelo + o manifest no repositorio do cliente, no GitHub.
 *
 * O repositorio e criado e conectado pelo construtor (e ele que precisa criar,
 * para o projeto ficar ligado); aqui so se ACRESCENTA um commit. Publicado o
 * commit, o construtor sincroniza sozinho e a plataforma aparece no editor sem
 * consumir geracao de IA — que era o custo que fazia cada cliente novo esgotar
 * os creditos.
 *
 * **Exige `GITHUB_TOKEN`, e de proposito ele nao tem valor padrao.** Token de
 * escrita guardado aqui pode escrever em tudo que alcanca: use um token de
 * escopo restrito (fine-grained), com permissao de conteudo SO nos repositorios
 * das plataformas. Sem a variavel, a rota responde dizendo isso em vez de falhar
 * com erro de autenticacao do GitHub, que nao explica nada a quem opera.
 */
// ---------------------------------------------------------------------------
// Console de clientes — front end administrativo, para construir por fora
// ---------------------------------------------------------------------------

/** Pasta do modelo do console, e o arquivo que prova que ela e o console. */
const PASTA_CONSOLE = process.env['ADMIN_TEMPLATE_DIR'] || 'admin-template';
const MARCADOR_CONSOLE = 'src/lib/admin.functions.ts';

/**
 * O console de clientes, pronto para subir num construtor.
 *
 * A ponte ja traz um painel que funciona. Este existe para quem quer interface
 * propria, hospedada a parte e evoluida no construtor — sem que isso signifique
 * reescrever a conversa com a API do zero.
 *
 * O que ele nao leva, e nao pode levar: a chave administrativa. Ela entra por
 * variavel de ambiente no provedor, e so o lado servidor do console a le.
 */
app.get('/api/admin/console/kit.zip', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const arquivos = amarrarConsoleNaPonte(
      await lerModeloDaPasta(PASTA_CONSOLE, MARCADOR_CONSOLE), baseUrl(req));
    const zip = montarZip(arquivos);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="console-clientes.zip"');
    res.setHeader('X-Arquivos', String(arquivos.size));
    res.send(zip);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/console/publicar', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const escolha = escolherToken(req.body?.token, process.env['GITHUB_TOKEN']);
    if (!escolha) { res.status(400).json(SEM_TOKEN); return; }
    const token = escolha.token;

    const urlRepositorio = String(req.body?.repositoryUrl || '').trim();
    if (!urlRepositorio) {
      res.status(400).json({ erro: 'Informe a URL do repositorio (repositoryUrl).' });
      return;
    }

    const arquivos = amarrarConsoleNaPonte(
      await lerModeloDaPasta(PASTA_CONSOLE, MARCADOR_CONSOLE), baseUrl(req));
    const resultado = await publicarNoGitHub({
      arquivos,
      urlRepositorio,
      token,
      mensagem: 'Console de clientes da ponte fiscal\n\n'
        + 'Front end administrativo: clientes, servicos, chaves e publicacao das\n'
        + 'plataformas. A chave da ponte entra por variavel de ambiente e nunca\n'
        + 'vai para o navegador — leia o README.\n\n'
        + 'Publicado pelo painel do Emissor.',
    });

    registrarAudit('admin', 'console.publicado', 'sistema', {
      requestId: (req as any).requestId,
    });
    res.json({ sucesso: true, ...resultado, repositoryUrl: urlRepositorio });
  } catch (err: any) {
    const doGitHub = err?.response?.data?.message;
    res.status(502).json({
      erro: doGitHub ? `GitHub recusou: ${doGitHub}` : `Nao foi possivel publicar: ${err.message}`,
      ...(err?.response?.status === 404
        ? { comoResolver: 'O token nao enxerga este repositorio. Confira o escopo dele.' }
        : {}),
    });
  }
});

// ---------------------------------------------------------------------------
// Kit da INSTANCIA — a ponte inteira, para virar outra instalacao
// ---------------------------------------------------------------------------

/**
 * O codigo desta ponte, empacotado para subir noutro lugar.
 *
 * Nao confundir com o kit do CLIENTE: aquele e a plataforma que consome esta
 * API; este e a API. Vai o motor fiscal, o painel, os cadastros, a revenda por
 * chave — e o `platform-template/` junto, senao a instancia nova nasce sem
 * conseguir gerar cliente nenhum.
 *
 * **Nenhuma credencial entra no pacote.** Nem banco, nem certificado, nem
 * senha: so o `.env.example` dizendo o que preencher. Repositorio com segredo
 * dentro nasce vazado, e no Git isso nao se apaga — fica no historico.
 */
app.get('/api/admin/instancia/kit.zip', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const arquivos = await montarKitDaInstancia({ marca: String(req.query.marca || '') });
    const zip = montarZip(arquivos);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ponte-fiscal.zip"');
    res.setHeader('X-Arquivos', String(arquivos.size));
    res.send(zip);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * Publica a ponte num repositorio do GitHub — o mesmo caminho do kit do cliente.
 *
 * Acrescenta um commit; nunca reescreve. O repositorio pode estar vazio ou ja
 * ter historico, e nos dois casos o que existe fora do pacote continua onde
 * estava.
 */
app.post('/api/admin/instancia/publicar', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const escolha = escolherToken(req.body?.token, process.env['GITHUB_TOKEN']);
    if (!escolha) { res.status(400).json(SEM_TOKEN); return; }
    const token = escolha.token;

    const urlRepositorio = String(req.body?.repositoryUrl || '').trim();
    if (!urlRepositorio) {
      res.status(400).json({ erro: 'Informe a URL do repositorio (repositoryUrl).' });
      return;
    }

    /**
     * Publicar com o disco atrasado produz um pacote errado que se parece com
     * um certo: commit novo, contagem certa, conteudo velho. Melhor recusar.
     */
    if (discoEstaAtrasado('/api/diagnostico/pacote')) {
      res.status(503).json({
        erro: 'O codigo no disco desta ponte esta ATRASADO em relacao ao que ela executa. '
          + 'Publicar agora geraria uma instancia com codigo antigo.',
        comoResolver: 'Refaca o deploy DESTA ponte sem cache de build (na Vercel: Redeploy '
          + 'com "Use existing Build Cache" desmarcado, ou defina VERCEL_FORCE_NO_BUILD_CACHE=1) '
          + 'e publique de novo.',
        veja: '/api/diagnostico/pacote',
      });
      return;
    }

    const marca = String(req.body?.marca || '').trim() || 'Ponte Fiscal';
    const arquivos = await montarKitDaInstancia({ marca });
    const resultado = await publicarNoGitHub({
      arquivos,
      urlRepositorio,
      token,
      mensagem: `${marca}: a ponte fiscal, pronta para instalar\n\n`
        + `Codigo completo do servico que fala com a SEFAZ, mais o modelo das\n`
        + `plataformas dos clientes. Nenhuma credencial vai no pacote — leia\n`
        + `INSTALACAO.md e preencha o .env.example.\n\n`
        + 'Publicado pelo painel do Emissor.',
    });

    registrarAudit('admin', 'instancia.publicada', 'sistema', {
      requestId: (req as any).requestId,
    });
    /**
     * O link que sobe esta ponte numa conta da Vercel qualquer.
     *
     * Vai no corpo da resposta, e nao montado em JavaScript no painel, para
     * existir um lugar so que sabe quais variaveis a instalacao pede. Montado
     * na tela, ele viraria uma segunda lista — e a desatualizada seria
     * justamente a que o operador ve.
     *
     * Nao pode derrubar a resposta: quando chega aqui, a publicacao JA
     * aconteceu, e falhar agora esconderia um sucesso.
     */
    let urlDeDeploy: string | null = null;
    try { urlDeDeploy = urlDeDeployNaVercel({ repositorio: urlRepositorio, nome: marca }); }
    catch { urlDeDeploy = null; }

    res.json({ sucesso: true, ...resultado, repositoryUrl: urlRepositorio, urlDeDeploy });
  } catch (err: any) {
    const doGitHub = err?.response?.data?.message;
    res.status(502).json({
      erro: doGitHub ? `GitHub recusou: ${doGitHub}` : `Nao foi possivel publicar: ${err.message}`,
      ...(err?.response?.status === 404
        ? { comoResolver: 'O token nao enxerga este repositorio. Confira se ele foi incluido no escopo do token.' }
        : {}),
    });
  }
});

/**
 * Diz o que o token alcanca neste repositorio, sem criar commit nenhum.
 *
 * Existe porque os modos de falha da publicacao sao indistinguiveis de fora:
 * variavel ausente, variavel vazia, token vencido, repositorio fora do escopo e
 * permissao so de leitura produzem todos o mesmo "nao publicou". Descobrir qual
 * e tentando publicar e caro e assustador — a pessoa nao sabe se a tentativa
 * deixou meio commit no repositorio do cliente.
 *
 * E POST por simetria com a publicacao (mesmo corpo, mesma tela), nao porque
 * altere alguma coisa: por dentro e uma leitura.
 */
app.post('/api/admin/github/verificar', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const urlRepositorio = String(req.body?.repositoryUrl || '').trim();
    if (!urlRepositorio) {
      res.status(400).json({ erro: 'Informe a URL do repositorio para testar (repositoryUrl).' });
      return;
    }
    // O token pode vir colado no corpo: e assim que se testa um repositorio de
    // outra conta, para a qual o token do servidor nunca serviria.
    const escolha = escolherToken(req.body?.token, process.env['GITHUB_TOKEN']);
    const verificacao = await verificarAcessoAoRepositorio({
      token: escolha?.token,
      urlRepositorio,
    });
    res.json({ ...verificacao, ...(escolha ? { origemDoToken: escolha.origem } : {}) });
  } catch (err: any) {
    // URL mal formada cai aqui: e erro de quem digitou, nao do servidor.
    res.status(400).json({ erro: err.message });
  }
});

app.post('/api/admin/clients/:cnpj/publicar-repositorio', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');
    const escolha = escolherToken(req.body?.token, process.env['GITHUB_TOKEN']);
    const token = escolha?.token ?? '';
    if (!token) {
      // "Cadastrei e continua dizendo que falta" tem duas causas MUITO diferentes,
      // e sem separar as duas o operador fica trocando o token a toa:
      // a variavel nao chegou ao deploy (cadastrada depois, ou em outro
      // ambiente), ou chegou vazia. So a segunda se resolve mexendo no valor.
      const chegouVazia = 'GITHUB_TOKEN' in process.env;
      res.status(400).json({
        erro: chegouVazia
          ? 'A variavel GITHUB_TOKEN existe no servidor, mas esta vazia.'
          : 'Publicacao automatica desligada: falta a variavel GITHUB_TOKEN no servidor.',
        comoResolver: chegouVazia
          ? 'Abra a variavel na Vercel, cole o token de novo e salve — o campo de valor ficou em branco. '
            + 'Depois publique um deploy novo, porque variavel so entra em deploy criado depois dela.'
          : 'Gere um token fine-grained no GitHub com permissao de CONTEUDO (leitura e escrita) '
            + 'apenas nos repositorios das plataformas, cadastre como GITHUB_TOKEN na Vercel (ambiente '
            + 'Production) e publique um deploy NOVO — variavel nao entra em deploy que ja existia. '
            + 'Alternativa sem token nenhum: rode `Publicar plataforma.cmd` na sua maquina — '
            + 'ele baixa o kit e publica usando a credencial do Git que ja esta ali.',
      });
      return;
    }

    const urlRepositorio = String(req.body?.repositoryUrl || '').trim();
    if (!urlRepositorio) {
      res.status(400).json({ erro: 'Informe a URL do repositorio do cliente (repositoryUrl).' });
      return;
    }

    const kit = await montarManifestDoCliente(cnpj, req.body || {});
    if ('erro' in kit) { res.status(kit.status).json({ erro: kit.erro }); return; }

    const arquivos = await baixarModelo();
    arquivos.set(
      CAMINHO_MANIFEST,
      Buffer.from(JSON.stringify(kit.manifest, null, 2) + '\n', 'utf8'),
    );

    const marca = kit.manifest.company.brandName;
    const resultado = await publicarNoGitHub({
      arquivos,
      urlRepositorio,
      token,
      mensagem: `Plataforma fiscal da ${marca}\n\n`
        + `Modelo unico das plataformas white-label e o manifest desta cliente.\n`
        + `Modulos: ${kit.servicos.join(', ')}. CNPJ ${kit.manifest.company.cnpj}.\n\n`
        + 'Publicado pelo painel do Emissor.',
    });

    // A URL fica no cadastro: e ela que responde "qual repositorio e de quem"
    // quando existirem dez plataformas. O commit e a data respondem a outra
    // pergunta, a que aparece um mes depois: "esse cliente ja recebeu a correcao
    // de tal dia, ou ficou para tras?". Sem isso a unica forma de saber e abrir
    // o repositorio de cada um e olhar o historico.
    await (await getApiClientStore()).atualizar(cnpj, {
      repositoryUrl: urlRepositorio,
      ultimaPublicacaoCommit: resultado.commit,
      ultimaPublicacaoBranch: resultado.branch,
      ultimaPublicacaoEm: new Date().toISOString(),
    });
    registrarAudit('admin', 'platform.repositorio_publicado', 'api_client', {
      empresaCnpj: cnpj, requestId: (req as any).requestId,
    });

    res.json({ sucesso: true, ...resultado, repositoryUrl: urlRepositorio });
  } catch (err: any) {
    const doGitHub = err?.response?.data?.message;
    res.status(502).json({
      erro: doGitHub ? `GitHub recusou: ${doGitHub}` : `Nao foi possivel publicar: ${err.message}`,
      ...(err?.response?.status === 404
        ? { comoResolver: 'O token nao enxerga este repositorio. Confira se ele foi incluido no escopo do token.' }
        : {}),
    });
  }
});

app.get('/api/admin/clients/:cnpj/generations', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const store = await getPlatformTemplateStore();
    const geracoes = await store.listarGeracoes(req.params.cnpj);
    res.json({ geracoes });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

// Health de um cliente
app.get('/api/admin/clients/:cnpj/health', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');

    // Consulta o cliente de API, não a empresa emitente do Emissor: a segunda
    // nunca existe para quem só consome a API, e o 404 daí deixava o painel
    // eternamente em "UNKNOWN".
    const clientStore = await getApiClientStore();
    const client = await clientStore.obter(cnpj);
    if (!client) { res.status(404).json({ erro: 'Cliente API nao encontrado.' }); return; }

    const svcStore = await getClientServiceStore();
    const servicos = await svcStore.obterAtivos(cnpj);

    const keyStore = await getApiKeyStore();
    const chavesAtivas = (await keyStore.listar(cnpj)).filter(k => k.ativa).length;

    let certDias: number | null = null;
    if (client.certificadoVencimento) {
      certDias = Math.floor((new Date(client.certificadoVencimento).getTime() - Date.now()) / 86400000);
    }

    // O que ainda impede este cliente de emitir — vira a lista de proximos
    // passos na tela, em vez de deixar o operador adivinhando. O codigo permite
    // a tela oferecer o botao certo em cada pendencia.
    const pendencias: { codigo: string; texto: string }[] = [];
    if (!client.temCertificado) {
      pendencias.push({ codigo: 'certificado', texto: 'Enviar o certificado digital A1' });
    } else if (certDias !== null && certDias < 0) {
      pendencias.push({ codigo: 'certificado', texto: 'Certificado vencido — enviar um novo' });
    }
    if (!servicos.length) pendencias.push({ codigo: 'servicos', texto: 'Contratar ao menos um servico (NF-e, NFC-e ou NFS-e)' });

    // Sem o cadastro do emitente a nota nao se monta, mesmo com certificado e
    // chave. A mesma lista usada pela guarda de emissao, para a tela nao dizer
    // "pronto" e a emissao falhar depois.
    const fiscal = await clientStore.obterFiscal(cnpj);
    const faltando = ApiClientStore.fiscalFaltando(fiscal);
    if (faltando.length) {
      pendencias.push({ codigo: 'fiscal', texto: 'Completar o cadastro fiscal — falta: ' + faltando.join(', ') });
    }

    // NFC-e contratada sem CSC: a tela dizia "pronto" e a emissao falhava
    // depois, com uma mensagem que o operador so via na hora de vender no
    // balcao. O CSC nao e algo que o Emissor gere — quem emite e a SEFAZ do
    // estado, no portal do contribuinte —, entao aparecer na lista de
    // pendencias e o unico jeito de isso ser resolvido ANTES.
    if (servicos.includes('nfce')) {
      try {
        // `obterRaw` e nao `obterContexto`: aqui basta saber se as duas colunas
        // estao preenchidas, e o contexto ainda descriptografa o certificado.
        const emp = await (await getEmpresaStore()).obterRaw(cnpj);
        if (!emp?.csc_id || !emp?.csc_token) {
          pendencias.push({
            codigo: 'csc',
            texto: 'Cadastrar o CSC da NFC-e — o codigo e emitido pela SEFAZ do estado, '
              + 'no portal do contribuinte. Sem ele o cupom nao sai.',
          });
        }
      } catch { /* sem cadastro de empresa: a pendencia de certificado ja cobre */ }
    }

    if (!chavesAtivas) pendencias.push({ codigo: 'chave', texto: 'Gerar a chave de API para entregar ao cliente' });
    if (client.status === 'draft') pendencias.push({ codigo: 'ativar', texto: 'Ativar o cliente' });
    if (client.status === 'suspended') pendencias.push({ codigo: 'ativar', texto: 'Cliente suspenso — reativar para voltar a emitir' });
    if (client.status === 'cancelled') pendencias.push({ codigo: 'cancelado', texto: 'Cliente cancelado' });

    const atencao = certDias !== null && certDias >= 0 && certDias < 30;

    const logStore = await getRequestLogStore();
    const stats = await logStore.estatisticas(cnpj);

    res.json({
      status: pendencias.length ? 'incompleto' : (atencao ? 'atencao' : 'pronto'),
      pendencias,
      certificado: { presente: client.temCertificado, diasRestantes: certDias, alerta: atencao },
      servicos,
      chavesAtivas,
      atividade: stats,
    });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * Contrato real da API, escrito no prompt.
 *
 * Sem isto o construtor inventa uma API REST plausível — /api/nfe, /api/nfe/:id,
 * DELETE /api/nfse/:id — e a plataforma sai bonita, seguindo o branding, com
 * estados de erro e tudo, mas incapaz de emitir uma nota: todo endpoint
 * responde 404. Dizer "não altere os contratos da API" não basta quando o
 * contrato não está escrito em lugar nenhum.
 *
 * Documenta também a camada de inteligência fiscal (classificação de NCM,
 * CFOP, catálogo de produtos). Sem ela o construtor gera um formulário onde o
 * operador digita NCM e CFOP de cabeça — que é o que a API existe para evitar.
 */
function contratoDaApi(servicos: string[]): string {
  const partes: string[] = [`
## Contrato da API (endpoints REAIS — não invente outros)

Os caminhos abaixo são a API inteira. Não existe /api/nfe nem rota REST por
recurso: os caminhos são por verbo. Toda chamada leva os headers
\`x-api-key\` e \`x-empresa-cnpj\`, do lado servidor.

Erro: **toda** resposta de erro traz \`erro\` com a mensagem em português. Leia
sempre esse campo. Alguns erros trazem também um envelope estruturado
(\`error.code\`, \`error.requestId\`) — use o \`code\` para diferenciar o
tratamento e o \`requestId\` no suporte, mas o texto para o usuário é o \`erro\`.

Há **quatro caminhos de falha na emissão** e eles não são iguais. Tratá-los
como um só é o erro mais caro desta integração: manda o operador procurar
defeito numa nota que está certa, ou reemitir uma que já existe.

1. **A SEFAZ rejeitou** → HTTP **200** com
   \`{ sucesso: false, chaveAcesso, cStat, xMotivo, erro, detalhes }\`.
   Status 200 NÃO significa nota autorizada: **checar \`sucesso\` é
   obrigatório**. Mostre \`xMotivo\` e o \`cStat\` — é a única frase que diz por
   que a SEFAZ recusou, e o operador precisa dela para corrigir.
2. **A nota nem chegou a ser enviada** (falhou na validação, faltou campo,
   série inválida, cnpj e cpf juntos) → HTTP **400** com
   \`{ sucesso: false, erro, detalhes: [...] }\`. O array \`detalhes\` nomeia o
   campo errado. **Nunca trate 400 como erro genérico de HTTP**: é aqui que
   está a informação mais útil que a API produz.
3. **A SEFAZ está fora do ar** → HTTP **503** com
   \`{ sucesso: false, sefazIndisponivel: true, indefinido: false, contingencia }\`.
   A nota **não foi emitida** e a numeração continua livre: é só tentar de novo
   mais tarde. Na tela, isto **não** pode aparecer como "nota rejeitada" — não
   há nada para corrigir no documento. Diga que a SEFAZ do estado está fora e
   que a venda pode ser refeita depois. Não prometa desvio automático: o
   emissor **não** emite em contingência (SVC), e o campo \`contingencia\` traz
   essa frase pronta.
4. **Não se sabe se a nota saiu** → HTTP **502** com
   \`{ sucesso: false, indefinido: true, chaveAcesso, comoResolver }\`.
   O envio não foi confirmado e a nota **pode** existir na SEFAZ. Guarde a
   \`chaveAcesso\` e consulte \`GET /api/consultar?chave=\` antes de qualquer
   reemissão — reemitir às cegas gera duplicidade, que só se desfaz com
   cancelamento. **Nunca reenvie automaticamente neste caso.**

A diferença entre o 3 e o 4 é a única que o operador precisa entender: no 503
ele tenta de novo à vontade; no 502 ele **para** e consulta.

Códigos, cada um com mensagem própria na tela:
- **401** — chave de API inválida ou revogada. Falar com o suporte.
- **402** — limite do plano atingido. **É o que para a emissão em produção**;
  a mensagem tem de dizer que basta renovar o plano, não "erro desconhecido".
- **403** — serviço não contratado, ou ambiente não permitido para a chave
  (o campo \`ambientePermitido\` diz qual ela aceita).
- **429** — excesso de requisições. Tentar de novo em instantes.

Resposta em formato inesperado (não-JSON, HTML de erro, campo ausente) é ERRO
visível na tela — nunca a converta em lista vazia. "Nenhum documento emitido"
e "não consegui falar com a API" são estados diferentes e o operador precisa
distinguir: um convida a emitir, o outro a chamar o suporte.

Se a sessão do painel expirar durante o uso, leve o usuário de volta ao login
com aviso de sessão expirada, em vez de mostrar erro genérico numa tela sem
saída.

### Registro de nota (o que as listagens devolvem)
\`\`\`
chaveAcesso, numero, serie, ambiente ('1' producao | '2' homologacao),
destNome, destDoc, vNF, protocolo, dhRecbto, cStat,
status ('AUTORIZADA' | 'CANCELADA'), emitidaEm (ISO)
\`\`\`
Use exatamente estes nomes. Não existem campos como \`id\`, \`valor\`,
\`destinatario\` ou \`dataEmissao\` na resposta.`];

  if (servicos.includes('nfe')) {
    partes.push(`
### NF-e — emissão
\`POST /api/emitir\`

Cabeçalho da nota:
- \`serie\` — string. **Use "880" como padrão da plataforma.**
  O contador da SEFAZ é por (CNPJ, série). Se a plataforma emitir na mesma
  série que o sistema próprio do cliente, os dois disputam a numeração e saem
  notas com o mesmo número — que a SEFAZ recusa e o contador não conserta.
  As séries baixas (1 a 100) são as que a empresa costuma já usar; a 880 fica
  reservada para a emissão via plataforma. Deixe o campo editável, mas nasça
  em 880 e mantenha esse padrão em todas as plataformas geradas.
  **NÃO use 890 ou acima**: a SEFAZ reserva a faixa 890-999 para contingência
  e recusa emissão normal com cStat 244 ("Processo de Emissão pelo
  Contribuinte incompatível com a Série da NF"). O limite é 889 — comprovado
  em teste: 880 autoriza, 890 e 900 recusam. A própria API recusa com **400**
  antes de transmitir, então não é preciso esperar a SEFAZ para descobrir.
  Atenção: NF-e e NFC-e compartilham o contador da mesma série — se o cliente
  tiver os dois, use séries diferentes para cada modelo.
- \`numero\` — string. **NÃO é auto-numerado**: omitir emite sempre o número 1,
  e a segunda nota colide com a primeira. Busque em
  \`GET /api/proximo-numero?serie=880&ambiente=1\` antes de cada emissão e envie
  o valor (converta o número para string). **Passe sempre o \`ambiente\`**: a
  contagem é separada por ambiente, e pedir sem dizer qual devolve o número do
  outro lado. A resposta traz \`{ serie, ambiente, numero }\`.
- \`tipoOperacao\` — "1" saída (venda), "0" entrada (compra). Padrão "1".
  Nota de entrada serve para compra de produtor rural e devolução: o emitente
  continua sendo a empresa, e a contraparte vai no bloco \`destinatario\`.
  Não existe campo "remetente".
- \`naturezaOperacao\` — texto, padrão "VENDA", máximo 60 caracteres.
- \`finalidade\` — "1" normal, "2" complementar, "3" ajuste, "4" devolução.
  Nas finalidades 2 e 4 é obrigatório \`notasReferenciadas\` (chave de 44
  dígitos, ou array de chaves).
- \`ambiente\` — "1" produção, "2" homologação. A chave da plataforma opera nos
  dois; uma chave restrita devolve 403 ao pedir o outro, com o campo
  \`ambientePermitido\` dizendo qual ela aceita.
- \`informacoesAdicionais\` — texto livre, ou \`{ fisco, complementar }\`.
- \`simular: true\` — monta a nota, valida contra o schema oficial da SEFAZ e
  devolve **sem enviar, sem consumir numeração e sem gastar cota do plano**.
  Aceita também \`"true"\`, \`"1"\` e \`"sim"\`. Resposta:
  \`{ simulacao: true, sucesso, erro?, detalhes?, schemaValidado, cfopAjustado?,
  ambiente, chaveAcesso, numero, serie, nfe, xml }\`.

  - \`nfe\` é exatamente o que seria enviado. **Os totais ficam em
    \`nfe.total.ICMSTot\`** — \`vProd\`, \`vDesc\`, \`vFrete\`, \`vSeg\`,
    \`vICMS\`, \`vIPI\`, \`vNF\`. Use esses valores na tela; não recalcule por
    conta, senão ela mostra um número e a SEFAZ recebe outro.
  - \`schemaValidado\` diz se a conferência contra o schema rodou de fato.
    Quando for \`false\`, o \`sucesso: true\` significa "não deu para conferir",
    não "está tudo certo" — e a tela deve dizer isso ao operador.
  - \`chaveAcesso\` da prévia é **provisória**: ela contém um código numérico
    aleatório e não será a chave da nota emitida. Não guarde nem exiba como
    definitiva.
  - Em homologação o destinatário é substituído pelo texto obrigatório da SEFAZ,
    então a prévia mostra outro nome — é esperado.

- \`cfopAjustado\` — aparece na prévia E na emissão quando a API corrigiu o
  primeiro dígito de algum CFOP para bater com o sentido da nota (entrada/saída)
  e o destino. Formato: \`[{ item: 1, de: "5102", para: "1102" }]\`.
  **Mostre isso na tela.** O operador digitou um CFOP e outro foi para a nota;
  esconder a correção é pior do que a rejeição que ela evitou.

### Separe o que vale do que foi teste

**A listagem NÃO pode misturar produção e homologação.** A numeração é separada
por ambiente, então uma nota real e uma de teste com o **mesmo número e a mesma
série** convivem — e é o caso normal, não a exceção. Lado a lado, sem marca, o
operador não tem como saber qual é documento fiscal.

Todo registro traz \`ambiente\`: \`"1"\` produção, \`"2"\` homologação.

- A lista abre em **produção**. Ela é o livro fiscal da empresa, e nota de teste
  não pertence a ele. Rotule o filtro pelo que significa — "Notas válidas" e
  "Testes" —, nunca "ambiente 1 / ambiente 2", que não diz nada a quem fatura.
- Mostre o **número de testes** no próprio botão, para o operador saber que eles
  existem sem precisar procurar.
- Ao ver os testes, um aviso: **não vão para a contabilidade, não geram imposto e
  não precisam ser cancelados.**
- **Selo na própria linha** e faixa no detalhe do documento. Aberto por link ou
  impresso, ele continua tendo de dizer o que é — o filtro não viaja junto.

\`GET /api/historico?ambiente=1\` filtra no servidor, se preferir não trazer tudo.

O mesmo vale para o resto da tela: dashboard, relatórios e totais **contam só
produção** por padrão. Somar teste no faturamento é dar número errado a quem
decide com ele.

### O documento é do cliente — entregue sempre o XML e o PDF

**Toda emissão autorizada devolve o documento**, e a plataforma tem de entregá-lo.
Isto não é um extra: o XML é o documento fiscal (o PDF é só a representação
gráfica dele), e o cliente precisa dele para a contabilidade, para a escrituração
e para provar a operação ao fisco. Guardar só na tela é entregar pela metade.

A resposta da emissão traz:
- \`xml\` — o **nfeProc** completo, já com o protocolo de autorização. É este que
  se arquiva, não o XML de antes do envio.
- \`danfePdf\` — o PDF em **base64** (NF-e e NFC-e).
- \`arquivo\` — o nome sugerido, ex.: \`NFe_<chave>.xml\`.
- \`downloads\` — \`{ xml, pdf }\` com os caminhos para buscar de novo depois.

**Na tela, obrigatoriamente:**
1. **Logo após emitir**, ofereça os dois arquivos para baixar, antes de navegar
   para outro lugar. O \`danfePdf\` chega uma vez só, na resposta — descartá-lo
   obriga o operador a uma segunda busca que ele não sabe que existe.
2. **Na lista de documentos**, um botão de XML e um de PDF em cada linha.
3. **No detalhe do documento**, os dois em destaque.

Para baixar depois, por chave de acesso:
- NF-e e NFC-e: \`GET /api/nota/:chave/xml\` e \`GET /api/nota/:chave/danfe\`
- NFS-e: \`GET /api/nfse/:chave/xml\` e \`GET /api/nfse/:chave/danfse\`

Essas rotas devolvem o arquivo em si (não JSON), com o \`Content-Type\` correto.
Como a chave da API é server-side, **o download passa pelo seu servidor**: crie
uma rota própria que busca na API e devolve ao navegador com
\`Content-Disposition: attachment\`. Nunca exponha a chave num link do navegador.

Ofereça também um **botão de enviar por e-mail ao destinatário**, se o serviço
tiver essa rota — é o que o cliente faria a seguir de qualquer jeito.

### Prévia e emissão — os dois botões obrigatórios

A tela de emissão tem **dois botões**, sempre:

1. **"Ver prévia"** (secundário) — chama a rota de emissão do serviço com
   \`simular: true\`: \`/api/emitir\` (NF-e), \`/api/emitir-nfce\` (NFC-e) ou
   \`/api/nfse/emitir\` (NFS-e). **Os três aceitam.**
   Não gasta nota, não gasta número, não gasta cota do plano e não transmite. Mostra os totais, os
   impostos por item e o destinatário como vão ser enviados, e exibe \`erro\` e
   \`detalhes\` quando \`sucesso\` for falso. É o botão que o operador aperta
   primeiro, e ele deve poder apertar quantas vezes quiser.
2. **"Emitir"** (primário) — emite de verdade. Antes de enviar, **confirmação
   explícita nomeando o ambiente**: em produção, dizer com todas as letras que a
   nota terá valor fiscal e não poderá ser apagada, só cancelada. Nunca emitir em
   produção sem esse passo.

Ofereça também um **seletor de ambiente** (Produção / Homologação) junto ao botão
Emitir, com Produção como padrão e um selo bem visível quando estiver em
homologação ("TESTE — sem valor fiscal"). Emitir em homologação é o ensaio geral:
a SEFAZ valida tudo de verdade e devolve cStat, mas a nota não existe fiscalmente.
Como a numeração é separada por ambiente, esse ensaio **não consome número da
série real** — o operador pode repetir à vontade.

Só mostre o seletor se \`GET /api/status\` devolver \`ambientePermitido\` igual a
\`"ambos"\`. Quando a chave for restrita, esconda o seletor e mostre o ambiente
fixo como informação — oferecer uma opção que devolve 403 é pior do que não
oferecer nenhuma.

Destinatário (obrigatório):
\`{ razaoSocial, cnpj | cpf, indIEDest, ie?, email?, endereco: { logradouro,
numero, bairro, codigoMunicipio (IBGE, 7 dígitos), nomeMunicipio, uf, cep } }\`
O campo é \`nomeMunicipio\`, não \`municipio\`. Logradouro e bairro com menos de
2 caracteres são recusados.

**\`cnpj\` e \`cpf\` são excludentes: mandar os dois devolve 400.** No formulário,
use um único campo de documento e decida pelo número de dígitos (11 = CPF,
14 = CNPJ). Nunca envie o campo vazio do outro tipo com valor residual de um
cliente anterior — foi para isso que a recusa existe.

\`cep\` e \`codigoMunicipio\` vão **só com dígitos**: "30130-000" é recusado pelo
schema, que exige exatamente 8 dígitos. Limpe a máscara antes de enviar.
\`uf\` vai em MAIÚSCULAS.

Itens — array, **vários itens por nota**:
\`{ codigo?, descricao, ncm, cfop, unidade, quantidade, valorUnitario,
   desconto?, frete?, seguro?, despesas?,
   cstIcms?, aliqIcms?, redBcIcms?, mva?, aliqIcmsSt?, origem?,
   cstIpi?, aliqIpi?, cstPis?, cstCofins?, cest? }\`
- \`codigo\` vazio é numerado por posição (001, 002…).
- Aceita vírgula decimal ("1.234,56").
- **O imposto sai da alíquota: você não precisa calcular nada.** Mandando
  \`cstIcms\` e \`aliqIcms\`, o servidor deriva a base e o valor do ICMS — base é
  o valor da operação (produtos menos desconto, mais frete, seguro e despesas),
  com \`redBcIcms\` aplicada antes da alíquota. Em substituição tributária
  (CST 10/70, CSOSN 201), \`mva\` e \`aliqIcmsSt\` produzem a base e o valor da
  ST, com o IPI incluído na base e o ICMS próprio abatido.
  Nunca calcule imposto na tela e mostre esse número como se fosse o da nota:
  use os valores que a **prévia** devolve em \`nfe\`, que são os que serão
  transmitidos.
- \`origem\` — origem da mercadoria (0 nacional, 1 importação direta, 2 mercado
  interno…). Omitir manda 0: mercadoria importada sairia declarada como
  nacional.
- \`cBenef\` — Código de Benefício Fiscal na UF. MG, RJ e outros estados o
  exigem quando a operação usa CST de benefício (20, 40, 51, 70). Vem da
  classificação; repasse quando vier.
- \`pCredSN\` — só para CSOSN 201 (Simples com ST): alíquota de crédito da faixa
  do Simples. Omitir emite com crédito zero — a nota é válida, mas o comprador
  não aproveita o crédito a que teria direito.

### Campos do cabeçalho que mudam imposto
- \`indFinal\` — "1" consumidor final, "0" não. Omitindo, o servidor deduz pelo
  destinatário: contribuinte com IE compra para revenda, então sai "0". Isso
  importa porque \`indFinal: "1"\` em venda interestadual para não contribuinte
  é o que dispara o DIFAL.
- \`modFrete\` — "0" emitente (CIF), "1" destinatário (FOB), "2" terceiros,
  "9" sem transporte. Havendo frete na nota e ninguém dizendo quem contratou,
  o servidor assume "0" e **avisa** — declarar "9" numa nota que cobra frete é
  uma contradição dentro do próprio XML.
- \`pICMSUFDest\` e \`pFCPUFDest\` — **por item** — alíquota interna e Fundo de
  Combate à Pobreza da UF de DESTINO, usados no DIFAL. São por item porque a
  alíquota interna é do produto naquele estado: cesta básica e bebida não pagam
  o mesmo em lugar nenhum.

  Você normalmente **não precisa enviar**: quando a venda é interestadual para
  consumidor final não contribuinte, o servidor procura sozinho a regra fiscal
  cadastrada para o NCM na UF de destino e usa a alíquota dela. Cadastre em
  "Regras fiscais" a regra do estado para onde vende e o DIFAL sai correto.
  Sem regra e sem o campo, o servidor cai em 18% e **avisa nomeando os NCMs** —
  18% assumido pode ser imposto a maior ou a menor.

### \`avisos\` — as suposições que o servidor precisou fazer
Prévia e emissão podem devolver \`avisos: ["...", ...]\`. São defaults fiscais que
o servidor aplicou por falta de informação — não são erros, e a nota sai. Mas
**mostre-os na tela**: um default fiscal que ninguém vê é indistinguível de uma
decisão consciente, e é assim que imposto errado passa despercebido por meses.
- A tela precisa de uma **lista de itens com botão de adicionar**, não um bloco
  fixo. Nota com um item só é a exceção, não a regra.

Acessórios (desconto, frete, seguro, despesas):
- Por item, nos campos acima; **ou** no cabeçalho da nota
  (\`desconto\`, \`frete\`, \`seguro\`, \`despesas\`), e nesse caso o servidor rateia
  proporcionalmente entre os itens e a sobra da divisão vai no último.
- Informar nos dois soma: o do cabeçalho é rateado e acrescenta ao do item.
- Ofereça **campo de desconto por item** e, se quiser, um desconto da nota
  inteira. Ambos funcionam de verdade — o valor entra no XML e abate o total.

Pagamento (**obrigatório**):
\`{ forma, valor }\` ou \`{ formas: [{ tipo, valor }], troco? }\`.
Códigos: 01 dinheiro, 03 crédito, 04 débito, 15 boleto, 17 PIX, 90 sem
pagamento. O formulário precisa oferecer essa escolha.

Resposta: \`{ sucesso: true, chaveAcesso, protocolo, dhRecbto, cStat, xMotivo }\`

### NF-e — demais operações
- \`GET /api/historico\` — **array direto** de registros (não vem embrulhado).
- \`POST /api/cancelar\` — \`{ chaveAcesso, protocolo, justificativa }\`.
  A justificativa tem no mínimo 15 caracteres.
- \`POST /api/inutilizar\` — \`{ serie, nNFIni, nNFFin, justificativa }\`.
  São estes nomes, não numeroInicial/numeroFinal.
- \`GET /api/nota/:chaveAcesso/xml\` e \`GET /api/nota/:chaveAcesso/danfe\`
- \`GET /api/nota/:chaveAcesso/duplicar\` — devolve o formulário já preenchido a
  partir de uma nota anterior. Ofereça como "Duplicar" na lista: é o caminho
  mais rápido para quem emite a mesma nota toda semana.
- \`GET /api/consultar?chave=<44 dígitos>\` — situação atual na SEFAZ.
- \`GET /api/status\` — se a SEFAZ da UF está no ar. Use para avisar antes de o
  operador preencher a nota inteira e tomar erro no envio. Aceita
  \`?ambiente=1|2\` e devolve \`{ online, cStat, xMotivo, ambiente,
  ambientePermitido }\` — o último diz o que a chave pode fazer
  (\`"ambos"\`, \`"producao"\` ou \`"homologacao"\`).

### Numeração
\`GET /api/proximo-numero?serie=880&ambiente=1\` →
\`{ serie, ambiente, numero (NÚMERO), storage }\`

Chame antes de cada emissão e envie o valor em \`numero\` (como string).
O contador é por (CNPJ, série, ambiente) e **não reserva**: duas emissões
simultâneas recebem o mesmo número. Se a nota voltar rejeitada por número
duplicado, consulte de novo e reenvie.

Produção e homologação contam separado — de propósito. Ensaiar a nota em
homologação não gasta número da série real, então a prévia na SEFAZ pode ser
repetida sem deixar buraco na numeração para inutilizar depois. Por isso o
\`ambiente\` tem de ir na consulta: pedir sem ele devolve o número do outro lado.`);
  }

  if (servicos.includes('nfce')) {
    partes.push(`
### NFC-e — cupom fiscal (modelo 65)
\`POST /api/emitir-nfce\`

Mesmo corpo da NF-e, com três diferenças que importam:
- **Série própria.** NF-e e NFC-e dividem o contador da mesma série. Se o cliente
  tem os dois, use séries diferentes — a 880 para NF-e e a 881 para NFC-e, por
  exemplo. Mesma série nos dois modelos = numeração duplicada e recusa.
- O destinatário é **opcional**: cupom sem CPF é o caso normal. Peça o CPF como
  campo opcional ("CPF na nota?"), nunca obrigatório.
- **CPF ou CNPJ, nunca os dois.** Mandar os dois volta 400. Não é rigor: o
  emissor teria de escolher um, o outro sumiria do XML e o cupom sairia
  AUTORIZADO no nome errado — sem rejeição para avisar. Na tela, ofereça um
  campo só, com o tipo de documento à escolha.
- \`presenca\` é "1" (presencial) — é venda no balcão.
- A série segue a mesma faixa da NF-e: **0 a 889**. Fora dela a API recusa antes
  de transmitir (a SEFAZ responde cStat 244).
- Como na NF-e, o CFOP tem rede: qualquer código que não comece por 5 é
  corrigido e o que mudou volta em \`cfopAjustado\` — mostre na tela.

\`simular: true\` também funciona aqui, com a mesma resposta da NF-e mais
\`modelo: "65"\`. **Use no botão "Ver prévia"**: sem ele o botão emitiria cupom
fiscal de verdade.

Cancelamento e consulta usam as MESMAS rotas da NF-e (\`/api/cancelar\`,
\`/api/consultar\`) — não existe \`/api/cancelar-nfce\`. O histórico também é o
mesmo \`/api/historico\`.`);
  }

  if (servicos.includes('nfse')) {
    partes.push(`
### NFS-e

**O registro de NFS-e tem nomes próprios.** Os campos da NF-e acima NÃO valem
aqui, e usá-los deixa a lista inteira com colunas vazias:
\`\`\`
chaveAcesso, numero, serie, numeroDps, idDps, ambiente,
tomadorNome, tomadorDoc, codigoServico, descricaoServico,
valorServico, valorIssqn, valorLiquido, status, emitidaEm
\`\`\`
Não existe \`destNome\`, \`destDoc\` nem \`vNF\` em NFS-e.

- \`POST /api/nfse/emitir\`
  \`{ tomador: { razaoSocial, cnpj | cpf, endereco: {...} }, valorServico,
  aliquotaIss?, issRetido?, tributacaoIssqn?, observacoes?, ambiente? }\`
  mais **uma** destas duas formas de dizer qual é o serviço:
  - \`servicoCodigo\` — o campo \`codigo\` de um item de \`GET /api/nfse/servicos\`,
    que é o código interno do catálogo do cliente, **não** o código da LC 116.
    Preenche sozinho valor, alíquota, ISS retido e tributação. É o caminho
    recomendado: monte um seletor com o catálogo.
  - \`servico: { codigoTributacaoNacional (6 dígitos), descricao,
    codigoTributacaoMunicipal?, codigoNBS?, codigoMunicipioPrestacao? }\` —
    objeto aninhado, para quem não usa catálogo.

  Sem uma das duas, a resposta é 400. \`servico\` **não** é um texto com o nome
  do serviço.
- \`GET /api/nfse/historico?limit=100\`
  Resposta: \`{ "notas": [ ... ] }\` — **embrulhado em \`notas\`**, ao contrário
  do histórico de NF-e, que vem como array direto. Trate os dois formatos.
- \`POST /api/nfse/cancelar\` — POST, não DELETE por id.
  Corpo: \`{ chaveAcesso, motivo, justificativa }\`. A \`justificativa\` é
  obrigatória e tem de ter **entre 15 e 255 caracteres** — valide no formulário,
  com contador, antes de enviar. \`motivo\` é "1" por padrão.
- \`GET /api/nfse/:chave\`, \`GET /api/nfse/:chave/xml\`, \`GET /api/nfse/:chave/danfse\`
- \`GET /api/nfse/servicos\` — catálogo de serviços do emitente.
  Resposta: \`{ "servicos": [ ... ] }\`, também embrulhado.

**A recusa da NFS-e vem em \`erros\`, no plural**, e cada item é um objeto
\`{ codigo, descricao, complemento }\` — não é o campo \`erro\` das outras rotas.
Monte a mensagem a partir desses objetos: \`join\` num array de objetos imprime
"[object Object]" e o operador fica sem saber o que houve.

\`simular: true\` funciona aqui também e devolve \`{ simulacao, sucesso, dps,
estimativa: { valorServico, aliquotaIss, valorIss, valorLiquido } }\`. Ele confere
tudo que a API consegue conferir sem transmitir — tomador, serviço no catálogo,
código de tributação e **a adesão do município ao Emissor Nacional**. Use no
botão "Ver prévia".

**A maioria dos municípios brasileiros ainda não aderiu ao Emissor Nacional.**
Quem não aderiu não emite, e a API recusa com mensagem explicando isso antes de
transmitir. Trate esse caso na tela como situação normal e não como falha do
sistema: a solução é a prefeitura aderir, e o cliente precisa entender isso.

A numeração da NFS-e é automática e tem contador próprio — **não** use
\`/api/proximo-numero\`, que é da NF-e. Não peça número nem série ao operador`);
  }

  partes.push(`
## Inteligência fiscal — use, não peça ao operador

A API classifica produto sozinha. Uma tela que faz o operador digitar NCM e
CFOP de cabeça está desperdiçando isso e vai gerar nota errada.

### Classificação
\`GET /api/classificar?ncm=<8 dígitos>&uf=<UF>&operacao=<tipo>\`

Devolve, pronto: \`{ ncm, descricao, cfop, cstCsosn, aliqIcms?, redBcIcms?,
cstIpi, aliqIpi?, cest?, mva?, aliqIcmsSt?, temST, cbenef?, baseLegal?, fonte }\`

\`uf\` e \`regime\` são opcionais (assumem os da empresa). \`operacao\` aceita os
valores de \`/api/tipos-operacao\` e por padrão é venda_revenda.

**O sentido vai em parâmetros próprios**, não dentro de \`operacao\`:
\`&entrada=1\` para nota de entrada e \`&interestadual=1\` para fora do estado.
São eles que definem o primeiro dígito do CFOP. Numa tela de compra, passe
\`entrada=1\` — senão vem 5102 (saída) para uma nota de entrada.
(Por conveniência \`operacao=entrada\`, \`compra\`, \`saida\` e \`venda\` também
valem como sentido; valor irreconhecível volta com um campo \`aviso\`.)

De todo modo a emissão tem rede: se o CFOP chegar no sentido errado, a API
corrige o primeiro dígito sozinha e devolve \`cfopAjustado\` — que a tela deve
mostrar. A correção existe para evitar a rejeição 519, não para dispensar
pedir o CFOP certo.

**Assim que o NCM for preenchido, chame esta rota e preencha CFOP, CST/CSOSN,
alíquotas, CEST e MVA sozinho.** Deixe os campos editáveis e mostre a origem
(\`fonte\`) e a \`baseLegal\` quando vierem — o operador confere, não digita.

### NCM
- \`GET /api/ncm/buscar?q=<termo>\` → \`{ disponivel, fonte, itens: [{ codigo,
  descricao, origem?, usos? }] }\` — **embrulhado**.
  Autocomplete do campo "descrição do produto": dispare a partir de 3
  caracteres, com atraso de ~300ms. Itens com \`origem: 'catalogo'\` já foram
  usados antes (\`usos\` diz quantas vezes) — destaque-os, são decisão humana
  anterior. Escolher uma sugestão preenche o NCM e dispara a classificação.
- \`GET /api/ncm/:codigo\` → o item direto, ou 404 se não existir na tabela
  oficial. Use para validar NCM digitado à mão: mostre a descrição oficial ao
  lado do campo, ou marque erro no 404.
- \`GET /api/ncm\` → \`{ total, atualizadoEm, pronta, orientacao? }\`. Se
  \`pronta\` for false, a base não foi importada: caia para digitação manual em
  vez de deixar o autocomplete mudo.

### Operação e CFOP
- \`GET /api/tipos-operacao\` → **array direto** de \`{ valor, label }\`, 9 itens
  (venda_revenda, venda_producao, devolucao, transferencia, bonificacao…).
  Use como seletor "tipo de operação" em vez de pedir o CFOP.
- \`GET /api/cfop?operacao=<valor>&entrada=1&interestadual=1\` →
  \`{ cfop, operacao, entrada, interestadual }\`.
  \`entrada\` e \`interestadual\` só são verdadeiros com "1" ou "true".
  Quem decide interno x interestadual é a tela: compare a UF do destinatário
  com a do emitente (\`company.uf\` do manifest).

**CFOP e tipo de destinatário andam juntos.** Combinação incoerente é rejeitada
com mensagem que não explica a causa (ex.: cStat 232, "IE do destinatário não
informada"). Pergunte em português — "o destinatário é contribuinte de ICMS?" —
e derive \`indIEDest\` (1 contribuinte, exige a IE; 2 isento; 9 não
contribuinte). Nunca deixe o operador digitar CFOP livre sem essa conferência.

### Catálogo de produtos do cliente
- \`GET /api/produtos\` → **array direto**. Sem \`q\` lista tudo; com \`?q=\` busca
  por descrição, código ou NCM (máximo 12).
  Cada produto traz \`{ id, codigo, descricao, ncm, cfop, unidade,
  valorUnitario?, cstCsosn, aliqIcms?, cstIpi, aliqIpi?, cest?, mva?, ... }\`.
  Use como **autocomplete na emissão**: escolher um produto preenche a linha do
  item inteira, incluindo os tributos. É o caminho normal de emitir.
- \`POST /api/produtos\` → \`{ sucesso, produto }\`. Obrigatórios: \`descricao\` e
  \`ncm\`. No cadastro, chame \`/api/classificar\` e pré-preencha o resto — o
  operador confere em vez de digitar.
- \`GET /api/produtos/sugestoes?ncm=<ncm>\` → **array direto** (máximo 8) de
  produtos de OUTRAS empresas com o mesmo NCM, cada um com \`origemEmpresa\`.
  Mostre como "como outras empresas classificam este produto", especialmente
  quando a classificação não achar nada. Clicar copia a classificação.

### Regras fiscais (o cliente define o tratamento dos NCMs dele)
- \`GET /api/regras-fiscais?uf=<UF>\` → **array direto** de regras por NCM,
  com CST, CSOSN, CFOP, alíquota, CEST, MVA e base legal. Traz as regras da
  própria empresa mais as gerais; havendo as duas para o mesmo NCM, vem a da
  empresa, que é a que vale.
- \`POST /api/regras-fiscais\` — grava a regra **da própria empresa**. Corpo:
  \`{ ncm, uf, descricao?, cstIcmsNormal?, csosnSimples?, cfopSaida?, aliqIcms?,
  redBcIcms?, cstIpi?, aliqIpi?, cest?, mva?, aliqIcmsSt?, cbenef?, baseLegal? }\`.
  Regravar o mesmo NCM+UF atualiza a regra existente.
- \`DELETE /api/regras-fiscais/:id\` — remove só regra da própria empresa;
  tentar apagar uma regra geral responde 404.

Monte uma aba "Regras fiscais" com listagem por UF, formulário de cadastro e
remoção. Deixe claro na tela quais linhas são da empresa e quais são gerais
(as gerais não podem ser editadas ali). Ao salvar, avise que dali em diante a
classificação daquele NCM passa a usar essa regra.

Vale explicar ao usuário para que serve: é onde ele corrige, de uma vez, o
tratamento de um produto que a classificação automática erra — em vez de
ajustar item a item em toda nota.`);

  // As duas seções abaixo faltavam por inteiro neste contrato — zero menções a
  // IBS/CBS e a webhook em 27 mil caracteres —, embora o motor RECUSE emissão
  // por causa de IBS/CBS e o webhook seja o único jeito de o ERP saber o
  // resultado sem ficar consultando.
  partes.push(`### IBS/CBS — Reforma Tributária

A API monta o grupo em todo item, com o padrão \`CST 000\` / \`cClassTrib 000001\`
(tributação integral). **Isso não é um valor neutro: é uma afirmação sobre o
produto.** Produto com tratamento próprio precisa do par dele, ou a nota sai
declarando algo falso.

**Alíquota zero não tem CST próprio.** Escreve-se como \`CST 200\` (alíquota
reduzida) com redução de 100%. É assim que entram fruta, hortaliça e ovo:

    { "ibscbs": { "cst": "200", "cClassTrib": "200014" } }

O \`200014\` (hortícolas, frutas e ovos) a API já conhece e aplica os 100%
sozinha. Para qualquer outro cClassTrib de CST 200, mande também
\`"pRedAliq": "60"\` com o percentual da tabela oficial — a API **recusa a
emissão** em vez de adivinhar, porque chutar redução é errar tributo.

Os três primeiros dígitos do cClassTrib são o próprio CST. Par incompatível
volta como \`cStat 1024\`.

Não mexa nas alíquotas para zerar o tributo: elas são validadas na autorização e
valor diferente do oficial retorna \`cStat 1026\`. Use o CST 200 com a redução,
que é a forma prevista no leiaute.

**Quando informar:** a rejeição por FALTA destes campos está suspensa (Ato
Técnico Conjunto RFB/CGIBS 1/2026), e para Simples Nacional a obrigatoriedade só
começa em 01/01/2027. O risco hoje é o inverso do que parece — grupo informado
atrai todas as regras de validação dele: **preencher errado rejeita a nota;
deixar em branco, não.**

### Webhooks — saber o resultado sem ficar consultando

Cadastre a URL em Clientes API. A API faz POST nela com
\`{ event, timestamp, ambiente, data }\` e assina o corpo cru em
\`X-Webhook-Signature\` (HMAC-SHA256 com o secret, que aparece **uma vez** na
criação).

Eventos: \`nfe.authorized\`, \`nfe.rejected\`, \`nfe.cancelled\`,
\`nfce.authorized\`, \`nfse.authorized\`, \`nfse.cancelled\`.

**Cadastre um endpoint por ambiente.** Endpoint sem ambiente recebe os dois — e
aí nota de teste dispara o mesmo evento que nota real, com o seu ERP dando baixa
em pedido por causa de uma homologação.

Confira a assinatura antes de confiar no corpo, e responda 2xx rápido: a entrega
não tem retry hoje, então processamento demorado deve ir para fila do seu lado.`);

  return partes.join('\n');
}

function gerarLovablePrompt(manifest: any, template: any, servicos: string[]): string {
  const modulosList = servicos.map(s => {
    const labels: Record<string, string> = { nfe: 'NF-e (Nota Fiscal Eletrônica)', nfce: 'NFC-e (Cupom Fiscal)', nfse: 'NFS-e (Nota de Serviço)' };
    return `- ${labels[s] || s}`;
  }).join('\n');

  return `# Plataforma Fiscal White-Label: ${manifest.company.brandName}

Crie uma plataforma fiscal seguindo integralmente as especificações abaixo.
Utilize platform.manifest.json como fonte de configuração visual e modular.

## Empresa
- Nome: ${manifest.company.name}
- Marca: ${manifest.company.brandName}
- CNPJ: ${manifest.company.cnpj}

## Branding (Design Tokens)
- Cor primária: ${manifest.branding.primary}
- Cor secundária: ${manifest.branding.secondary}
- Cor destaque: ${manifest.branding.accent}
- Background: ${manifest.branding.background}
- Surface: ${manifest.branding.surface}
- Texto: ${manifest.branding.text}
- Muted: ${manifest.branding.muted}
- Tema: ${manifest.branding.theme}

## Módulos Habilitados
${modulosList}

## API de Integração
- Base URL: \`${manifest.api.baseUrl}\`
- Client ID: \`${manifest.api.clientId}\`
- Autenticação: Header \`x-api-key\` (valor vem de secret server-side)
- Tenant: Header \`x-empresa-cnpj: ${manifest.api.tenantId}\`
${contratoDaApi(servicos)}

## Segredos (nomes exatos — não invente outros)
Peça exatamente estas variáveis de ambiente e leia-as SOMENTE no lado servidor
(Edge Function / BFF). Nenhuma delas pode aparecer no bundle do navegador:

- \`FISCAL_API_KEY\` — chave da API fiscal, enviada no header \`x-api-key\`
- \`APP_USER\` — usuário de acesso ao painel. É o **CNPJ do cliente**, só dígitos
- \`APP_ACCESS_PASSWORD\` — senha desse usuário
- \`SESSION_SECRET\` — segredo de assinatura da sessão

As duas primeiras já vêm preenchidas no \`.env.example\` do kit. Recuse o login
quando qualquer uma das duas faltar — assumir um padrão no código tranca o
cliente para fora sem dizer por quê.

## Login
NÃO crie cadastro de usuários, convites, "esqueci minha senha" nem seed de
usuário no código. O acesso é um único par, conferido no servidor.

Confira os DOIS campos: o usuário digitado contra \`APP_USER\` E a senha contra
\`APP_ACCESS_PASSWORD\`. Validar só a senha e ignorar o usuário é falha — o
campo de usuário viraria enfeite. Compare ambos em tempo constante e nunca
escreva os valores no código, em migration ou em arquivo de exemplo.

Se \`SESSION_SECRET\` estiver ausente, falhe no start com mensagem clara
dizendo qual variável falta, em vez de quebrar em runtime com erro opaco.
Limite tentativas de login por IP para não deixar a senha exposta a força bruta.

## Tema
O manifest traz \`branding.theme\` com um de três valores, e os três precisam
funcionar de verdade:
- \`light\` — sempre claro;
- \`dark\` — sempre escuro;
- \`auto\` — segue \`prefers-color-scheme\` do sistema.
Não deixe a paleta escura como código morto no CSS: se o tema pedir escuro ou
automático, ele tem que trocar de fato. Teste os dois modos antes de concluir.

## Idioma e marca (o produto é do cliente, não do construtor)
- Todo texto visível em português do Brasil, incluindo as páginas de erro e 404.
- \`<html lang="pt-BR">\`.
- Substitua o favicon e qualquer logotipo padrão do template pelos do cliente.
  NÃO deixe a marca da ferramenta de construção em nenhum lugar do produto —
  favicon, título da aba, rodapé, tela de erro ou meta tags.
- As páginas 404 e de erro seguem o mesmo branding do resto do sistema.

Estes dois NÃO são segredos e devem ficar no código como constantes:
- API_BASE_URL = \`${manifest.api.baseUrl}\`
- TENANT_CNPJ = \`${manifest.api.tenantId}\`

## Regras Obrigatórias
1. NÃO invente novos serviços fiscais além dos listados acima
2. NÃO altere os contratos da API
3. Todos os secrets devem ser utilizados APENAS server-side (Edge Functions/BFF)
4. NUNCA exponha API_SECRET no navegador ou no código frontend
5. Aplique integralmente o branding usando CSS variables
6. Implemente loading states, empty states e error states
7. Preserve responsividade (mobile + desktop)
8. NÃO use dados mock em produção
9. Toda tela de emissão tem **dois botões**: "Ver prévia" (não emite, não gasta
   numeração) e "Emitir" (com confirmação explícita nomeando o ambiente). Em
   produção, a confirmação diz que a nota terá valor fiscal e não poderá ser
   apagada, só cancelada. Nunca emitir em produção em um clique só.
10. **Todo documento emitido é entregue ao cliente em XML e PDF** — logo após a
   emissão, na lista e no detalhe. O XML é o documento fiscal; sem ele o cliente
   não tem o que dar à contabilidade. Ver a seção "O documento é do cliente".
11. **Nota de teste nunca se confunde com nota real.** A listagem abre em
   produção, o documento de homologação leva selo na linha e faixa no detalhe, e
   dashboard, relatórios e totais contam só produção. Ver "Separe o que vale do
   que foi teste".

## Páginas Obrigatórias
- Login (com mensagem: "${manifest.ui?.loginMessage || 'Bem-vindo'}")
- Dashboard (visão geral com cards de status)
- Destinatários: cadastro de quem recebe as notas, para não redigitar nove campos por nota. Ao escolher um destinatário na emissão, todos os dados dele preenchem o formulário. Guarde no navegador do cliente (localStorage) e AVISE na tela que é ali que mora — quem cadastra cem clientes e troca de computador precisa saber disso antes, não depois
- Produtos e regras fiscais: catálogo de produtos e regras por NCM (ver a seção de IBS/CBS abaixo para os campos que faltam na maioria dos sistemas)
${servicos.includes('nfe') ? '- NF-e: Emitir (com prévia), Lista (com XML e PDF por linha), Detalhes, Cancelar, Inutilizar\n' : ''}${servicos.includes('nfce') ? '- NFC-e: Emitir (com prévia), Lista (com XML e PDF por linha), Cancelar\n' : ''}${servicos.includes('nfse') ? '- NFS-e: Emitir (com prévia), Lista (com XML e DANFSE por linha), Cancelar\n' : ''}- Relatórios: **painel de gráficos ao vivo**, não um relatório para gerar. Ver a seção abaixo.
- Configurações
- Suporte${manifest.support?.email ? ` (email: ${manifest.support.email})` : ''}${manifest.support?.whatsapp ? ` (WhatsApp: ${manifest.support.whatsapp})` : ''}

## Suporte
- Um cartão por canal. **Quando houver WhatsApp, ele vem PRIMEIRO**: quem está
  com a nota travada no meio de uma venda não espera "até 1 dia útil".
- Link do WhatsApp: \`https://wa.me/<numero>?text=<mensagem>\`, com o número só em
  dígitos (DDI+DDD+número) e a mensagem já montada citando o nome da plataforma —
  o operador não deve precisar explicar de onde veio.
- **Sem número cadastrado, o cartão inteiro não aparece.** Não invente número e
  não deixe botão que abre o WhatsApp em lugar nenhum.
- Abra em aba nova, com \`rel="noopener noreferrer"\`.
- Abaixo dos canais, a lista do que informar ao abrir chamado: tipo de documento,
  número/série/chave e a mensagem de erro exibida.

## Relatórios (painel ao vivo)
- Atualiza sozinho (refetch a cada 60s). Não é uma tela de "gerar relatório".
- Quatro indicadores no topo: faturado no período (com variação contra o período
  anterior), notas emitidas, ticket médio e canceladas.
- Gráficos: faturamento por dia (área), documentos por dia separando produto e
  serviço (barras empilhadas) e concentração por destinatário (pizza, top 6).
- Seletor de período (7/30/90/365) e **seletor de AMBIENTE**.
- O ambiente é obrigatório e não é detalhe: filtrar só produção é o certo para a
  conta de faturamento — nota de teste vira número errado para quem decide com
  ele —, mas sem o seletor a tela fica vazia para todo cliente que ainda está
  testando, e parece que os gráficos não existem. Quando o ambiente escolhido
  estiver vazio, diga quantas notas há no outro e ofereça a troca.
- Em homologação, o subtítulo avisa que são números de teste, sem valor fiscal.
- Preencha TODOS os dias do período, inclusive os zerados: buraco no eixo faz o
  gráfico mentir sobre o ritmo.
- Cores dos gráficos em \`oklch\` que funcione nos dois temas. Recharts não lê
  CSS custom properties direto, e cor fixa fica ilegível no modo escuro.

## O que é "padrão" aqui

Padrão é a **estrutura**: quais abas existem, o que cada uma faz e como o sistema
visual se comporta. **A marca é que muda por cliente** — cores, logo, nome,
contatos, todos vindos do \`platform.manifest.json\`.

Então: nunca fixe cor, nome ou contato no código; leia sempre do manifest. E
nunca remova uma aba ou uma funcionalidade desta especificação por achar que
aquele cliente não vai usar — o cliente que não usa ignora; o que precisa e não
tem, liga reclamando.

## Devolução, complementar e ajuste — a nota precisa poder ser de correção

O formulário de emissão tem que ter **finalidade** (1 normal, 2 complementar,
3 ajuste, 4 devolução) e, quando for 2 ou 4, o campo da **chave da nota de
origem** (44 dígitos). Sem os dois a devolução é impossível — e a SEFAZ exige a
referência (rejeição 321).

Mostre o contador de dígitos que faltam para os 44: chave se cola errado o tempo
todo. E lembre na tela que devolução normalmente é nota de **entrada**, porque é
o tipo de operação que decide o sentido do CFOP (errar volta como rejeição 518).

## Origem da mercadoria — no ITEM, não só no cadastro

Campo obrigatório do XML, com nove códigos. O padrão \`0\` declara **nacional**:
usá-lo numa mercadoria importada é declaração falsa. E a origem manda na alíquota
interestadual — importada é 4%, não 12% nem 7%.

## NFS-e tem que ter tudo o que a NF-e tem

- **Prévia**, com \`simular: true\` na mesma rota de emissão. Aqui vale MAIS que
  na NF-e: NFS-e errada não se corrige por carta, só substituindo.
- **Entrega na hora**: depois de emitir, mostre chave, XML e PDF na própria tela.
  Não navegue para a lista descartando a resposta — o operador fica sem o
  documento que acabou de gerar.
- **Endereço do tomador**, exibido quando a retenção de ISS for 2 ou 3: a SEFIN
  exige (rejeição E0237). Não peça sempre, e não deixe de pedir nunca.
- Monte o corpo da requisição numa função **compartilhada** entre prévia e
  emissão. Duas cópias divergem, e uma prévia que mostra coisa diferente da que
  é enviada é pior que prévia nenhuma.

## Carta de correção (CC-e) — obrigatória na tela de detalhe da NF-e

É a operação fiscal mais comum do dia a dia e a mais esquecida por quem monta
plataforma: corrige uma nota já autorizada sem cancelar. Sem ela, o operador
cancela uma nota boa para reemitir — e passadas as 24h do prazo de cancelamento,
nem isso é possível.

- Endpoint: \`POST /api/carta-correcao\` com \`{ chaveAcesso, correcao,
  nSeqEvento, ambiente }\`. Só NF-e: a NFS-e não tem evento equivalente.
- Mínimo de 15 caracteres — barre na tela, não deixe a SEFAZ recusar.
- **Diga na tela para que NÃO serve:** valor, imposto, quantidade, data de
  emissão e troca de destinatário. A SEFAZ recusa, e nesses casos o caminho é
  cancelar e emitir de novo.
- **Diga que o texto vai COMPLETO a cada envio:** a última carta substitui as
  anteriores, então mandar só "a parte nova" apaga o resto.
- \`nSeqEvento\` sobe a cada carta da mesma nota. Avance sozinho depois de um
  envio bem-sucedido: ninguém lembra disso na hora.
- Esconda em nota cancelada — não há o que corrigir num documento que deixou de
  existir, e é melhor que deixar o botão dar erro.

## Cadastro de produto — os campos que a maioria esquece

Além de código, descrição, NCM, CFOP e CST/CSOSN, a API aceita e a tela precisa
oferecer: \`origem\` (**obrigatória** no XML — o padrão 0 declara nacional, e
usá-lo numa mercadoria importada é declaração falsa), \`ean\`, \`redBcIcms\`,
\`mva\`, \`aliqIcmsSt\`, \`cbenef\`, \`cstPis\` e \`cstCofins\`.

E aproveite a classificação: \`GET /api/classificar?ncm=\` devolve CFOP, CST,
alíquota, redução de base, MVA, ST e cBenef prontos. Consultar e descartar
metade é o mesmo que não consultar.

## Arquivo \`.env.example\` — obrigatório no projeto

Escreva as quatro variáveis com explicação de cada uma: \`FISCAL_API_KEY\`,
\`FISCAL_API_URL\`, \`APP_USER\`, \`APP_ACCESS_PASSWORD\` e \`SESSION_SECRET\`.
Nenhuma pode virar variável de cliente (nada de prefixo \`VITE_\`): a chave emite
nota fiscal em nome da empresa.

Coloque \`.env\` no \`.gitignore\`, com exceção para o \`.env.example\`.

## Documento cancelado precisa PARECER cancelado
- O status na lista e no detalhe não basta. **O PDF baixado também tem que estar
  marcado** — ele sai do sistema, vai por e-mail, entra no arquivo de quem
  recebe, e lá não existe interface nenhuma dizendo que foi cancelado.
- A API já devolve o DANFE e o DANFSE **carimbados na diagonal** quando a nota
  está cancelada. Você não precisa fazer nada no PDF: baixe pela rota normal
  (\`/api/nota/{chave}/danfe\`) que ele vem marcado.
- Na interface, mostre o selo de cancelada na listagem E no detalhe, e não
  ofereça ações que não cabem mais (cancelar de novo, carta de correção).

## Selos e badges (a regra que mais vaza)
- Faça **um** componente de selo e use em todos os lugares. Cópia manual da
  classe é o que faz uma tela ficar para trás quando a cor é corrigida.
- Sobre fundo TINGIDO (a cor com opacidade, tipo \`bg-success/15\`) o texto usa a
  cor de tinta, não a \`-foreground\` — esta última é para fundo SÓLIDO e costuma
  ser quase preta. Trocar as duas dá um selo com contraste de 1,4:1 no modo
  escuro: texto quase preto sobre fundo quase preto.
- Defina tokens de tinta por tema (claro escuro / escuro claro) e confira o
  contraste nos DOIS temas antes de fechar. Um selo legível só no claro é um
  selo quebrado.

## IBS/CBS — Reforma Tributária (obrigatório implementar)

A API já monta o grupo IBS/CBS em todo item, com o padrão CST 000 / cClassTrib
000001 (tributação integral). **Tributação integral não é um valor neutro: é uma
afirmação sobre o produto.** Produto com tratamento próprio precisa do par dele,
ou a nota sai declarando algo falso.

- No cadastro de produto, inclua três campos: \`ibscbsCst\`, \`ibscbsCclasstrib\` e
  \`ibscbsPRedAliq\`. Deixe-os em branco por padrão — a maioria dos produtos é
  tributação normal.
- **Alíquota zero não tem CST próprio.** Ela se escreve como CST 200 (alíquota
  reduzida) com redução de 100%. É assim que entram fruta, hortaliça e ovo:
  CST 200, cClassTrib 200014, redução 100.
- Valide antes de salvar, com as mesmas regras do motor: os três primeiros
  dígitos do cClassTrib são o próprio CST (par errado volta como cStat 1024);
  redução só vale com CST 200; e CST 200 com cClassTrib diferente de 200014
  exige o percentual, porque a API recusa a emissão em vez de adivinhar.
- Na emissão, envie o grupo aninhado por item:
  \`"ibscbs": { "cst": "200", "cClassTrib": "200014" }\`. Sem \`cst\`, não envie
  o grupo — o padrão da API já resolve. Quando o produto tiver redução própria,
  o campo vai junto: \`"pRedAliq": "60"\` (o \`ibscbsPRedAliq\` do cadastro).
- Se a tela estimar IBS/CBS para conferência, respeite o CST: fora da tributação
  integral não há valor a destacar, e CST 200 paga só o que sobra da redução.
  Nunca mostre R$ 0,00 quando a redução for desconhecida — diga que falta o dado.
- A rejeição por FALTA destes campos está suspensa (Ato Técnico Conjunto
  RFB/CGIBS 1/2026), e para Simples Nacional a obrigatoriedade só começa em
  01/01/2027. O risco hoje é o inverso: informar errado rejeita a nota; deixar em
  branco, não. Não escreva na interface que o destaque é obrigatório.

## Rodapé
${manifest.ui?.footer || `© ${new Date().getFullYear()} ${manifest.company.brandName}. Todos os direitos reservados.`}

## Marca do cliente
${manifest.assets?.logo
  ? '- O logo do cliente vem em `platform.manifest.json` no campo `assets.logo`, como data URI. Use-o no topo da barra lateral e na tela de login. NAO desenhe um logo generico nem escreva o nome em texto quando este campo existir.'
  : '- Sem logo cadastrado: use o nome da marca em texto, com a cor primaria.'}
${manifest.assets?.logoDark ? '- `assets.logoDark` e a versao para fundo escuro. Troque conforme o tema.' : ''}
${manifest.assets?.favicon ? '- `assets.favicon` e o icone da aba do navegador.' : ''}

## Template
- Slug: ${manifest.project.template}
- Versão: ${manifest.project.templateVersion}

${template?.content ? `## Observações deste modelo

O texto abaixo COMPLEMENTA tudo o que já foi dito. Ele não substitui nem
dispensa nenhuma seção acima — quando houver conflito, o padrão vence.

${template.content}` : ''}
`;
}

// Error handler global (deve ser o último middleware)
app.use(errorHandlerMiddleware);

export default app;
