const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const libreOfficeService = require('../services/libreoffice.service');
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
  
  try {
    const originalName = req.file.originalname.replace(/\.gz$/, '');
    const outputFileName = req.body.fileName || originalName.replace(/\.(pptx|ppt)$/i, '.pdf');

    if (!originalName.match(/\.(pptx|ppt)$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .pptx o .ppt' });
    }

    const isCompressed = req.body.compressed === 'true';
    let inputPath = req.file.path;

    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      const buffer = await fs.readFile(req.file.path);
      const decompressed = await decompressIfNeeded(buffer, req.file.originalname);
      if (decompressed !== buffer) {
        const ext = originalName.split('.').pop();
        inputPath = req.file.path + '.' + ext;
        await fs.writeFile(inputPath, decompressed);
        tempFiles.push(inputPath);
      }
    }
    
    const outputPath = await libreOfficeService.pptToPdf(inputPath, outputDir);
    tempFiles.push(outputPath);

    const pdfBuffer = await fs.readFile(outputPath);
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: pdfBuffer.length,
      resultSize: pdfBuffer.length,
      originalFormat: originalName.split('.').pop().toUpperCase()
    });
    
  } catch (error) {
    console.error('Error PPT→PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;