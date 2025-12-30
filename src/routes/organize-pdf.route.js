const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { validatePdf } = require('../middleware/pdf-validation.middleware');
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

router.post('/', upload.any(), validatePdf, async (req, res) => {
  const tempFiles = req.files ? req.files.map(f => f.path) : [];
  
  try {
    const instructionsJson = req.body.instructions;
    const isCompressed = req.body.compressed === 'true';

    if (!instructionsJson) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No se proporcionaron instrucciones' });
    }

    const instructions = JSON.parse(instructionsJson);
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
      'organized.pdf',
      'application/pdf'
    );

    res.json({
      success: true,
      fileId,
      fileName: 'organized.pdf',
      size: pdfBytes.byteLength,
      pages: newPdf.getPageCount()
    });

  } catch (error) {
    console.error('Error organizing PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error al procesar el archivo' });
  }
});

module.exports = router;