/**
 * Regera `src/domain/ibge/municipios.ts` a partir da API de localidades do IBGE.
 *
 * Uso: node scripts/gerar_municipios.js
 *
 * Rode quando o IBGE criar, extinguir ou renomear municipio — o que acontece
 * raramente, e sempre por lei. O arquivo gerado vai versionado de proposito:
 * o DANFSe precisa do nome do municipio para ser impresso, e depender de uma
 * chamada externa na hora de gerar o PDF trocaria um dado estavel por uma
 * fonte de falha.
 */
const fs = require('fs');
const path = require('path');

const FONTE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';
const SAIDA = path.join(__dirname, '../src/domain/ibge/municipios.ts');

/** A UF aparece em dois caminhos diferentes conforme a divisao territorial. */
function ufDe(m) {
  return m?.microrregiao?.mesorregiao?.UF?.sigla
    ?? m?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla;
}

async function main() {
  const r = await fetch(FONTE);
  if (!r.ok) throw new Error(`IBGE respondeu ${r.status}`);
  const municipios = await r.json();

  const ufs = {};
  const semUf = [];
  for (const m of municipios) {
    const uf = ufDe(m);
    if (!uf) { semUf.push(m.id); continue; }
    ufs[String(m.id).slice(0, 2)] = uf;
  }
  if (semUf.length) throw new Error(`Sem UF: ${semUf.join(', ')}`);
  if (Object.keys(ufs).length !== 27) {
    throw new Error(`Esperava 27 UFs, achei ${Object.keys(ufs).length}`);
  }

  const linhas = municipios.map(m => `${m.id} ${m.nome}`).sort();
  const ufsLiteral = JSON.stringify(ufs, null, 2).replace(/"(\d+)":/g, "'$1':");

  const conteudo = `/**
 * Tabela de municipios do IBGE.
 *
 * ARQUIVO GERADO — nao edite a mao. Fonte:
 * ${FONTE}
 * Coletado em ${new Date().toISOString().slice(0, 10)}.
 * Para atualizar: node scripts/gerar_municipios.js
 *
 * Existe porque a NT 008/2026 manda imprimir o **nome** do municipio no
 * DANFSe, e o XML da NFS-e so traz o codigo de 7 digitos do IBGE (cMun).
 * Sem isto o documento saia com "3530607" onde deveria estar "Mogi das
 * Cruzes" — era o unico ponto em que nao cumpriamos a norma.
 *
 * Fica embutido no codigo e nao no banco: e consulta por chave exata, sem
 * busca textual, e assim o serverless nao paga ida ao banco para imprimir um
 * PDF. Sao ~115 KB. O NCM foi para o Postgres pelo motivo oposto: la a busca
 * e por descricao.
 *
 * O codigo do municipio comeca com os dois digitos da UF, entao a sigla sai
 * do proprio codigo em vez de repetida ${linhas.length} vezes.
 */

/** Codigo de UF do IBGE (2 digitos) para sigla. */
export const UF_POR_CODIGO: Readonly<Record<string, string>> = ${ufsLiteral};

/** "codigo nome" por linha, ordenado por codigo. */
export const TABELA_MUNICIPIOS = \`${linhas.join('\n')}\`;
`;

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, conteudo, 'utf8');
  console.log(`${linhas.length} municipios, ${Object.keys(ufs).length} UFs`);
  console.log(`${SAIDA} — ${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
