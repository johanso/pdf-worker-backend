const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { validatePdf } = require('../middleware/pdf-validation.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const { PDFDocument, degrees } = require('pdf-lib');
const JSZip = require('jszip');
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
 * /api/delete-pages:
 *   post:
 *     summary: Elimina páginas de un PDF (guarda páginas específicas o las descarta)
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
 *                 description: Array JSON con índices de páginas a mantener
 *                 example: '[{"originalIndex":0},{"originalIndex":2}]'
 *               mode:
 *                 type: string
 *                 enum: [merge, separate]
 *                 description: Fusionar en un PDF o mantener como PDFs separados
 *                 default: merge
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el documento
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Páginas eliminadas exitosamente
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
 *                 size:
 *                   type: number
 *                 outputFiles:
 *                   type: number
 *                 remainingPages:
 *                   type: number
 *                 totalOriginalPages:
 *                   type: number
 *       400:
 *         description: Instrucciones inválidas o índices fuera de rango
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
    const mode = req.body.mode || 'merge';
    const outputFileName = req.body.fileName || 'archivo_modificado.pdf';
    
    let fileBuffer = await fs.readFile(req.file.path);
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      fileBuffer = await decompressIfNeeded(fileBuffer, req.file.originalname);
    }
    
    const srcDoc = await PDFDocument.load(fileBuffer);
    const totalOriginalPages = srcDoc.getPageCount();

    // MODE: MERGE - Fusionar todas las páginas restantes en un solo PDF
    if (mode === 'merge') {
      const newDoc = await PDFDocument.create();
      const indicesToCopy = pageInstructions.map(pi => pi.originalIndex);
      const copiedPages = await newDoc.copyPages(srcDoc, indicesToCopy);

      pageInstructions.forEach((pi, i) => {
        const page = copiedPages[i];
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + pi.rotation));
        newDoc.addPage(page);
      });

      const pdfBytes = await newDoc.save();
      await cleanupFiles(tempFiles);

      const fileId = await fileStore.storeFile(
        Buffer.from(pdfBytes),
        outputFileName,
        'application/pdf'
      );

      return res.json({
        success: true,
        fileId,
        fileName: outputFileName,
        size: pdfBytes.byteLength,
        pages: newDoc.getPageCount(),
        resultSize: pdfBytes.byteLength,
        remainingPages: newDoc.getPageCount(),
        totalOriginalPages: totalOriginalPages
      });
    }

    // MODE: SEPARATE - Crear un PDF individual por cada página restante
    if (mode === 'separate') {
      const outputs = [];

      for (let i = 0; i < pageInstructions.length; i++) {
        const pi = pageInstructions[i];
        const newDoc = await PDFDocument.create();
        
        const [copiedPage] = await newDoc.copyPages(srcDoc, [pi.originalIndex]);
        const currentRotation = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees(currentRotation + pi.rotation));
        newDoc.addPage(copiedPage);

        const pdfBytes = await newDoc.save();
        outputs.push({
          name: `archivo-${pi.originalIndex + 1}.pdf`,
          bytes: pdfBytes
        });
      }

      await cleanupFiles(tempFiles);

      // Si solo hay 1 página, devolver PDF directo
      if (outputs.length === 1) {
        const fileId = await fileStore.storeFile(
          Buffer.from(outputs[0].bytes),
          outputFileName,
          'application/pdf'
        );

        return res.json({
          success: true,
          fileId,
          fileName: outputFileName,
          size: outputs[0].bytes.byteLength,
          outputFiles: 1,
          resultSize: outputs[0].bytes.byteLength,
          remainingPages: 1,
          totalOriginalPages: totalOriginalPages
        });
      }

      // Múltiples páginas - crear ZIP
      const zip = new JSZip();
      for (const output of outputs) {
        zip.file(output.name, output.bytes);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const fileId = await fileStore.storeFile(
        zipBuffer,
        outputFileName,
        'application/zip'
      );

      return res.json({
        success: true,
        fileId,
        fileName: outputFileName,
        size: zipBuffer.length,
        outputFiles: outputs.length,
        resultSize: zipBuffer.length,
        remainingPages: outputs.length,
        totalOriginalPages: totalOriginalPages
      });
    }

    // Modo no reconocido
    await cleanupFiles(tempFiles);
    return res.status(400).json({ error: 'Modo no válido' });

  } catch (error) {
    console.error('Error deleting pages:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;