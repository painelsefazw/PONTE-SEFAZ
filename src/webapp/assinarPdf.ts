// Assina um PDF PELA EMPRESA com o certificado A1 (PAdES-B, adbe.pkcs7.detached).
//
// Para que serve: o MAGNU emite recibos de distribuição de lucros e precisa da
// assinatura da sociedade. O certificado e-CNPJ já mora aqui, cifrado, para a
// NF-e — então a assinatura do PDF sai do mesmo lugar, e a empresa não precisa
// entrar no gov.br para cada recibo. É assinatura ICP-Brasil (MP 2.200-2/2001),
// conferível em validar.iti.gov.br como qualquer outra.
//
// Como funciona (o mesmo esquema do @signpdf, escrito aqui para não trazer mais
// dependência): abre o PDF com pdf-lib, escreve a linha visível "Assinado
// digitalmente por…" na última página, cria o dicionário /Sig com /ByteRange e
// /Contents de tamanho fixo, salva SEM object streams, calcula o ByteRange real,
// faz o hash de tudo menos o buraco do /Contents, monta o CMS com o node-forge
// (SHA-256, atributos contentType/messageDigest/signingTime) e cola o hex no
// buraco. Nada fora do buraco muda depois do hash.
//
// LIMITE, de propósito: só assina PDF que ainda NÃO tem assinatura. O pdf-lib
// reescreve o arquivo inteiro, o que invalidaria uma assinatura anterior. A
// ordem que funciona é: primeiro a empresa aqui, depois o sócio no gov.br (o
// assinador do ITI acrescenta a dele por atualização incremental, sem tocar na
// nossa).
import { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, StandardFonts, rgb } from 'pdf-lib';
import * as forge from 'node-forge';

/** Bytes reservados para o CMS. Um A1 com cadeia de 3 certificados fica em ~6 KB. */
const TAM_CMS = 16384;

export interface OpcoesAssinaturaPdf {
  motivo?: string;
  local?: string;
  contato?: string;
}

export interface ResultadoAssinaturaPdf {
  pdf: Buffer;
  assinante: string;   // CN do certificado (RAZAO SOCIAL:CNPJ)
  cnpj: string;
  quando: string;      // ISO
}

interface Chaves {
  key: forge.pki.PrivateKey;
  cert: forge.pki.Certificate;
  cadeia: forge.pki.Certificate[];
}

/** Abre o .pfx e separa o certificado do titular (CN com ':') da cadeia. */
function abrirPfx(pfx: Buffer, senha: string): Chaves {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), senha);
  } catch {
    throw new Error('Nao consegui abrir o certificado A1: arquivo invalido ou senha errada.');
  }
  let key: forge.pki.PrivateKey | null = null;
  const certs: forge.pki.Certificate[] = [];
  for (const sc of p12.safeContents) {
    for (const bag of sc.safeBags) {
      if (bag.key) key = bag.key;
      else if (bag.cert) certs.push(bag.cert);
    }
  }
  if (!key) throw new Error('O certificado A1 nao tem chave privada.');
  if (!certs.length) throw new Error('O certificado A1 nao tem certificado.');
  const cn = (c: forge.pki.Certificate) => String(c.subject.getField('CN')?.value || '');
  const emissores = new Set(certs.map(c => c.issuer.hash));
  const titular = certs.find(c => cn(c).includes(':')) || certs.find(c => !emissores.has(c.subject.hash)) || certs[0];
  const agora = new Date();
  if (titular.validity.notAfter < agora) {
    throw new Error(`O certificado A1 venceu em ${titular.validity.notAfter.toISOString().slice(0, 10)}.`);
  }
  return { key, cert: titular, cadeia: certs.filter(c => c !== titular) };
}

const fmtCnpj = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;

