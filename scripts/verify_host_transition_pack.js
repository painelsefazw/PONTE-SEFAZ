const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const allowedFiles = [
    'scripts/ci-validate.sh',
    'scripts/check_required_capabilities.js',
    'scripts/validate_schemas.js',
    'scripts/generate_schema_manifest.ps1',
    '.github/workflows/ci.yml',
    'delivery_pack.ps1',
    'manual_git_steps.md',
    'schemas/README_SCHEMA_REQUIRED.md',
    'implementation_plan.md',
    'walkthrough.md',
    'README_HOST_TRANSITION.md'
];

const rootDir = path.join(__dirname, '..');
const packDir = path.join(rootDir, 'host_transition_pack');

if (!fs.existsSync(packDir)) {
    console.error('ERRO: Pasta host_transition_pack/ não encontrada.');
    process.exit(1);
}

let hasError = false;
let hashRuntimeError = false;
const manifest = {
    manifestVersion: "1.0",
    generatedAtUtc: new Date().toISOString(),
    totalFiles: allowedFiles.length,
    files: {}
};

function getFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const fileList = fs.readdirSync(dir);
    for (const file of fileList) {
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files);
        } else {
            files.push(name);
        }
    }
    return files;
}

const packedFilesRaw = getFiles(packDir);
const packedFilesRel = packedFilesRaw.map(f => path.relative(packDir, f).replace(/\\/g, '/'));

for (const f of packedFilesRel) {
    if (f !== 'manifest.json' && !allowedFiles.includes(f)) {
        console.error(`ERRO: Arquivo adicional não declarado encontrado no pack: ${f}`);
        hasError = true;
    }
    const ext = path.extname(f).toLowerCase();
    const name = path.basename(f).toLowerCase();
    if (['.pfx', '.p12', '.pem', '.key', '.cer', '.crt', '.env', '.tmp', '.bak'].includes(ext) || ext.endsWith('~') || name.includes('secret') || name === 'project_changes.patch' || name === 'manifest_sha256.txt' || name === 'file_list.txt') {
        console.error(`ERRO: Arquivo sensível, proibido ou temporário encontrado: ${f}`);
        hasError = true;
    }
}

const repetitiveHashPattern = /^(0+|1+|2+|3+|4+|5+|6+|7+|8+|9+|a+|b+|c+|d+|e+|f+)$/i;

for (const relPath of allowedFiles) {
    let originPath = path.join(rootDir, relPath);
    const packFilePath = path.join(packDir, relPath);

    if (!fs.existsSync(originPath)) {
        console.error(`ERRO: Arquivo de origem ausente: ${originPath}`);
        hasError = true;
        continue;
    }
    
    if (!fs.existsSync(packFilePath)) {
        console.error(`ERRO: Arquivo ausente na cópia: ${relPath}`);
        hasError = true;
        continue;
    }

    const originStats = fs.lstatSync(originPath);
    const packStats = fs.lstatSync(packFilePath);

    if (originStats.isSymbolicLink() || packStats.isSymbolicLink()) {
         console.error(`ERRO: Symlinks são proibidos: ${relPath}`);
         hasError = true;
         continue;
    }
    
    const relativeToPack = path.relative(packDir, packFilePath);
    if (relativeToPack.startsWith('..') || path.isAbsolute(relativeToPack)) {
         console.error(`ERRO: Caminhos com .. ou absolutos detectados: ${relPath}`);
         hasError = true;
         continue;
    }

    if (packStats.size === 0 || originStats.size === 0) {
        console.error(`ERRO: Arquivo cópia ou origem vazio: ${relPath}`);
        hasError = true;
        continue;
    }

    if (packStats.size !== originStats.size) {
        console.error(`ERRO: Divergência de tamanho em bytes: ${relPath}`);
        hasError = true;
        continue;
    }

    const originContent = fs.readFileSync(originPath);
    const packContent = fs.readFileSync(packFilePath);

    let originHash, packHash;
    try {
        originHash = crypto.createHash('sha256').update(originContent).digest('hex');
        packHash = crypto.createHash('sha256').update(packContent).digest('hex');
    } catch(err) {
        console.error(`ERRO: Falha ao calcular hash. Runtime possivelmente ausente.`);
        hashRuntimeError = true;
        break;
    }

    if (originHash !== packHash) {
        console.error(`ERRO: Divergência de hash SHA-256 em ${relPath}`);
        hasError = true;
        continue;
    }

    if ((relPath === 'implementation_plan.md' || relPath === 'walkthrough.md') && repetitiveHashPattern.test(packHash)) {
        console.error(`ERRO: Hash repetitivo detectado em ${relPath} (${packHash}). Recálculo real exigido.`);
        hasError = true;
        continue;
    }

    manifest.files[relPath] = {
        relativePath: relPath,
        originCorresponding: relPath, // relative to root
        sizeBytes: packStats.size,
        "SHA-256": packHash
    };
}

const manifestDest = path.join(packDir, 'manifest.json');

if (hashRuntimeError) {
    manifest.status = "Não verificado";
    fs.writeFileSync(manifestDest, JSON.stringify(manifest, null, 2), 'utf8');
    console.error('ERRO: Runtime necessário para recalcular os hashes ausente. Classificado como Não verificado.');
    process.exit(1);
}

if (hasError) {
    console.error('ERRO: Inconsistência no host_transition_pack.');
    process.exit(1);
}

fs.writeFileSync(manifestDest, JSON.stringify(manifest, null, 2), 'utf8');
console.log('Verificação concluída. Manifesto gerado com sucesso.');

