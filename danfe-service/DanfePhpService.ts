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
/** A logomarca do emitente, que o XML da NF-e nao carrega. */
export interface MarcaDoEmitente {
  /** PNG ou JPG em base64, sem o prefixo `data:`. */
  logoBase64: string;
  /** `L` esquerda, `C` centro, `R` direita — dentro do quadro do emitente. */
  posicao?: 'L' | 'C' | 'R';
}

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

  /**
   * Recebe o XML (NFe ou nfeProc autorizado) e resolve com o Buffer do PDF.
   *
   * `marca` e a logomarca do emitente. Ela nao vem do XML — o leiaute da NF-e
   * nao carrega imagem — entao precisa viajar por fora, e por isso e parametro
   * aqui em vez de sair de dentro do documento.
   */
  async generateFromXml(xml: string, marca?: MarcaDoEmitente): Promise<Buffer> {
    if (!this.serviceUrl) return this.generateViaCli(xml);
    if (!marca?.logoBase64) return this.generateViaHttp(xml);

    try {
      return await this.generateViaHttp(xml, marca);
    } catch (erro) {
      /**
       * Logo nao derruba nota.
       *
       * Ha varios jeitos de a logo falhar do lado do servico e nenhum deles e
       * culpa da nota: a extensao `gd` do PHP pode nao estar carregada naquele
       * deploy (e nela que a biblioteca desenha PNG com transparencia), o
       * servico pode estar numa versao anterior que nao entende o corpo JSON,
       * ou a imagem pode ser um PNG que a biblioteca recusa.
       *
       * Em todos, o certo e a mesma coisa: emitir o DANFE sem a logo. Um
       * documento fiscal sem enfeite serve; um documento que nao sai, nao.
       */
      return this.generateViaHttp(xml);
    }
  }

  /**
   * Modo HTTP: POST para o serviço DANFE remoto.
   *
   * Sem logo, o corpo continua sendo o XML cru — exatamente como antes. Isso
   * nao e economia de codigo: o serviço roda num deploy separado, que pode
   * estar numa versao anterior, e um corpo novo enviado a um serviço antigo
   * quebraria TODA a emissao de DANFE. Mandando JSON so quando ha logo, quem
   * nao usa logo nao corre risco nenhum.
   */
  private async generateViaHttp(xml: string, marca?: MarcaDoEmitente): Promise<Buffer> {
    const comLogo = Boolean(marca?.logoBase64);
    const headers: Record<string, string> = {
      'Content-Type': comLogo ? 'application/json' : 'application/xml',
    };
    if (this.serviceKey) headers['x-danfe-key'] = this.serviceKey;
    const corpo: unknown = comLogo
      ? { xml, logo: marca?.logoBase64, posicao: marca?.posicao ?? 'L' }
      : xml;
    try {
      const res = await axios.post(this.serviceUrl as string, corpo, {
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
