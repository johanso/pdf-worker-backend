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
 * /api/organize-pdf:
 *   post:
 *     summary: Organiza múltiples PDFs en un solo documento o reordena páginas
 *     tags: [Manipulación PDF]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - instructions
 *             properties:
 *               file-0:
 *                 type: string
 *                 format: binary
 *                 description: Primer PDF o comprimido (.gz)
 *               file-1:
 *                 type: string
 *                 format: binary
 *                 description: Segundo PDF (opcional)
 *               file-n:
 *                 type: string
 *                 format: binary
 *                 description: Más PDFs (opcional)
 *               instructions:
 *                 type: string
 *                 description: Array JSON con instrucciones de organización
 *                 example: '[{"fileIndex":0,"originalIndex":0,"rotation":0},{"isBlank":true}]'
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si los archivos están comprimidos con gzip
 *     responses:
 *       200:
 *         description: PDFs organizados exitosamente
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
 *                 pages:
 *                   type: number
 *                 totalPages:
 *                   type: number
 *                 blankPages:
 *                   type: number
 *                 filesUsed:
 *                   type: number
 *       400:
 *         description: Instrucciones inválidas o sin archivos
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
router.post('/', upload.any(), async (req, res) => {
  const tempFiles = req.files ? req.files.map(f => f.path) : [];
  
  try {
    const instructionsJson = req.body.instructions;
    const isCompressed = req.body.compressed === 'true';
    const outputFileName = req.body.fileName || 'organized.pdf';

    if (!instructionsJson) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No se proporcionaron instrucciones' });
    }

    const instructions = JSON.parse(instructionsJson);
    
    // Validación: límite de páginas totales
    if (instructions.length > 1000) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ 
        error: 'El documento no puede tener más de 1000 páginas' 
      });
    }

    const filesMap = new Map();

    for (const file of req.files) {
      if (file.fieldname.startsWith('file-')) {
        const index = parseInt(file.fieldname.replace('file-', ''));
        if (!isNaN(index)) {
          let buffer = await fs.readFile(file.path);
          if (isCompressed || file.originalname.endsWith('.gz')) {
            buffer = await decompressIfNeeded(buffer, file.originalname);
          }
          filesMap.set(index, buffer);
        }
      }
    }

    if (filesMap.size === 0) {
      for (let i = 0; i < req.files.length; i++) {
        let buffer = await fs.readFile(req.files[i].path);
        if (isCompressed || req.files[i].originalname.endsWith('.gz')) {
          buffer = await decompressIfNeeded(buffer, req.files[i].originalname);
        }
        filesMap.set(i, buffer);
      }
    }

    if (filesMap.size === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No se proporcionaron archivos PDF' });
    }

    const newPdf = await PDFDocument.create();
    const loadedPdfs = new Map();

    for (const inst of instructions) {
      if (inst.isBlank) {
        newPdf.addPage();
      } else {
        const fileIndex = inst.fileIndex || 0;
        const pageIndex = (inst.originalIndex || 1) - 1;
        const rotation = inst.rotation || 0;

        let srcDoc = loadedPdfs.get(fileIndex);
        if (!srcDoc) {
          const buffer = filesMap.get(fileIndex);
          if (!buffer) continue;
          srcDoc = await PDFDocument.load(buffer);
          loadedPdfs.set(fileIndex, srcDoc);
        }

        if (pageIndex >= 0 && pageIndex < srcDoc.getPageCount()) {
          const [copiedPage] = await newPdf.copyPages(srcDoc, [pageIndex]);
          const existingRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees((existingRotation + rotation) % 360));
          newPdf.addPage(copiedPage);
        }
      }
    }

    if (newPdf.getPageCount() === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'El documento resultante no tiene páginas' });
    }

    const pdfBytes = await newPdf.save();
    await cleanupFiles(tempFiles);

    const fileId = await fileStore.storeFile(
      Buffer.from(pdfBytes),
      outputFileName,
      'application/pdf'
    );

    // Calcular métricas
    const blankPagesCount = instructions.filter(inst => inst.isBlank).length;
    const uniqueFilesUsed = new Set(
      instructions
        .filter(inst => !inst.isBlank)
        .map(inst => inst.fileIndex)
    ).size;

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: pdfBytes.byteLength,
      pages: newPdf.getPageCount(),
      resultSize: pdfBytes.byteLength,
      totalPages: newPdf.getPageCount(),
      blankPages: blankPagesCount,
      filesUsed: uniqueFilesUsed
    });

  } catch (error) {
    console.error('Error organizing PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error al procesar el archivo' });
  }
});

module.exports = router;