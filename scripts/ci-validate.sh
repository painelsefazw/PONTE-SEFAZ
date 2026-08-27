#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
    local exit_code=$?
    echo ">> [TRAP] Executando rotina de limpeza final segura..."
    exit $exit_code
}
trap cleanup EXIT HUP INT TERM

echo "=========================================="
echo " NFe Engine - Validacao CI Rigorosa       "
echo "=========================================="

echo "[1/23] Verificacao do ambiente e versoes"
if ! command -v node >/dev/null 2>&1; then echo "ERRO: Node nao instalado."; exit 1; fi
if ! command -v npm >/dev/null 2>&1; then echo "ERRO: NPM nao instalado."; exit 1; fi

node -v
npm -v

echo "[2/23] Validacao de package-lock.json"
if [[ ! -f "$PROJECT_ROOT/package-lock.json" ]]; then
    echo "ERRO: package-lock.json ausente. O controle de versoes de pacotes esta rompido."
    exit 1
fi

echo "[3/23] Instalacao Estrita (npm ci)"
npm ci >/dev/null

echo "[4/23] Compilacao TypeScript (tsc --noEmit)"
npx tsc --noEmit

echo "[5/23] Linting"
if grep -q '"lint"' "$PROJECT_ROOT/package.json"; then
    npm run lint
fi

echo "[6/23] Validacao do Banco (PostgreSQL) para Integracao"
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERRO: DATABASE_URL nao foi providenciada pelo Workflow. Teste Transacional bloqueado."
    exit 1
fi

echo "[7/23] Verificacao de Capacidades do Fluxo XML (Pre-requisitos estruturais)"
node "$PROJECT_ROOT/scripts/check_required_capabilities.js"

echo "[8/23] Analise Antifraude de Testes (Proibicao de Bypasses)"
# Busca estrita APENAS na pasta tests/ real (excluindo node_modules, .git, etc)
# Evitando auto-dectecao quebrando a string em eval
B_PATTERN="it\.todo|test\.todo|describe\.todo|it\.skip|test\.skip|describe\.skip|it\.only|test\.only|describe\.only|xit|xtest|xdescribe|fit|fdescribe"
BYPASS_FOUND=$(find "$PROJECT_ROOT/tests" -type f -name "*.test.ts" -exec grep -HnE "$B_PATTERN" {} + || true)
if [[ -n "$BYPASS_FOUND" ]]; then
    echo "ERRO: Encontrado bypass de teste:"
    echo "$BYPASS_FOUND"
    echo "O pipeline exige implementacao real e completa."
    exit 1
fi

echo "[9/23] Testes Unitarios"
echo ">> (Cobertura exigida e bloqueante em caso de falha)"
npx jest --coverage --testPathIgnorePatterns="IntegrationFlow|Postgres"

echo "[10/23] Testes PostgreSQL reais"
npx jest tests/TransmissaoNFeUseCase.test.ts

echo "[11/23] Testes PFX e XMLDSig reais"
npx jest tests/Signer.test.ts

echo "[12/23] Testes de Adulteracao e Seguranca"
# Ja cobertos no Signer.test.ts (modificacao xml) e no Postgres

echo "[13/23] Testes SOAP (Ausentes na etapa atual, aguardando integracao)"
# Placeholder explicito para CI futuro.
# Nao se aplica mock ou exit 0 falso aqui, senao viola a regra.

echo "[14/23] Testes de Timeout e UNKNOWN"
# Inserido em TransmissaoNFeUseCase.test.ts

echo "[15/23] Testes de Conciliacao"
# Inserido em TransmissaoNFeUseCase.test.ts

echo "[16/23] Verificacao XSD Oficial (Manifesto fisicamente presente)"
if [[ ! -f "$PROJECT_ROOT/schemas/manifest_sha256.txt" ]]; then
    echo "ERRO: Manifesto JSON dos XSDs ausente."
    exit 1
fi

echo "[17/23] Validacao Fisica do Manifesto XSD"
node "$PROJECT_ROOT/scripts/validate_schemas.js"

echo "Pipeline abortado intencionalmente no final. O Fluxo de Integracao ainda nao existe."
exit 1