const dataHoraBR = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  // Horário de Brasília, sem depender do fuso do servidor
  const br = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${p(br.getUTCDate())}/${p(br.getUTCMonth() + 1)}/${br.getUTCFullYear()} ${p(br.getUTCHours())}:${p(br.getUTCMinutes())} (Brasilia)`;
};

/** Texto sem acento: a Helvetica padrao do PDF so garante WinAnsi. */
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function assinarPdfComPfx(
  pdf: Buffer, pfx: Buffer, senha: string, o: OpcoesAssinaturaPdf = {},
): Promise<ResultadoAssinaturaPdf> {
  if (!pdf.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
    throw new Error('O arquivo nao e um PDF.');
  }
  if (pdf.toString('latin1').includes('/ByteRange')) {
    throw new Error('Este PDF ja tem assinatura. Assine com o A1 da empresa ANTES da assinatura do gov.br: ' +
      'a do gov.br e acrescentada por cima e preserva a nossa; o contrario nao e possivel.');
  }

  const { key, cert, cadeia } = abrirPfx(pfx, senha);
  const cn = String(cert.subject.getField('CN')?.value || '');
  const cnpj = (cn.split(':')[1] || '').replace(/\D/g, '');
  const razao = cn.split(':')[0].trim();
  const quando = new Date();

  // ── 1. A linha visivel, no rodape da ultima pagina ────────────────────
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const paginas = doc.getPages();
  const pagina = paginas[paginas.length - 1];
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteB = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = pagina.getSize();
  const linha1 = semAcento(`Assinado digitalmente por ${razao}${cnpj ? ' - CNPJ ' + fmtCnpj(cnpj) : ''} em ${dataHoraBR(quando)}`);
  const linha2 = semAcento(`Certificado ICP-Brasil (A1) - ${o.motivo || 'assinatura pela sociedade'}${o.local ? ' - ' + o.local : ''}. Confira em validar.iti.gov.br`);
  const x = 46, y = 30;
  pagina.drawRectangle({ x: x - 6, y: y - 6, width: width - 2 * (x - 6), height: 30, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.6, color: rgb(0.97, 0.97, 0.97) });
  pagina.drawText(linha1, { x, y: y + 12, size: 7.2, font: fonteB, color: rgb(0.1, 0.1, 0.1) });
  pagina.drawText(linha2, { x, y: y + 2, size: 6.6, font: fonte, color: rgb(0.25, 0.25, 0.25) });

  // ── 2. Dicionario de assinatura + widget + AcroForm ───────────────────
  const ctx = doc.context;
  const sigDict = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    // Os asteriscos sao substituidos pelos numeros reais depois de salvar,
    // mantendo o comprimento — e assim nenhum offset do arquivo se move.
    ByteRange: [PDFNumber.of(0), PDFName.of('**********'), PDFName.of('**********'), PDFName.of('**********')],
    Contents: PDFHexString.of('0'.repeat(TAM_CMS * 2)),
    Reason: PDFString.of(semAcento(o.motivo || 'Assinatura pela sociedade')),
    Location: PDFString.of(semAcento(o.local || '')),
    ContactInfo: PDFString.of(semAcento(o.contato || '')),
    Name: PDFString.of(semAcento(cn)),
    M: PDFString.fromDate(quando),
  });
  const sigRef = ctx.register(sigDict);
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [x - 6, y - 6, width - (x - 6), y + 24],
    V: sigRef,
    T: PDFString.of(`AssinaturaEmpresa${Date.now()}`),
    F: 4,
    P: pagina.ref,
  });
  const widgetRef = ctx.register(widget);
  pagina.node.addAnnot(widgetRef);
  const acro = doc.catalog.getOrCreateAcroForm();
  acro.addField(widgetRef);
  acro.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  // ── 3. Salva sem object streams e acha os pontos do arquivo ──────────
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const s = bytes.toString('latin1');
  const marca = '<' + '0'.repeat(TAM_CMS * 2) + '>';
  const iContents = s.indexOf(marca);
  if (iContents < 0) throw new Error('Nao achei o espaco reservado da assinatura no PDF salvo.');
  const brRe = /\/ByteRange\s*\[[^\]]*\]/;
  const brMatch = s.match(brRe);
  if (!brMatch || brMatch.index === undefined) throw new Error('Nao achei o /ByteRange no PDF salvo.');

  const b = iContents;                       // inicio do "<"
  const c = iContents + marca.length;        // logo depois do ">"
  const d = bytes.length - c;
  const brNovo = `/ByteRange [0 ${b} ${c} ${d}]`;
  if (brNovo.length > brMatch[0].length) throw new Error('ByteRange nao coube no espaco reservado.');
  bytes.write(brNovo.padEnd(brMatch[0].length, ' '), brMatch.index, 'latin1');

  // ── 4. Hash de tudo menos o buraco, e o CMS ───────────────────────────
  const assinado = Buffer.concat([bytes.subarray(0, b), bytes.subarray(c)]);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(assinado.toString('binary'));
  p7.addCertificate(cert);
  for (const ca of cadeia) p7.addCertificate(ca);
  p7.addSigner({
    key: key as forge.pki.rsa.PrivateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: quando as any },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  if (der.length > TAM_CMS) throw new Error(`Assinatura maior que o espaco reservado (${der.length} > ${TAM_CMS}).`);
  const hex = forge.util.bytesToHex(der).padEnd(TAM_CMS * 2, '0');
  bytes.write(hex, b + 1, 'latin1');

  return { pdf: bytes, assinante: cn, cnpj, quando: quando.toISOString() };
}
