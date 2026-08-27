import { NFe, TipoAmbiente } from './domain/models';
import { buildNFe, FiscalContextInput } from './domain/FiscalContext';
import { loadConfig, NFeConfig } from './config';
import { XmlGenerator } from './infrastructure/xml/XmlGenerator';
import { InutilizacaoXmlGenerator } from './infrastructure/xml/InutilizacaoXmlGenerator';
import { StatusServicoXmlGenerator } from './infrastructure/xml/StatusServicoXmlGenerator';
import { EventXmlGenerator } from './infrastructure/xml/EventXmlGenerator';

import { Signer } from './infrastructure/crypto/Signer';
import { SoapClient } from './infrastructure/soap/SoapClient';
import { NFeRepository } from './infrastructure/db/NFeRepository';
import { ContingenciaManager } from './infrastructure/contingencia/ContingenciaManager';
import { RetryHandler } from './infrastructure/retry/RetryHandler';
import { IdempotencyGuard } from './infrastructure/retry/IdempotencyGuard';
import { XsdValidator } from './infrastructure/validation/XsdValidator';
import { DanfeGenerator } from './infrastructure/pdf/DanfeGenerator';
import { TransmissaoNFeUseCase, TransmissaoResult } from './application/TransmissaoNFeUseCase';
import { CancelamentoNFeUseCase } from './application/CancelamentoNFeUseCase';
import { CartaCorrecaoUseCase } from './application/CartaCorrecaoUseCase';
import { ConsultaProtocoloUseCase } from './application/ConsultaProtocoloUseCase';
import { InutilizacaoNFeUseCase, InutilizacaoResult } from './application/InutilizacaoNFeUseCase';
import { StatusServicoUseCase, StatusServicoResult } from './application/StatusServicoUseCase';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export class NFeEngine {
  private config: NFeConfig;
  private signer!: Signer;
  private soapClient!: SoapClient;
  private repository!: NFeRepository;
  private contingencia!: ContingenciaManager;
  private retryHandler!: RetryHandler;
  private idempotencyGuard!: IdempotencyGuard;
  private xsdValidator!: XsdValidator;
  private danfeGenerator!: DanfeGenerator;
  private initialized = false;

  constructor(config?: NFeConfig) {
    this.config = config ?? loadConfig();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const pfxBuffer = fs.readFileSync(this.config.pfxPath);
    this.signer = new Signer(pfxBuffer, this.config.pfxPassword);

    this.soapClient = new SoapClient({
      timeout: this.config.timeoutMs,
      pfxBuffer,
      pfxPassword: this.config.pfxPassword,
    });

    const pool = new Pool({ connectionString: this.config.dbUrl });
    this.repository = new NFeRepository(pool);
    await this.repository.initialize();

    this.contingencia = new ContingenciaManager({
      uf: this.config.uf,
      ambiente: this.config.ambiente as '1' | '2',
    });

    this.retryHandler = new RetryHandler({
      maxRetries: this.config.maxRetries,
    });

    this.idempotencyGuard = new IdempotencyGuard(this.repository);

    const schemasDir = path.resolve(process.cwd(), 'schemas');
    this.xsdValidator = new XsdValidator(schemasDir);

    this.danfeGenerator = new DanfeGenerator();

    this.initialized = true;
  }

  buildNFe(input: FiscalContextInput): NFe {
    return buildNFe(input);
  }

  async emitir(nfe: NFe): Promise<TransmissaoResult> {
    this.ensureInitialized();

    const useCase = new TransmissaoNFeUseCase({
      xmlGenerator: new XmlGenerator(),
      signer: this.signer,
      soapClient: this.soapClient,
      repository: this.repository,
    });

    return this.retryHandler.execute(
      () => useCase.execute(nfe, this.config.uf, this.config.ambiente as TipoAmbiente),
      'TransmissaoNFe',
    );
  }

  async cancelar(chaveAcesso: string, cnpj: string, nProt: string, xJust: string): Promise<{ success: boolean; cStat: string; xMotivo: string }> {
    this.ensureInitialized();

    const useCase = new CancelamentoNFeUseCase({
      eventXmlGenerator: new EventXmlGenerator(),
      signer: this.signer,
      soapClient: this.soapClient,
      repository: this.repository,
    });

    return useCase.execute({
      chaveAcesso,
      cnpj,
      cUF: this.getCUF(),
      ambiente: this.config.ambiente,
      nSeqEvento: 1,
      dhEvento: new Date().toISOString(),
      nProt,
      xJust,
    }, this.config.uf, this.config.ambiente as '1' | '2');
  }

  async cartaCorrecao(chaveAcesso: string, cnpj: string, xCorrecao: string, nSeqEvento?: number): Promise<{ success: boolean; cStat: string; xMotivo: string }> {
    this.ensureInitialized();

    const useCase = new CartaCorrecaoUseCase({
      eventXmlGenerator: new EventXmlGenerator(),
      signer: this.signer,
      soapClient: this.soapClient,
      repository: this.repository,
    });

    return useCase.execute({
      chaveAcesso,
      cnpj,
      cUF: this.getCUF(),
      ambiente: this.config.ambiente,
      nSeqEvento: nSeqEvento ?? 1,
      dhEvento: new Date().toISOString(),
      xCorrecao,
    }, this.config.uf, this.config.ambiente as '1' | '2');
  }

  async consultar(chaveAcesso: string): Promise<{ cStat: string; xMotivo: string }> {
    this.ensureInitialized();

    const useCase = new ConsultaProtocoloUseCase(
      this.soapClient,
      this.repository,
    );

    return useCase.execute(chaveAcesso, this.config.uf, this.config.ambiente as '1' | '2');
  }

  async inutilizar(serie: string, nNFIni: string, nNFFin: string, xJust: string): Promise<InutilizacaoResult> {
    this.ensureInitialized();

    const useCase = new InutilizacaoNFeUseCase({
      xmlGenerator: new InutilizacaoXmlGenerator(),
      signer: this.signer,
      soapClient: this.soapClient,
    });

    const ano = new Date().getFullYear().toString().slice(2);

    return useCase.execute({
      tpAmb: this.config.ambiente,
      cUF: this.getCUF(),
      ano,
      cnpj: this.config.cnpjEmitente,
      mod: '55',
      serie,
      nNFIni,
      nNFFin,
      xJust,
    }, this.config.uf);
  }

  async statusServico(): Promise<StatusServicoResult> {
    this.ensureInitialized();

    const useCase = new StatusServicoUseCase({
      xmlGenerator: new StatusServicoXmlGenerator(),
      soapClient: this.soapClient,
    });

    return useCase.execute(this.config.uf, this.config.ambiente as '1' | '2', this.getCUF());
  }

  async gerarDanfe(nfe: NFe, chaveAcesso: string, nProt: string, dhRecbto: string): Promise<Buffer> {
    this.ensureInitialized();
    return this.danfeGenerator.generate({ nfe, chaveAcesso, nProt, dhRecbto });
  }

  validarXml(xml: string): { valid: boolean; errors: Array<{ message: string; path?: string }> } {
    if (!this.xsdValidator) {
      const schemasDir = path.resolve(process.cwd(), 'schemas');
      this.xsdValidator = new XsdValidator(schemasDir);
    }
    return this.xsdValidator.validate(xml);
  }

  ativarContingencia(motivo: string, dhContingencia: string): void {
    this.ensureInitialized();
    this.contingencia.ativarSvc(motivo, dhContingencia);
  }

  desativarContingencia(): void {
    this.ensureInitialized();
    this.contingencia.desativar();
  }

  isContingencia(): boolean {
    return this.contingencia?.isAtiva() ?? false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('NFeEngine nao inicializado. Chame initialize() primeiro.');
    }
  }

  private getCUF(): string {
    const UF_TO_CUF: Record<string, string> = {
      AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23',
      DF: '53', ES: '32', GO: '52', MA: '21', MG: '31', MS: '50',
      MT: '51', PA: '15', PB: '25', PE: '26', PI: '22', PR: '41',
      RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42',
      SE: '28', SP: '35', TO: '17',
    };
    return UF_TO_CUF[this.config.uf] ?? '31';
  }
}

export { NFeConfig } from './config';
export { NFe, TipoAmbiente, TipoEmissao } from './domain/models';
export { FiscalContextInput } from './domain/FiscalContext';
export { TransmissaoResult } from './application/TransmissaoNFeUseCase';
export { InutilizacaoResult } from './application/InutilizacaoNFeUseCase';
export { StatusServicoResult } from './application/StatusServicoUseCase';
