import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";
import { baixarDocumento } from "@/lib/fiscal.functions";
import { salvarArquivo } from "@/lib/download";
import { Button } from "@/components/ui/button";

/**
 * Baixar o XML e o PDF de um documento emitido.
 *
 * O XML é o documento fiscal — o PDF é só a representação gráfica dele. Sem o
 * XML o cliente não tem o que entregar à contabilidade, não escritura e não
 * prova a operação. Por isso os dois aparecem juntos e em todo lugar onde um
 * documento é listado ou aberto.
 *
 * O arquivo vem pelo servidor, nunca por link direto: a chave da API é
 * server-side e um link a exporia na barra de endereços e no histórico.
 */
export function BaixarDocumento({
  tipo,
  chave,
  tamanho = "default",
}: {
  tipo: "nfe" | "nfce" | "nfse";
  chave: string;
  tamanho?: "default" | "sm";
}) {
  const baixar = useServerFn(baixarDocumento);
  const [ocupado, setOcupado] = useState<"xml" | "pdf" | null>(null);

  async function pegar(formato: "xml" | "pdf") {
    setOcupado(formato);
    try {
      const r = await baixar({ data: { tipo, chave, formato } });
      if (!r.ok) { toast.error(r.error); return; }
      salvarArquivo(r.data.nome, r.data.tipo, r.data.base64);
      toast.success(`${r.data.nome} baixado.`);
    } catch {
      toast.error("Nao foi possivel baixar o arquivo.");
    } finally {
      setOcupado(null);
    }
  }

  // A NFS-e não tem "DANFE" — o documento dela chama DANFSE, e usar o nome
  // errado faz o operador procurar um botão que não existe.
  // O cupom nao imprime DANFE: imprime o cupom. Chamar de DANFE no balcao
  // manda a pessoa procurar um documento que ela nao conhece por esse nome.
  const rotuloPdf = tipo === "nfse" ? "DANFSE" : tipo === "nfce" ? "Cupom" : "DANFE";

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size={tamanho}
        disabled={ocupado !== null}
        onClick={() => pegar("xml")}
        title="O XML e o documento fiscal — e ele que vai para a contabilidade"
      >
        {ocupado === "xml" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        XML
      </Button>
      <Button
        type="button"
        variant="outline"
        size={tamanho}
        disabled={ocupado !== null}
        onClick={() => pegar("pdf")}
        title={`${rotuloPdf} em PDF, para imprimir ou acompanhar a mercadoria`}
      >
        {ocupado === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {rotuloPdf}
      </Button>
    </div>
  );
}
