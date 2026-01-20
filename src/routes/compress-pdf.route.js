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
 * @swagger
 * /api/compress-pdf:
 *   post:
 *     summary: Comprime un archivo PDF reduciendo su tamaño
 *     description: Ofrece dos modos de compresión - simple (preset estándar) y advanced (control personalizado de DPI y calidad)
 *     tags: [Compresión y Optimización]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF a comprimir
 *               mode:
 *                 type: string
 *                 enum: [simple, advanced]
 *                 default: simple
 *                 description: Modo de compresión (simple usa preset /screen, advanced permite personalizar)
 *               dpi:
 *                 type: integer
 *                 minimum: 72
 *                 maximum: 300
 *                 default: 120
 *                 description: DPI para imágenes (solo en modo advanced) - menor = más compresión
 *               imageQuality:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *                 default: 60
 *                 description: Calidad JPEG (solo en modo advanced) - menor = más compresión
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF comprimido
 *                 example: documento_comprimido.pdf
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: PDF comprimido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 fileId:
 *                   type: string
 *                   description: ID para descargar el PDF comprimido
 *                 fileName:
 *                   type: string
 *                   example: compressed.pdf
 *                 originalSize:
 *                   type: number
 *                   description: Tamaño original en bytes
 *                 compressedSize:
 *                   type: number
 *                   description: Tamaño comprimido en bytes
 *                 compressionRatio:
 *                   type: string
 *                   description: Ratio de compresión en porcentaje
 *                   example: "45.2%"
 *       400:
 *         description: Archivo no válido o falta el PDF
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error en el servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
      
      outputPath = await ghostscriptService.compressPdf(inputPath, outputDir, {
        dpi,
        imageQuality,
        pdfSettings: '/ebook'
      });
    } else {
      const preset = req.body.preset || req.body.quality || 'recommended';
      outputPath = await ghostscriptService.compressPdfWithPreset(inputPath, outputDir, preset);
    }

    tempFiles.push(outputPath);
    
    // Obtener tamaño comprimido
    const compressedStats = await fs.stat(outputPath);
    const compressedSize = compressedStats.size;
    const reduction = ((originalSize - compressedSize) / originalSize * 100);

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = req.body.fileName || originalName.replace(/\.pdf$/i, '-compressed.pdf');
    
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
