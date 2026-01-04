const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const ghostscriptService = require('../services/ghostscript.service');
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
 * POST /api/compress-pdf
 * Comprime un PDF
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

    // Determinar modo de compresión
    const mode = req.body.mode || 'simple';
    let outputPath;

    if (mode === 'advanced') {
      const dpi = parseInt(req.body.dpi) || 120;
      const imageQuality = parseInt(req.body.imageQuality) || 60;
      
      console.log(`[Compress] Advanced - DPI: ${dpi}, Quality: ${imageQuality}`);
      outputPath = await ghostscriptService.compressPdf(inputPath, outputDir, {
        dpi,
        imageQuality,
        pdfSettings: '/ebook'
      });
    } else {
      const preset = req.body.preset || req.body.quality || 'recommended';
      console.log(`[Compress] Preset: ${preset}`);
      outputPath = await ghostscriptService.compressPdfWithPreset(inputPath, outputDir, preset);
    }

    tempFiles.push(outputPath);
    
    // Obtener tamaño comprimido
    const compressedStats = await fs.stat(outputPath);
    const compressedSize = compressedStats.size;
    const reduction = ((originalSize - compressedSize) / originalSize * 100);

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = originalName.replace(/\.pdf$/i, '-compressed.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Compress] ${(originalSize/1024/1024).toFixed(1)}MB -> ${(compressedSize/1024/1024).toFixed(1)}MB (${reduction.toFixed(1)}%)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      compressedSize,
      reduction: parseFloat(reduction.toFixed(2)),
      saved: originalSize - compressedSize
    });
    
  } catch (error) {
    console.error('[Compress] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al comprimir', details: error.message });
  }
});

/**
 * GET /api/compress-pdf/presets
 */
router.get('/presets', (req, res) => {
  res.json({
    success: true,
    presets: ghostscriptService.getPresets()
  });
});

module.exports = router;
