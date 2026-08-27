import { spawn } from 'child_process';
import * as path from 'path';
import axios from 'axios';

export interface DanfePhpOptions {
  /** Executável do PHP. Default: 'php' (precisa estar no PATH — ex.: XAMPP C:\\xampp\\php). */
  phpBin?: string;
  /** Caminho do danfe.php. Default: ao lado deste arquivo. */
  scriptPath?: string;
  /** Timeout em ms. Default: 30000. */
  timeoutMs?: number;
  /** Logo do emitente (PNG/JPG), opcional. */
  logoPath?: string;
  /**
   * URL do serviço DANFE em HTTP (ex.: deploy PHP separado na Vercel).
   * Quando definido, o PDF é gerado via POST (XML no corpo) em vez de
   * rodar PHP localmente — necessário em serverless Node (Vercel) que não tem PHP.
   */
  serviceUrl?: string;
  /** Chave compartilhada opcional (header x-danfe-key) exigida pelo serviço HTTP. */
  serviceKey?: string;
}

/**
 * Gera o PDF do DANFE a partir de um XML de NF-e autorizada, delegando para o
 * pacote homologado nfephp-org/sped-da.
 *
 * Dois modos:
 *  - HTTP  (serviceUrl definido): POST do XML para o serviço PHP remoto (Vercel).
 *  - CLI   (default): roda o danfe.php local via child_process (XML no stdin, PDF no stdout).
 *
 * A saída é sempre Promise<Buffer> (mesma assinatura do DanfeGenerator atual).
 */
export class DanfePhpService {
  private readonly phpBin: string;
  private readonly scriptPath: string;
  private readonly timeoutMs: number;
  private readonly logoPath?: string;
  private readonly serviceUrl?: string;
  private readonly serviceKey?: string;

  constructor(opts: DanfePhpOptions = {}) {
    this.phpBin = opts.phpBin ?? 'php';
    this.scriptPath = opts.scriptPath ?? path.join(__dirname, 'danfe.php');
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.logoPath = opts.logoPath;
    this.serviceUrl = opts.serviceUrl;
    this.serviceKey = opts.serviceKey;
  }

  /** Recebe o XML (NFe ou nfeProc autorizado) e resolve com o Buffer do PDF. */
  generateFromXml(xml: string): Promise<Buffer> {
    return this.serviceUrl ? this.generateViaHttp(xml) : this.generateViaCli(xml);
  }

  /** Modo HTTP: POST do XML para o serviço DANFE remoto. */
  private async generateViaHttp(xml: string): Promise<Buffer> {
    const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
    if (this.serviceKey) headers['x-danfe-key'] = this.serviceKey;
    try {
      const res = await axios.post(this.serviceUrl as string, xml, {
        headers,
        timeout: this.timeoutMs,
        responseType: 'arraybuffer',
        validateStatus: (s) => s >= 200 && s < 300,
        maxContentLength: 25 * 1024 * 1024,
        maxBodyLength: 25 * 1024 * 1024,
      });
      return Buffer.from(res.data);
    } catch (e: any) {
      // o serviço responde erro como JSON {"ok":false,"error":"..."}
      let msg = e?.message || 'erro desconhecido';
      const data = e?.response?.data;
      if (data) {
        try {
          const j = JSON.parse(Buffer.from(data).toString('utf8'));
          if (j?.error) msg = j.error;
        } catch { /* corpo não era JSON */ }
      }
      throw new Error(`DANFE (HTTP): ${msg}`);
    }
  }

  /** Modo CLI: roda o danfe.php local (XML pelo stdin, PDF pelo stdout — sem arquivos temporários). */
  private generateViaCli(xml: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [this.scriptPath];
      if (this.logoPath) {
        args.push('--logo', this.logoPath);
      }

      const child = spawn(this.phpBin, args, { windowsHide: true });
      const out: Buffer[] = [];
      const err: Buffer[] = [];

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`DANFE: tempo esgotado (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => err.push(d));

      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`DANFE: falha ao executar PHP (${this.phpBin}): ${e.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(Buffer.concat(out));
        } else {
          const stderr = Buffer.concat(err).toString('utf8').trim();
          let msg = stderr;
          try {
            const parsed = JSON.parse(stderr);
            if (parsed && parsed.error) msg = parsed.error;
          } catch {
            /* stderr não era JSON — usa como está */
          }
          reject(new Error(msg || `DANFE: danfe.php saiu com código ${code}`));
        }
      });

      child.stdin.write(xml, 'utf8');
      child.stdin.end();
    });
  }
}
