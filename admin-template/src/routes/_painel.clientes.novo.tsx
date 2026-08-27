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

const PLANOS = [
  { id: "pro", nome: "PRO — um documento, volume baixo" },
  { id: "max", nome: "MAX — NF-e e NFS-e" },
  { id: "premium", nome: "PREMIUM — com balcao (NFC-e), sem teto" },
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
    toast.success("Cliente criado.");
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
    <PainelLayout title="Novo cliente" description="A empresa que vai emitir pela sua ponte">
      <form onSubmit={enviar} className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("empresaCnpj", "CNPJ", { obrigatorio: true, dica: "So os digitos ou com pontuacao." })}
          {campo("razaoSocial", "Razao social", { obrigatorio: true })}
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
          {campo("responsavel", "Responsavel")}
          {campo("emailTecnico", "E-mail tecnico", { dica: "Quem recebe aviso de integracao." })}
        </div>

        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Depois de criar faltam quatro passos, todos na tela do cliente: dados fiscais,
          certificado A1, servicos contratados e a chave de API. Sem os quatro ele nao emite.
        </p>

        <Button type="submit" disabled={salvando}>
          {salvando && <Loader2 className="size-4 animate-spin" />}
          Criar cliente
        </Button>
      </form>
    </PainelLayout>
  );
}
