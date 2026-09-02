#!/usr/bin/env bash
# ============================================================================
# Aponta a ponte para outro banco Supabase, sem abrir o painel da Vercel.
#
#   bash scripts/trocar-banco.sh 'SENHA_DO_BANCO'
#
# As duas partes que NAO sao segredo (a referencia e o host do pooler) ja vem
# preenchidas aqui: elas sao publicas, conferiveis a olho, e nao mudam depois.
# So a senha entra por fora — e ela nunca fica gravada neste arquivo.
#
# O host foi MEDIDO, nao chutado: `/api/diagnostico/pooler` sonda as duas frotas
# de cada regiao e le qual delas reconhece o projeto. Errar a frota devolve
# "password authentication failed", que parece senha errada e ja levou a dois
# resets de senha antes de alguem desconfiar do host.
# ============================================================================
set -uo pipefail

REF='pujgeasffupnanphzafj'
HOST='aws-0-us-east-1.pooler.supabase.com'
PROJETO='ponte-sefaz'

SENHA="${1:-}"
if [ -z "$SENHA" ]; then
  echo "ERRO: falta a senha do banco."
  echo "Uso: bash scripts/trocar-banco.sh 'SENHA_DO_BANCO'"
  exit 1
fi

cd "$(dirname "$0")/.." || exit 1

echo "== 1/4  Conferindo a conta da Vercel"
# O ponte-sefaz vive numa conta DIFERENTE da pessoal: `vercel projects ls` na
# conta pessoal lista doze projetos e nenhum deles e este. Por isso a checagem
# olha o projeto, e nao se existe login.
if ! npx vercel inspect "$PROJETO.vercel.app" >/dev/null 2>&1; then
  echo "   A conta logada nao enxerga o $PROJETO. Vai abrir o navegador para entrar"
  echo "   na conta que e dona dele (a mesma do GitHub painelsefazw)."
  npx vercel login || exit 1
fi

echo "== 2/4  Amarrando esta pasta ao projeto"
npx vercel link --project "$PROJETO" --yes >/dev/null || exit 1

echo "== 3/4  Trocando as tres variaveis em Production"
trocar() {
  local nome="$1" valor="$2"
  # `rm` antes de `add` porque a Vercel nao sobrescreve: sem isso a segunda
  # tentativa falha dizendo que a variavel ja existe, e fica a metade trocada.
  npx vercel env rm "$nome" production --yes >/dev/null 2>&1
  printf '%s' "$valor" | npx vercel env add "$nome" production >/dev/null 2>&1 \
    && echo "   ok  $nome" || { echo "   FALHOU  $nome"; return 1; }
}
trocar NFE_DB_REF      "$REF"  || exit 1
trocar NFE_DB_HOST     "$HOST" || exit 1
trocar NFE_DB_PASSWORD "$SENHA" || exit 1

echo "== 4/4  Conferindo o que ficou gravado"
npx vercel env ls production 2>&1 | grep -E "NFE_DB_(REF|HOST|PASSWORD)" || true

echo
echo "Variaveis trocadas. Falta REPUBLICAR — variavel nova nao entra em"
echo "deployment que ja existe, entao ate republicar a ponte continua falando"
echo "com o banco velho."
echo
echo "A republicacao sai por push, que e como este projeto publica (e o que"
echo "garante que o que sobe e o codigo do git, e nao a copia local):"
echo
echo "  git commit --allow-empty -m 'republica com o banco novo' && git push"
echo
echo "Depois confira com:"
echo "  curl -s https://$PROJETO.vercel.app/api/diagnostico/banco"
