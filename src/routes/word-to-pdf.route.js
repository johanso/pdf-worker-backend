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

/**
 * @swagger
 * /api/word-to-pdf:
 *   post:
 *     summary: Convierte documentos Word (.doc, .docx) a PDF
 *     tags: [Office → PDF]
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
 *                 description: Archivo Word (.doc, .docx) o comprimido (.gz)
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *                 example: documento.pdf
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Conversión exitosa
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
 *                   description: ID para descargar el PDF desde /api/download/:fileId
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   example: documento.pdf
 *                 size:
 *                   type: number
 *                   description: Tamaño del PDF en bytes
 *                 resultSize:
 *                   type: number
 *                   description: Tamaño del resultado en bytes
 *                 originalFormat:
 *                   type: string
 *                   example: DOCX
 *       400:
 *         description: Formato de archivo inválido
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
  const outputFileName = req.body.fileName || originalName.replace(/\.(docx|doc)$/i, '.pdf');
  
  try {
    const originalName = req.file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.(docx|doc)$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .docx o .doc' });
    }

    const isCompressed = req.body.compressed === 'true';
    let inputPath = req.file.path;

    // Si está comprimido, descomprimir a un nuevo archivo
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      const buffer = await fs.readFile(req.file.path);
      const decompressed = await decompressIfNeeded(buffer, req.file.originalname);
      if (decompressed !== buffer) {
        // Mantener extensión original
        const ext = originalName.split('.').pop();
        inputPath = req.file.path + '.' + ext;
        await fs.writeFile(inputPath, decompressed);
        tempFiles.push(inputPath);
      }
    }
    
    const outputPath = await libreOfficeService.wordToPdf(inputPath, outputDir);
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
    console.error('Error Word→PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;