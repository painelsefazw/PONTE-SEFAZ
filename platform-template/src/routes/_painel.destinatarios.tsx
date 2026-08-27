import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HardDrive, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import {
  destinatarios,
  filtrar,
  formatarDocumento,
  type Destinatario,
  type DestinatarioNovo,
} from "@/lib/cadastros";
import { PainelLayout } from "@/components/app/PainelLayout";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_painel/destinatarios")({ component: Destinatarios });

const VAZIO: DestinatarioNovo = {
  tipo: "pj", nome: "", documento: "", indIEDest: "9", ie: "", email: "",
  logradouro: "", numero: "", bairro: "", municipio: "", codigoMunicipio: "",
  uf: "", cep: "",
};

const TIPOS_IE = [
  { valor: "1", texto: "Contribuinte de ICMS (tem IE)" },
  { valor: "2", texto: "Contribuinte isento de IE" },
  { valor: "9", texto: "Nao contribuinte" },
];

/**
 * Cadastro de quem recebe as notas.
 *
 * Existe para não redigitar nove campos a cada nota para o mesmo cliente — e
 * errar um deles volta como rejeição da SEFAZ, depois de a nota já ter sido
 * montada e transmitida.
 */
function Destinatarios() {
  const [lista, setLista] = useState<Destinatario[]>([]);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<DestinatarioNovo>(VAZIO);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);

  async function recarregar() {
    setCarregando(true);
    try { setLista(await destinatarios.listar()); }
    finally { setCarregando(false); }
  }

  useEffect(() => { void recarregar(); }, []);

  const set = (campo: keyof DestinatarioNovo, valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  function abrirNovo() {
    setForm(VAZIO);
    setEditando(null);
    setAberto(true);
  }

  function abrirEdicao(d: Destinatario) {
    setForm({
      tipo: d.tipo, nome: d.nome, documento: d.documento, indIEDest: d.indIEDest,
      ie: d.ie ?? "", email: d.email ?? "", logradouro: d.logradouro, numero: d.numero,
      bairro: d.bairro, municipio: d.municipio, codigoMunicipio: d.codigoMunicipio,
      uf: d.uf, cep: d.cep,
    });
    setEditando(d.id);
    setAberto(true);
  }

  function validar(): string | null {
    if (!form.nome.trim()) return "Informe o nome ou a razao social.";
    const doc = form.documento.replace(/\D/g, "");
    if (doc.length !== 11 && doc.length !== 14) return "O documento tem 11 digitos (CPF) ou 14 (CNPJ).";
    if (!form.logradouro.trim() || !form.bairro.trim()) return "Logradouro e bairro sao obrigatorios.";
    if (form.codigoMunicipio.replace(/\D/g, "").length !== 7) {
      return "O codigo IBGE do municipio tem 7 digitos. E ele que a SEFAZ confere, nao o nome.";
    }
    if (form.uf.trim().length !== 2) return "Informe a UF com 2 letras.";
    if (form.cep.replace(/\D/g, "").length !== 8) return "O CEP tem 8 digitos.";
    if (form.indIEDest === "1" && !String(form.ie ?? "").trim()) {
      return "Contribuinte de ICMS precisa da Inscricao Estadual.";
    }
    return null;
  }

  async function salvar() {
    const problema = validar();
    if (problema) { toast.error(problema); return; }
    try {
      const doc = form.documento.replace(/\D/g, "");
      await destinatarios.salvar({ ...form, tipo: doc.length === 11 ? "pf" : "pj" }, editando ?? undefined);
      toast.success(editando ? "Destinatario atualizado." : "Destinatario cadastrado.");
      setAberto(false);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nao foi possivel salvar.");
    }
  }

  async function remover(d: Destinatario) {
    if (!confirm(`Remover ${d.nome} do cadastro? As notas ja emitidas nao mudam.`)) return;
    await destinatarios.remover(d.id);
    toast.success("Removido.");
    await recarregar();
  }

  const filtrados = filtrar(lista, busca);

  return (
    <PainelLayout
      title="Destinatarios"
      description="Quem recebe as notas. Cadastre uma vez e reaproveite a cada emissao."
      actions={<Button size="sm" onClick={abrirNovo}><Plus className="size-4" /> Novo</Button>}
    >
      <div className="space-y-4">
        {/* Onde os dados moram nao pode ser surpresa: quem cadastra cem clientes
            e depois troca de computador precisa saber disso antes, nao depois. */}
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <HardDrive className="mt-0.5 size-4 shrink-0" />
          <span>
            Este cadastro fica guardado <strong>neste navegador</strong>. Outro computador
            nao enxerga, e limpar os dados do navegador apaga. As notas ja emitidas
            nao dependem dele — elas ficam na API.
          </span>
        </p>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Nome, CPF/CNPJ ou municipio"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {carregando ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : filtrados.length === 0 ? (
          <EmptyState
            title={lista.length === 0 ? "Nenhum destinatario cadastrado" : "Nada encontrado"}
            description={
              lista.length === 0
                ? "Cadastre aqui, ou preencha uma nota e use Salvar destinatario na tela de emissao."
                : "Tente outro termo de busca."
            }
            action={lista.length === 0 ? <Button size="sm" onClick={abrirNovo}>Cadastrar o primeiro</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Documento</th>
                  <th className="px-4 py-3 font-medium">Municipio</th>
                  <th className="px-4 py-3 font-medium">Notas</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtrados.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.nome}</div>
                      {d.ie && <div className="text-xs text-muted-foreground">IE {d.ie}</div>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatarDocumento(d.documento)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.municipio}/{d.uf}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{d.usos || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => abrirEdicao(d)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remover(d)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[6vh]"
          role="dialog"
          aria-modal="true"
          onClick={() => setAberto(false)}
        >
          <div
            className="w-full max-w-2xl space-y-5 rounded-xl border border-border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Users className="size-5" />
              {editando ? "Editar destinatario" : "Novo destinatario"}
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Nome / Razao social" span={2}>
                <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} />
              </Campo>
              <Campo label="CPF / CNPJ" dica="So os digitos; o tipo sai do tamanho.">
                <Input value={form.documento} onChange={(e) => set("documento", e.target.value)} />
              </Campo>

              <Campo label="Tipo" span={2}>
                <select
                  value={form.indIEDest}
                  onChange={(e) => set("indIEDest", e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {TIPOS_IE.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                </select>
              </Campo>
              <Campo label="Inscricao Estadual" dica={form.indIEDest === "1" ? "Obrigatoria." : "So para contribuinte."}>
                <Input
                  value={form.ie ?? ""}
                  disabled={form.indIEDest !== "1"}
                  onChange={(e) => set("ie", e.target.value)}
                />
              </Campo>

              <Campo label="Logradouro" span={2}>
                <Input value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} />
              </Campo>
              <Campo label="Numero">
                <Input placeholder="S/N" value={form.numero} onChange={(e) => set("numero", e.target.value)} />
              </Campo>

              <Campo label="Bairro">
                <Input value={form.bairro} onChange={(e) => set("bairro", e.target.value)} />
              </Campo>
              <Campo label="Municipio">
                <Input value={form.municipio} onChange={(e) => set("municipio", e.target.value)} />
              </Campo>
              <Campo label="Codigo IBGE" dica="7 digitos. E ele que a SEFAZ confere.">
                <Input value={form.codigoMunicipio} onChange={(e) => set("codigoMunicipio", e.target.value)} />
              </Campo>

              <Campo label="UF">
                <Input maxLength={2} value={form.uf} onChange={(e) => set("uf", e.target.value.toUpperCase())} />
              </Campo>
              <Campo label="CEP">
                <Input value={form.cep} onChange={(e) => set("cep", e.target.value)} />
              </Campo>
              <Campo label="E-mail" dica="Opcional. Recebe a nota.">
                <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
              </Campo>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
              <Button type="button" onClick={salvar}>{editando ? "Salvar alteracoes" : "Cadastrar"}</Button>
            </div>
          </div>
        </div>
      )}
    </PainelLayout>
  );
}

function Campo({
  label, dica, span, children,
}: { label: string; dica?: string; span?: number; children: React.ReactNode }) {
  const classe = span === 2 ? "sm:col-span-2" : span === 3 ? "sm:col-span-3" : "";
  return (
    <div className={`space-y-2 ${classe}`}>
      <Label>{label}</Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}
