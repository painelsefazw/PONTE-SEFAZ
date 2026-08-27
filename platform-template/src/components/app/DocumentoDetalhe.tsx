import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { obterDocumento, cancelarDocumento, cartaCorrecao } from "@/lib/fiscal.functions";
import { LoadingState, ErrorState, StatusBadge } from "@/components/app/states";
import { BaixarDocumento } from "@/components/app/BaixarDocumento";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate, docNumero } from "@/lib/format";

export function DocumentoDetalhe({ tipo, id }: { tipo: "nfe" | "nfce" | "nfse"; id: string }) {
  const obter = useServerFn(obterDocumento);
  const cancelar = useServerFn(cancelarDocumento);
  const corrigir = useServerFn(cartaCorrecao);
  const qc = useQueryClient();
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [correcao, setCorrecao] = useState("");
  const [sequencia, setSequencia] = useState("1");
  const [corrigindo, setCorrigindo] = useState(false);

  const query = useQuery({
    queryKey: ["doc", tipo, id],
    queryFn: () => obter({ data: { tipo, id } }),
  });

  async function onCancelar() {
    if (justificativa.trim().length < 15) {
      toast.error("A justificativa deve ter ao menos 15 caracteres.");
      return;
    }
    setEnviando(true);
    try {
      // O protocolo de autorização vai junto: a API exige os dois para casar
      // o evento de cancelamento com a nota.
      const carregado = query.data?.ok ? query.data.data : null;
      const protocolo = carregado?.protocolo ? String(carregado.protocolo) : undefined;
      // O ambiente e o da NOTA, nao o do cadastro da empresa. Sem ele o evento
      // ia para o ambiente errado e voltava como "nota nao encontrada".
      const ambienteDaNota = carregado?.ambiente === "2" ? "2" : "1";
      const res = await cancelar({
        data: {
          tipo, id, justificativa, ambiente: ambienteDaNota,
          ...(protocolo ? { protocolo } : {}),
        },
      });
      if (res.ok) {
        toast.success("Solicitacao de cancelamento enviada.");
        setJustificativa("");
        qc.invalidateQueries({ queryKey: ["doc", tipo, id] });
        qc.invalidateQueries({ queryKey: ["docs", tipo] });
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Nao foi possivel cancelar o documento.");
    } finally {
      setEnviando(false);
    }
  }

  async function onCorrigir() {
    if (correcao.trim().length < 15) {
      toast.error("A correcao deve ter ao menos 15 caracteres.");
      return;
    }
    setCorrigindo(true);
    try {
      const carregado = query.data?.ok ? query.data.data : null;
      const ambienteDaNota = carregado?.ambiente === "2" ? "2" : "1";
      const res = await corrigir({
        data: {
          chave: id,
          correcao,
          sequencia: Number(sequencia) || 1,
          ambiente: ambienteDaNota,
        },
      });
      if (res.ok) {
        toast.success("Carta de correcao registrada na SEFAZ.");
        // A sequencia avanca sozinha: a proxima carta desta nota precisa de um
        // numero maior, e ninguem lembra disso na hora.
        setSequencia(String((Number(sequencia) || 1) + 1));
        qc.invalidateQueries({ queryKey: ["doc", tipo, id] });
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Nao foi possivel enviar a carta de correcao.");
    } finally {
      setCorrigindo(false);
    }
  }

  if (query.isLoading) return <LoadingState label="Carregando documento..." />;
  if (query.isError || (query.data && !query.data.ok))
    return (
      <ErrorState
        message={query.data && !query.data.ok ? query.data.error : "Falha ao carregar."}
        onRetry={() => query.refetch()}
      />
    );

  const doc = query.data?.ok ? query.data.data : null;
  if (!doc) return <ErrorState message="Documento nao encontrado." />;

  const campos: Array<[string, string]> = [
    ["Documento", docNumero(doc)],
    [tipo === "nfe" ? "Destinatario" : "Tomador", String(doc.destinatario ?? doc.tomador ?? "-")],
    ["Chave", String(doc.chave ?? "-")],
    ["Emissao", formatDate(doc.emitidoEm)],
    ["Valor", formatCurrency(doc.valor)],
  ];

  const homologacao = String(doc.ambiente ?? "1") === "2";
  // Nota cancelada nao aceita carta: nao ha o que corrigir num documento que
  // deixou de existir. Esconder e melhor que deixar o botao dar erro da SEFAZ.
  const cancelada = String(doc.status ?? "").toUpperCase().includes("CANCEL");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Aberto por link ou impresso, o documento continua tendo de dizer o que
          é. Nota de homologação não vale nada, e confundi-la com uma real leva
          a escriturar o que não existe — ou a cancelar o que não precisa. */}
      {homologacao && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 lg:col-span-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Documento de homologacao — SEM VALOR FISCAL.</strong> Foi
            validado pela SEFAZ, mas nao existe fiscalmente: nao vai para a
            contabilidade, nao gera imposto e nao precisa ser cancelado.
          </span>
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Dados do documento</h2>
          <StatusBadge status={doc.status as string | undefined} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          {campos.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-all text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        {/* O documento pertence ao cliente. O XML é o que vale fiscalmente e é
            o que a contabilidade pede; o PDF é para imprimir e acompanhar a
            mercadoria. Sem isto a plataforma emite e não entrega. */}
        {doc.chave && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs uppercase text-muted-foreground">Arquivos do documento</p>
            <BaixarDocumento tipo={tipo} chave={String(doc.chave)} />
            <p className="mt-2 text-xs text-muted-foreground">
              O XML e o documento fiscal — guarde-o e entregue a contabilidade.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Cancelar documento</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Informe a justificativa exigida pela SEFAZ (minimo 15 caracteres).
        </p>
        <div className="mt-4 space-y-3">
          <Label htmlFor="justificativa">Justificativa</Label>
          <Textarea
            id="justificativa"
            rows={4}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Descreva o motivo do cancelamento"
          />
          <Button variant="destructive" className="w-full" disabled={enviando} onClick={onCancelar}>
            {enviando ? "Enviando..." : "Solicitar cancelamento"}
          </Button>
        </div>
      </section>

      {/* Carta de correção — só NF-e. A NFS-e não tem evento equivalente: lá o
          conserto é substituir a nota.

          Não existia no site, e é a operação fiscal mais comum do dia a dia:
          endereço errado, descrição trocada, dado cadastral. Sem ela, a única
          saída era cancelar uma nota boa e emitir de novo — o que, passadas as
          24h de prazo do cancelamento, nem possível é. */}
      {tipo === "nfe" && cancelada === false && (
        <section className="rounded-xl border border-border bg-card p-6 lg:col-span-3">
          <h2 className="text-sm font-semibold">Carta de correcao (CC-e)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Corrige a nota sem cancelar. <strong>Nao serve</strong> para valor, imposto,
            quantidade, data de emissao nem para trocar o destinatario — nesses casos a SEFAZ
            recusa, e o caminho e cancelar e emitir de novo.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="correcao">Texto da correcao</Label>
              <Textarea
                id="correcao"
                rows={3}
                value={correcao}
                onChange={(e) => setCorrecao(e.target.value)}
                placeholder="Ex.: No campo Endereco do destinatario, onde se le RUA A, leia-se RUA B."
              />
              <p className="text-xs text-muted-foreground">
                {correcao.trim().length < 15
                  ? `Faltam ${15 - correcao.trim().length} caracteres para o minimo da SEFAZ.`
                  : "Escreva o texto COMPLETO: a ultima carta substitui as anteriores."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sequencia">Sequencia</Label>
              <Input
                id="sequencia"
                inputMode="numeric"
                value={sequencia}
                onChange={(e) => setSequencia(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-xs text-muted-foreground">
                1 na primeira carta desta nota; 2 na seguinte, e assim por diante.
              </p>
            </div>
          </div>

          <Button
            className="mt-4"
            disabled={corrigindo || correcao.trim().length < 15}
            onClick={onCorrigir}
          >
            {corrigindo ? "Enviando..." : "Enviar carta de correcao"}
          </Button>
        </section>
      )}
    </div>
  );
}
