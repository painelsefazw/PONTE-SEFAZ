import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2, Save, Trash2 } from "lucide-react";
import {
  obterMarcaDoDanfe, salvarMarcaDoDanfe, removerMarcaDoDanfe,
  LIMITE_DO_TEXTO,
} from "@/lib/danfe.functions";
import { manifest, formatCnpj } from "@/lib/manifest";
import { PainelLayout } from "@/components/app/PainelLayout";
import { ErrorState, LoadingState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Os parâmetros do DANFE: o que sai impresso além dos dados da nota.
 *
 * São dois campos que o XML não carrega e que, por isso, nunca chegavam ao
 * papel: a logomarca (o quadro do emitente ficava vazio em toda nota) e o texto
 * fixo da empresa (que era redigitado a cada emissão, ou esquecido). Ficam
 * juntos porque a pergunta é uma só — "como fica a MINHA nota impressa" — e
 * porque é o mesmo lugar onde o SisWeb os coloca, que é onde quem já usou
 * sistema fiscal vai procurar.
 */

export const Route = createFileRoute("/_painel/parametros")({ component: Parametros });

const POSICOES: [("L" | "C" | "R"), string][] = [
  ["L", "Esquerda"],
  ["C", "Centro"],
  ["R", "Direita"],
];

/** 400 KB — o mesmo teto do servidor, conferido antes de subir o arquivo. */
const LIMITE_DA_LOGO = 400 * 1024;

/** JPEG começa com `FF D8 FF`, que em base64 é sempre `/9j/`. */
function tipoDaImagem(base64: string): string {
  return base64.startsWith("/9j/") ? "image/jpeg" : "image/png";
}

/**
 * Achata a imagem em JPEG sobre fundo branco.
 *
 * O serviço que desenha o DANFE roda no runtime PHP da Vercel, que não traz a
 * extensão `gd` — e não há como ligá-la: ela não existe em versão nenhuma do
 * runtime. Sem `gd`, a imagem cai direto no FPDF, que recusa PNG com
 * transparência, com 16 bits por canal ou entrelaçado. E recusa em silêncio: a
 * nota sai autorizada, apenas sem a logo — o defeito que ninguém reporta.
 *
 * Converter aqui resolve os três casos e não perde nada, porque o DANFE é
 * impresso em papel branco: a transparência viraria branco de qualquer forma.
 */
function achatarParaJpeg(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("O arquivo não é uma imagem válida."));
      img.onload = () => {
        // O quadro do emitente ocupa cerca de um terço da largura do DANFE;
        // acima de 900px só se paga transferência por pixel que não aparece.
        const escala = Math.min(1, 900 / (img.width || 1));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * escala));
        c.height = Math.max(1, Math.round(img.height * escala));
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("O navegador não permitiu preparar a imagem."));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.92));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  });
}

