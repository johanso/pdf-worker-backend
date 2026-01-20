const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const pdf2docxService = require('../services/pdf2docx.service');
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
 * /api/pdf-to-word:
 *   post:
 *     summary: Convierte archivos PDF a documentos Word (.docx)
 *     tags: [PDF → Office]
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
 *                 description: Archivo PDF o comprimido (.gz)
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
 *                   description: ID para descargar el DOCX desde /api/download/:fileId
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   example: documento.docx
 *                 size:
 *                   type: number
 *                   description: Tamaño del DOCX en bytes
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
  
  try {
    const originalName = req.file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.pdf$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
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
    
    const outputPath = await pdf2docxService.pdfToWord(inputPath, outputDir);
    tempFiles.push(outputPath);

    const docxBuffer = await fs.readFile(outputPath);
    const fileId = await fileStore.storeFile(
      docxBuffer,
      originalName.replace(/\.pdf$/i, '.docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileId,
      fileName: originalName.replace(/\.pdf$/i, '.docx'),
      size: docxBuffer.length
    });
    
  } catch (error) {
    console.error('Error PDF→Word:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;