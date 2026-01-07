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
 * POST /api/unlock-pdf
 * Desbloquea un PDF protegido con contraseña usando QPDF
 * 
 * Body params:
 * - file: archivo PDF protegido
 * - password: contraseña del PDF
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
      return res.status(400).json({ error: 'Se requiere la contraseña del PDF' });
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

    console.log(`[Unlock] Processing: ${originalName}`);

    const startTime = Date.now();
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-unlocked-${timestamp}.pdf`);

    // Escapar contraseña para shell
    const escapePassword = (pwd) => pwd.replace(/'/g, "'\\''");
    const escapedPwd = escapePassword(password);

    // Comando QPDF para descifrar
    const cmd = `qpdf --decrypt --password='${escapedPwd}' "${inputPath}" "${outputPath}"`;
    
    console.log(`[Unlock] Command: qpdf --decrypt --password=[pwd] input output`);

    try {
      await execAsync(cmd);
    } catch (error) {
      const errorMsg = error.message || error.stderr || '';
      
      // Detectar errores específicos de QPDF
      if (errorMsg.includes('invalid password')) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: 'Contraseña incorrecta',
          code: 'INVALID_PASSWORD'
        });
      }
      
      if (errorMsg.includes('not encrypted')) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: 'El PDF no está protegido con contraseña',
          code: 'NOT_ENCRYPTED'
        });
      }
      
      throw error;
    }

    tempFiles.push(outputPath);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Unlock] Completed in ${elapsed}s`);

    // Obtener tamaño resultante
    const resultStats = await fs.stat(outputPath);
    const resultSize = resultStats.size;

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = originalName.replace(/\.pdf$/i, '-unlocked.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Unlock] Complete: ${outputFileName} (${(resultSize/1024/1024).toFixed(2)}MB)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize
    });
    
  } catch (error) {
    console.error('[Unlock] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al desbloquear PDF', details: error.message });
  }
});

/**
 * POST /api/unlock-pdf/check
 * Verifica si un PDF está protegido
 */
router.post('/check', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
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

    // Usar qpdf --show-encryption para verificar
    let isEncrypted = false;
    let encryptionInfo = null;

    try {
      const result = await execAsync(`qpdf --show-encryption "${inputPath}" 2>&1`);
      const output = result.stdout || '';
      
      if (output.includes('not encrypted')) {
        isEncrypted = false;
      } else {
        isEncrypted = true;
        // Extraer info de encriptación
        if (output.includes('256-bit')) {
          encryptionInfo = '256-bit AES';
        } else if (output.includes('128-bit')) {
          encryptionInfo = '128-bit AES';
        } else {
          encryptionInfo = 'Encriptado';
        }
      }
    } catch (e) {
      // Si falla el comando, probablemente esté encriptado
      isEncrypted = true;
    }

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      isEncrypted,
      encryptionInfo,
      message: isEncrypted 
        ? 'El PDF está protegido con contraseña'
        : 'El PDF no está protegido'
    });
    
  } catch (error) {
    console.error('[Unlock Check] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al verificar PDF', details: error.message });
  }
});

/**
 * GET /api/unlock-pdf/info
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Desbloquea PDFs protegidos con contraseña',
    useCases: [
      'Quitar contraseña de documentos propios',
      'Acceder a PDFs con contraseña conocida',
      'Eliminar restricciones de seguridad'
    ],
    requirements: [
      'Debes conocer la contraseña del PDF',
      'No es posible desbloquear sin la contraseña correcta'
    ],
    limits: {
      maxFileSize: '150MB'
    },
    engine: 'qpdf'
  });
});

module.exports = router;