const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * POST /api/protect-pdf
 * Protege un PDF con contraseña usando QPDF
 * 
 * Body params:
 * - file: archivo PDF
 * - password: contraseña para abrir el PDF (mínimo 4 caracteres)
 * - encryption: '128' | '256' (default: '256')
 * - compressed: 'true' si el archivo viene comprimido con gzip
 */
router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
    }

    const originalName = req.file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.pdf$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }

    // Validar contraseña
    const password = req.body.password || '';
    
    if (!password) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Se requiere una contraseña' });
    }

    if (password.length < 4) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    // Descomprimir si es necesario
    const isCompressed = req.body.compressed === 'true';
    let inputPath = req.file.path;

    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      const buffer = await fs.readFile(req.file.path);
      const decompressed = await decompressIfNeeded(buffer, req.file.originalname);
      if (decompressed !== buffer) {
        inputPath = req.file.path + '.pdf';
        await fs.writeFile(inputPath, decompressed);
        tempFiles.push(inputPath);
      }
    }
    
    // Obtener tamaño original
    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size;

    // Nivel de encriptación
    const encryption = req.body.encryption === '128' ? '128' : '256';

    console.log(`[Protect] Processing: ${originalName}`);
    console.log(`[Protect] Encryption: ${encryption}-bit`);

    const startTime = Date.now();
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-protected-${timestamp}.pdf`);

    // Escapar contraseña para shell
    const escapePassword = (pwd) => pwd.replace(/'/g, "'\\''");
    const escapedPwd = escapePassword(password);

    // Comando QPDF simple: misma contraseña para user y owner
    const cmd = `qpdf --encrypt '${escapedPwd}' '${escapedPwd}' ${encryption} -- "${inputPath}" "${outputPath}"`;
    
    console.log(`[Protect] Command: qpdf --encrypt [pwd] [pwd] ${encryption} -- input output`);

    await execAsync(cmd);
    tempFiles.push(outputPath);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Protect] Completed in ${elapsed}s`);

    // Obtener tamaño resultante
    const resultStats = await fs.stat(outputPath);
    const resultSize = resultStats.size;

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = originalName.replace(/\.pdf$/i, '-protected.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Protect] Complete: ${outputFileName} (${(resultSize/1024/1024).toFixed(2)}MB)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize,
      encryption: `${encryption}-bit`
    });
    
  } catch (error) {
    console.error('[Protect] Error:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al proteger PDF';
    if (error.message.includes('already encrypted')) {
      errorMessage = 'El PDF ya está protegido. Desbloquéalo primero.';
    }
    
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

/**
 * GET /api/protect-pdf/info
 * Información sobre opciones disponibles
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Protege PDFs con contraseña de seguridad',
    useCases: [
      'Proteger documentos confidenciales',
      'Compartir archivos de forma segura',
      'Evitar acceso no autorizado'
    ],
    encryptionOptions: [
      { value: '256', label: '256-bit AES', description: 'Máxima seguridad (recomendado)', default: true },
      { value: '128', label: '128-bit AES', description: 'Compatible con lectores antiguos' }
    ],
    limits: {
      maxFileSize: '150MB',
      minPasswordLength: 4
    },
    engine: 'qpdf'
  });
});

module.exports = router;