export function formatCurrency(value: unknown) {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number.isFinite(n) ? n : 0,
  );
}

export function formatDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export function docNumero(d: {
  numero?: string | number | undefined;
  serie?: string | number | undefined;
  id?: string | undefined;
}) {
  if (d.numero != null) return `N${"\u00ba"} ${d.numero}${d.serie != null ? ` / S${d.serie}` : ""}`;
  return d.id ? `#${d.id}` : "Documento";
}

export function docId(d: {
  id?: string | undefined;
  chave?: string | undefined;
  numero?: string | number | undefined;
}) {
  return String(d.id ?? d.chave ?? d.numero ?? "");
}
