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

/**
 * Descomprime un buffer si está en formato gzip
 */
async function decompressIfNeeded(buffer, fileName) {
  // Verificar magic bytes de gzip (1f 8b)
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    const startTime = Date.now();
    const decompressed = await gunzip(buffer);
    console.log(`[Decompress] ${fileName}: ${buffer.length} -> ${decompressed.length} bytes (${Date.now() - startTime}ms)`);
    return decompressed;
  }
  return buffer;
}

router.post('/', upload.array('files', 50), async (req, res) => {
  const tempFiles = req.files ? req.files.map(f => f.path) : [];
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron archivos' });
    }

    const isCompressed = req.body.compressed === 'true';
    console.log(`[MergePDF] Received ${req.files.length} files, compressed: ${isCompressed}`);

    let rotations = [];
    try {
      rotations = JSON.parse(req.body.rotations || '[]');
    } catch (e) {
      rotations = new Array(req.files.length).fill(0);
    }

    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const rotation = rotations[i] || 0;

      if (file.size === 0) continue;

      try {
        let fileBuffer = await fs.readFile(file.path);
        
        // Descomprimir si es necesario
        if (isCompressed || file.originalname.endsWith('.gz')) {
          fileBuffer = await decompressIfNeeded(fileBuffer, file.originalname);
        }

        const pdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

        copiedPages.forEach((page) => {
          const existingRotation = page.getRotation().angle;
          page.setRotation(degrees((existingRotation + rotation) % 360));
          mergedPdf.addPage(page);
        });
      } catch (error) {
        // Obtener nombre original sin .gz
        const originalName = file.originalname.replace(/\.gz$/, '');
        console.error('Error loading PDF:', originalName, error.message);
        await cleanupFiles(tempFiles);
        
        // Detectar si es un PDF protegido
        if (error.message.includes('encrypted') || error.message.includes('password')) {
          return res.status(400).json({ 
            error: `El archivo "${originalName}" está protegido con contraseña. Por favor, desbloquéalo primero.`
          });
        }
        
        return res.status(400).json({ 
          error: `El archivo "${originalName}" no es un PDF válido o está corrupto.`
        });
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No se pudo generar el PDF (sin páginas)' });
    }

    const pdfBytes = await mergedPdf.save();
    await cleanupFiles(tempFiles);

    // Guardar en file store y devolver fileId
    const fileId = await fileStore.storeFile(
      Buffer.from(pdfBytes),
      'merged.pdf',
      'application/pdf'
    );

    console.log(`[MergePDF] Success: ${mergedPdf.getPageCount()} pages, ${pdfBytes.byteLength} bytes`);

    res.json({ 
      success: true,
      fileId,
      fileName: 'merged.pdf',
      size: pdfBytes.byteLength,
      pages: mergedPdf.getPageCount()
    });

  } catch (error) {
    console.error('Error merging PDFs:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

module.exports = router;