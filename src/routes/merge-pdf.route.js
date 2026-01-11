const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const { PDFDocument } = require('pdf-lib');
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
    const startTime = Date.now();
    const decompressed = await gunzip(buffer);
    console.log(`[Decompress] ${fileName}: ${buffer.length} -> ${decompressed.length} bytes (${Date.now() - startTime}ms)`);
    return decompressed;
  }
  return buffer;
}

router.post('/', upload.array('files', 50), async (req, res) => {
  const tempFiles = req.files ? req.files.map(f => f.path) : [];
  const outputFileName = req.body.fileName || 'merged.pdf';
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron archivos' });
    }

    const isCompressed = req.body.compressed === 'true';
    console.log(`[MergePDF] Received ${req.files.length} files, compressed: ${isCompressed}`);

    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];

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
      outputFileName,
      'application/pdf'
    );

    res.json({ 
      success: true,
      fileId,
      fileName: outputFileName,
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