function Parametros() {
  const obter = useServerFn(obterMarcaDoDanfe);
  const salvar = useServerFn(salvarMarcaDoDanfe);
  const remover = useServerFn(removerMarcaDoDanfe);
  const qc = useQueryClient();

  const query = useQuery({ queryKey: ["danfe-marca"], queryFn: () => obter() });
  const marca = query.data?.ok ? query.data.data : undefined;

  return (
    <PainelLayout
      title="Parâmetros do DANFE"
      description="A logo e o texto fixo que saem impressos em toda nota desta empresa."
    >
      {query.isLoading ? (
        <LoadingState label="Carregando parâmetros..." />
      ) : query.data && !query.data.ok ? (
        <ErrorState message={query.data.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-6">
            <CartaoLogo
              logo={marca?.logoBase64}
              posicao={marca?.posicao ?? "L"}
              onSalvar={async (dados) => {
                const r = await salvar({ data: dados });
                if (!r.ok) { toast.error(r.error); return false; }
                toast.success("Logo salva. Vale para as notas emitidas a partir de agora.");
                qc.invalidateQueries({ queryKey: ["danfe-marca"] });
                return true;
              }}
              onRemover={async () => {
                const r = await salvar({ data: { logoBase64: "" } });
                if (!r.ok) { toast.error(r.error); return; }
                toast.success("Logo removida.");
                qc.invalidateQueries({ queryKey: ["danfe-marca"] });
              }}
            />
            <CartaoTexto
              texto={marca?.textoPadrao ?? ""}
              onSalvar={async (textoPadrao) => {
                const r = await salvar({ data: { textoPadrao } });
                if (!r.ok) { toast.error(r.error); return false; }
                toast.success(textoPadrao
                  ? "Texto salvo. Ele acompanha toda nota emitida a partir de agora."
                  : "Texto removido.");
                qc.invalidateQueries({ queryKey: ["danfe-marca"] });
                return true;
              }}
            />
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="text-sm font-semibold">Limpar tudo</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Volta ao padrão: sem logo e sem texto fixo. As notas já emitidas não mudam —
                o DANFE delas foi gerado com o que valia na época.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={async () => {
                  if (!confirm("Remover a logo e o texto fixo desta empresa?")) return;
                  const r = await remover();
                  if (!r.ok) { toast.error(r.error); return; }
                  toast.success("Parâmetros do DANFE limpos.");
                  qc.invalidateQueries({ queryKey: ["danfe-marca"] });
                }}
              >
                <Trash2 className="size-4" /> Limpar parâmetros
              </Button>
            </div>
          </div>

          <PreviaDanfe logo={marca?.logoBase64} posicao={marca?.posicao ?? "L"} texto={marca?.textoPadrao ?? ""} />
        </div>
      )}
    </PainelLayout>
  );
}

// ───────────────────────────── Logo ─────────────────────────────

function CartaoLogo({ logo, posicao, onSalvar, onRemover }: {
  logo?: string | undefined;
  posicao: "L" | "C" | "R";
  onSalvar: (d: { logoBase64?: string; posicao?: "L" | "C" | "R" }) => Promise<boolean>;
  onRemover: () => Promise<void>;
}) {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [nova, setNova] = useState<string | null>(null);
  const [pos, setPos] = useState<"L" | "C" | "R">(posicao);
  const [salvando, setSalvando] = useState(false);

  const mostrada = nova ?? (logo ? `data:${tipoDaImagem(logo)};base64,${logo}` : null);
  const mudou = nova !== null || pos !== posicao;

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    // Conferir aqui evita subir 3 MB para receber a recusa depois — e o
    // servidor confere de novo, porque a tela não é a autoridade.
    if (!/^image\/(png|jpeg)$/.test(arquivo.type)) {
      toast.error("Use PNG ou JPG. SVG e WEBP não são desenhados no DANFE.");
      return;
    }
    if (arquivo.size > LIMITE_DA_LOGO) {
      toast.error(`A imagem tem ${Math.round(arquivo.size / 1024)} KB e o limite é 400 KB. `
        + "Reduza para algo em torno de 600x200 pixels.");
      return;
    }
    try {
      setNova(await achatarParaJpeg(arquivo));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível preparar a imagem.");
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h3 className="text-sm font-semibold">Logomarca</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Sai no quadro do emitente, ao lado da razão social. PNG ou JPG, até 400 KB —
          o ideal é algo em torno de 600×200 pixels. A transparência é achatada em branco,
          que é a cor do papel em que o DANFE sai.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-48 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-2">
          {mostrada ? (
            <img src={mostrada} alt="Logo do DANFE" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">Sem logo</span>
          )}
        </div>
        <div className="space-y-2">
          <input
            ref={arquivoRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => escolher(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" onClick={() => arquivoRef.current?.click()}>
            <ImageUp className="size-4" /> Escolher imagem
          </Button>
          {logo && (
            <Button
              type="button" variant="ghost" size="sm" className="block"
              onClick={async () => { setNova(null); await onRemover(); }}
            >
              <Trash2 className="size-4" /> Remover logo
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Posição dentro do quadro</Label>
        <div className="flex gap-1">
          {POSICOES.map(([id, texto]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPos(id)}
              className={`rounded-md border px-3 py-1.5 text-sm transition ${
                pos === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <Button
        type="button"
        disabled={!mudou || salvando}
        onClick={async () => {
          setSalvando(true);
          const ok = await onSalvar({
            ...(nova !== null ? { logoBase64: nova } : {}),
            posicao: pos,
          });
          setSalvando(false);
          if (ok) setNova(null);
        }}
      >
        {salvando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar logo
      </Button>
    </div>
  );
}

// ───────────────────────────── Texto fixo ─────────────────────────────

function CartaoTexto({ texto, onSalvar }: {
  texto: string;
  onSalvar: (t: string) => Promise<boolean>;
}) {
  const [valor, setValor] = useState(texto);
  const [salvando, setSalvando] = useState(false);
  const excedeu = valor.length > LIMITE_DO_TEXTO;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h3 className="text-sm font-semibold">Texto fixo da nota</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Sai em <strong>Informações complementares</strong>, o quadro de baixo do DANFE. É onde
          entra o que se repete em toda nota: dados bancários, prazo de garantia, a frase que a
          contabilidade pede. Quando a emissão já traz um texto próprio, os dois saem — o da nota
          primeiro.
        </p>
      </div>

      <textarea
        rows={6}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={"Ex.: Pagamento via PIX CNPJ " + formatCnpj(manifest.company.cnpj)
          + "\nGarantia de 90 dias contra defeitos de fabricacao."}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />

      <div className="flex items-center justify-between gap-4">
        <p className={`text-xs ${excedeu ? "text-destructive" : "text-muted-foreground"}`}>
          {valor.length} de {LIMITE_DO_TEXTO} caracteres
          {excedeu && " — acima disso a SEFAZ rejeita a nota."}
        </p>
        <Button
          type="button"
          disabled={valor === texto || excedeu || salvando}
          onClick={async () => {
            setSalvando(true);
            const ok = await onSalvar(valor);
            setSalvando(false);
            if (!ok) setValor(texto);
          }}
        >
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar texto
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────────── Prévia ─────────────────────────────

/**
 * Um DANFE de mentira, com os quadros de verdade.
 *
 * Não é enfeite: sem ele, a única forma de saber se a logo ficou grande demais
 * ou torta é emitir uma nota — e nota emitida não se desfaz, só se cancela.
 */
function PreviaDanfe({ logo, posicao, texto }: {
  logo?: string | undefined;
  posicao: "L" | "C" | "R";
  texto: string;
}) {
  const alinhamento = posicao === "C" ? "justify-center" : posicao === "R" ? "justify-end" : "justify-start";

  return (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold">Como fica impresso</h3>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Só os quadros afetados. O resto do DANFE não muda.
        </p>

        <div className="space-y-2 rounded-lg border border-border bg-background p-3 text-[10px] leading-tight">
          <div className="border border-border p-2">
            <p className="mb-1 text-[8px] uppercase tracking-wide text-muted-foreground">
              Identificação do emitente
            </p>
            <div className={`flex items-center gap-2 ${alinhamento}`}>
              {logo ? (
                <img
                  src={`data:image/png;base64,${logo}`}
                  alt=""
                  className="max-h-8 max-w-[5rem] object-contain"
                />
              ) : (
                <span className="text-muted-foreground">[sem logo]</span>
              )}
            </div>
            <p className="mt-1 font-semibold">{manifest.company.name}</p>
            <p className="text-muted-foreground">CNPJ {formatCnpj(manifest.company.cnpj)}</p>
          </div>

          <div className="border border-border p-2">
            <p className="mb-1 text-[8px] uppercase tracking-wide text-muted-foreground">
              Dados adicionais / Informações complementares
            </p>
            {texto ? (
              <p className="whitespace-pre-wrap break-words">{texto}</p>
            ) : (
              <p className="text-muted-foreground">[vazio — só o que vier na emissão]</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
