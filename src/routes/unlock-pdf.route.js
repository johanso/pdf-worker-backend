const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const qpdfService = require('../services/qpdf.service');
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

router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  const outputDir = path.join(__dirname, '../../outputs');
  const password = req.body.password;
  
  try {
    const originalName = req.file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.pdf$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    if (!password) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Se requiere contraseña' });
    }

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
    
    const outputPath = await qpdfService.decryptPdf(inputPath, outputDir, password);
    tempFiles.push(outputPath);

    const pdfBuffer = await fs.readFile(outputPath);
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      'unlocked.pdf',
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileId,
      fileName: 'unlocked.pdf',
      size: pdfBuffer.length
    });
    
  } catch (error) {
    console.error('Error al desbloquear PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Contraseña incorrecta o error al desbloquear', details: error.message });
  }
});

module.exports = router;