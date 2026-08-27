const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src');
const manifestPath = path.join(__dirname, 'capabilities.json');

if (!fs.existsSync(manifestPath)) {
    console.error('ERRO: capabilities.json ausente.');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

console.log(`[*] Verificação Estrutural Preliminar - v${manifest.version}`);
console.log('[!] AVISO: Esta é uma verificação estrutural preliminar — não é teste funcional.\n');

let missingCount = 0;
let partialCount = 0;
let presentCount = 0;
let blockedCount = 0;

const results = {
    present: [],
    partial: [],
    missing: [],
    blocked: []
};

for (const cap of manifest.capabilities) {
    if (cap.estado === 'Bloqueado por dependência externa') {
        results.blocked.push(cap);
        blockedCount++;
        continue;
    }

    const fullPath = path.join(srcDir, cap.modulo);
    if (!fs.existsSync(fullPath)) {
        results.missing.push(cap);
        missingCount++;
        continue;
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    
    const missingExports = cap.exports.filter(ex => !content.includes(`export class ${ex}`) && !content.includes(`export const ${ex}`) && !content.includes(`export function ${ex}`));
    const missingContracts = cap.contratos.filter(ty => !content.includes(`export interface ${ty}`) && !content.includes(`export type ${ty}`));
    
    if (missingExports.length > 0 || missingContracts.length > 0) {
        results.partial.push({ cap, missing: [...missingExports, ...missingContracts] });
        partialCount++;
    } else {
        results.present.push(cap);
        presentCount++;
    }
}

console.log('--- Resumo Estrutural ---');
console.log(`Presentes: ${presentCount}`);
console.log(`Parciais: ${partialCount}`);
console.log(`Ausentes: ${missingCount}`);
console.log(`Bloqueados: ${blockedCount}\n`);

if (missingCount > 0 || partialCount > 0) {
    console.error('[ERRO OBJETIVO] Capacidades estruturais incompletas:');
    
    results.partial.forEach(p => console.error(` - [PARTIAL] ${p.cap.id}: Faltam [${p.missing.join(', ')}] (Testado futuramente por: ${p.cap.testeIntegracao})`));
    results.missing.forEach(m => console.error(` - [MISSING] ${m.id}: Arquivo ausente (Testado futuramente por: ${m.testeIntegracao})`));

    console.error('\n[BLOQUEIO] O fluxo XML integral não está implementado. Um resultado estrutural sem pendências nunca poderá substituir o futuro IntegrationFlow.test.ts.');
    process.exit(1);
}

console.log('[OK] Verificação estrutural passou. No entanto, o fluxo XML integral permanece "Não implementado" até prova funcional no futuro teste de integração.');
