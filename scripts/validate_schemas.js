const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const schemasDir = path.join(__dirname, '../schemas');
const manifestPath = path.join(schemasDir, 'manifest_sha256.txt');

if (!fs.existsSync(manifestPath)) {
    console.error('ERRO: Manifesto JSON dos XSDs não encontrado.');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (!manifest.generatedAtUtc || !manifest.manifestVersion || !manifest.totalFiles || typeof manifest.files !== 'object') {
    console.error('ERRO: Estrutura do manifesto inválida.');
    process.exit(1);
}

let hasError = false;
const processedFiles = new Set();

for (const [relKey, fileData] of Object.entries(manifest.files)) {
    if (!fileData["SHA-256"] || !fileData.sizeBytes || !fileData.relativePath || !fileData.name) {
         console.error(`ERRO: Metadados incompletos para ${relKey} no manifesto.`);
         hasError = true;
         continue;
    }

    if (processedFiles.has(fileData.relativePath)) {
        console.error(`ERRO: Arquivo duplicado listado no manifesto: ${fileData.relativePath}`);
        hasError = true;
        continue;
    }
    processedFiles.add(fileData.relativePath);

    const filePath = path.join(schemasDir, fileData.relativePath);
    
    // Security check: ensure path is within schemas folder (No absolute path, no '..', no symlinks leaking out)
    const relativeToSchemas = path.relative(schemasDir, filePath);
    if (relativeToSchemas.startsWith('..') || path.isAbsolute(relativeToSchemas)) {
        console.error(`ERRO: Caminho absoluto ou relativo suspeito detectado: ${fileData.relativePath}`);
        hasError = true;
        continue;
    }

    if (!fs.existsSync(filePath)) {
        console.error(`ERRO: Arquivo XSD listado no manifesto está ausente fisicamente: ${fileData.relativePath}`);
        hasError = true;
        continue;
    }

    // Verify symlink targeting inside
    const realPath = fs.realpathSync(filePath);
    if (!realPath.startsWith(fs.realpathSync(schemasDir))) {
        console.error(`ERRO: Symlink aponta para fora do diretório schemas: ${fileData.relativePath}`);
        hasError = true;
        continue;
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
        console.error(`ERRO: Arquivo vazio detectado: ${fileData.relativePath}`);
        hasError = true;
        continue;
    }
    
    if (stats.size !== fileData.sizeBytes) {
        console.error(`ERRO: Tamanho divergente no arquivo ${fileData.relativePath}. Esperado: ${fileData.sizeBytes}, Encontrado: ${stats.size}`);
        hasError = true;
        continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for placeholders
    if (content.includes('INSERIR_') || content.trim().length < 50) {
        console.error(`ERRO: O arquivo ${fileData.relativePath} parece ser um placeholder ou é muito curto.`);
        hasError = true;
        continue;
    }
    
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    if (hash.toLowerCase() !== fileData["SHA-256"].toLowerCase()) {
        console.error(`ERRO: Falha de integridade SHA-256 no arquivo ${fileData.relativePath}. Esperado: ${fileData["SHA-256"]}, Encontrado: ${hash}`);
        hasError = true;
    }

    // Analisar imports e includes
    const importRegex = /<xs:(import|include)\s+[^>]*schemaLocation=["']([^"']+)["']/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const schemaLocation = match[2];
        if (schemaLocation.startsWith('http://') || schemaLocation.startsWith('https://')) {
            // Se houver permissão, urls são checadas aqui, senao barramos. Vamos tentar resolver path relativo puro.
             console.error(`ERRO: XSD usa esquema absoluto remoto, não suportado offline: ${schemaLocation} em ${fileData.relativePath}`);
             hasError = true;
        } else {
             const resolvedImport = path.resolve(path.dirname(filePath), schemaLocation);
             if (!fs.existsSync(resolvedImport)) {
                 console.error(`ERRO: Dependência local não resolvida: ${schemaLocation} (chamada por ${fileData.relativePath})`);
                 hasError = true;
             }
        }
    }
}

// Check for unlisted files
function getFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const fileList = fs.readdirSync(dir);
    for (const file of fileList) {
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files);
        } else {
            if (name.endsWith('.xsd')) {
                files.push(path.relative(schemasDir, name).replace(/\\/g, '/'));
            }
        }
    }
    return files;
}

const allPhysicalFiles = getFiles(schemasDir);
for (const physicalRel of allPhysicalFiles) {
    if (!processedFiles.has(physicalRel)) {
        console.error(`ERRO: Arquivo físico não listado no manifesto: ${physicalRel}`);
        hasError = true;
    }
}

if (hasError) {
    console.error('ERRO: A integridade dos schemas (XSD) falhou. Operação abortada.');
    process.exit(1);
}

console.log('Integridade estrutural, imports locais e criptográfica dos arquivos XSD verificada com sucesso.');
