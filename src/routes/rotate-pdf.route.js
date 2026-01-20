const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const { PDFDocument, degrees } = require('pdf-lib');
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
 * /api/rotate-pdf:
 *   post:
 *     summary: Rota páginas específicas de un PDF
 *     tags: [Manipulación PDF]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - pageInstructions
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF o comprimido (.gz)
 *               pageInstructions:
 *                 type: string
 *                 description: Array JSON con instrucciones de rotación para cada página
 *                 example: '[{"originalIndex":0,"rotation":90},{"originalIndex":1,"rotation":0}]'
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Rotación exitosa
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
 *                   description: ID para descargar desde /api/download/:fileId
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   example: rotated.pdf
 *                 size:
 *                   type: number
 *                 pages:
 *                   type: number
 *                 rotatedPages:
 *                   type: number
 *                   description: Cantidad de páginas que fueron rotadas
 *                 totalPages:
 *                   type: number
 *       400:
 *         description: Índices de página fuera de rango o configuración inválida
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
  
  try {
    if (!req.file || !req.body.pageInstructions) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo o instrucciones' });
    }

    const isCompressed = req.body.compressed === 'true';
    const pageInstructions = JSON.parse(req.body.pageInstructions);
    const outputFileName = req.body.fileName || 'rotated.pdf';
    
    let fileBuffer = await fs.readFile(req.file.path);
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      fileBuffer = await decompressIfNeeded(fileBuffer, req.file.originalname);
    }
    
    const pdfDoc = await PDFDocument.load(fileBuffer);
    const newPdf = await PDFDocument.create();

    const totalPages = pdfDoc.getPageCount();
    const indicesToCopy = pageInstructions.map(p => p.originalIndex);

    if (indicesToCopy.some(idx => idx < 0 || idx >= totalPages)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Índices de página fuera de rango' });
    }

    const copiedPages = await newPdf.copyPages(pdfDoc, indicesToCopy);

    pageInstructions.forEach((instruction, i) => {
      const page = copiedPages[i];
      const rotation = instruction.rotation || 0;
      const existingRotation = page.getRotation().angle;
      page.setRotation(degrees((existingRotation + rotation) % 360));
      newPdf.addPage(page);
    });

    const pdfBytes = await newPdf.save();
    await cleanupFiles(tempFiles);

    const fileId = await fileStore.storeFile(
      Buffer.from(pdfBytes),
      outputFileName,
      'application/pdf'
    );

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: pdfBytes.byteLength,
      pages: newPdf.getPageCount(),
      resultSize: pdfBytes.byteLength,
      rotatedPages: pageInstructions.filter(p => (p.rotation % 360) !== 0).length,
      totalPages: newPdf.getPageCount()
    });

  } catch (error) {
    console.error('Error rotating PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;