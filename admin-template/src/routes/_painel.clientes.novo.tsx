import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { criarCliente } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tituloDaPagina } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/clientes/novo")({
  head: () => ({ meta: [{ title: tituloDaPagina("Novo cliente") }] }),
  component: NovoCliente,
});

/**
 * Os planos como o usuário os lê. O `id` é o que vai para o servidor e não
 * muda — a caixa alta e o texto aqui são apresentação.
 */
const PLANOS = [
  { id: "pro", nome: "PRO — UM DOCUMENTO, BAIXO VOLUME" },
  { id: "max", nome: "MAX — NF-e E NFS-e" },
  { id: "premium", nome: "PREMIUM — COM BALCÃO (NFC-e), SEM TETO" },
];

function NovoCliente() {
  const criar = useServerFn(criarCliente);
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({ plano: "pro" });
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const r = await criar({ data: { cliente: form } });
    setSalvando(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Cliente criado com sucesso.");
    // O cadastro sozinho nao emite nada: faltam dados fiscais, certificado,
    // servico e chave. Levar direto ao detalhe e onde esses passos estao.
    await router.navigate({
      to: "/clientes/$cnpj",
      params: { cnpj: (form["empresaCnpj"] ?? "").replace(/\D/g, "") },
    });
  }

  const campo = (nome: string, rotulo: string, extra?: { obrigatorio?: boolean; dica?: string }) => (
    <div className="space-y-2">
      <Label htmlFor={nome}>{rotulo}</Label>
      <Input
        id={nome}
        required={extra?.obrigatorio}
        value={form[nome] ?? ""}
        onChange={(e) => setForm({ ...form, [nome]: e.target.value })}
      />
      {extra?.dica && <p className="text-xs text-muted-foreground">{extra.dica}</p>}
    </div>
  );

  return (
    <PainelLayout title="Novo cliente" description="Cadastre a empresa que emitirá documentos fiscais por meio da sua ponte.">
      <form onSubmit={enviar} className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("empresaCnpj", "CNPJ", {
            obrigatorio: true,
            dica: "Informe somente os números, com ou sem pontuação.",
          })}
          {campo("razaoSocial", "Razão social", { obrigatorio: true })}
          {campo("fantasia", "Nome fantasia")}
          <div className="space-y-2">
            <Label htmlFor="plano">Plano</Label>
            <select
              id="plano"
              value={form["plano"] ?? "pro"}
              onChange={(e) => setForm({ ...form, plano: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring"
            >
              {PLANOS.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          {campo("responsavel", "Responsável")}
          {campo("emailTecnico", "E-mail técnico", {
            dica: "Informe o e-mail da pessoa que receberá os avisos de integração.",
          })}
        </div>

        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Após criar o cliente, conclua quatro etapas na tela do cliente: cadastre os dados
          fiscais, envie o certificado A1, informe os serviços contratados e gere a chave de
          API. Sem concluir essas quatro etapas, o cliente não poderá emitir documentos
          fiscais.
        </p>

        <Button type="submit" disabled={salvando}>
          {salvando && <Loader2 className="size-4 animate-spin" />}
          Criar cliente
        </Button>
      </form>
    </PainelLayout>
  );
}
