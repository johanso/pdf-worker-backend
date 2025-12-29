const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const { PDFDocument, degrees } = require('pdf-lib');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file || !req.body.pageInstructions) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo o instrucciones' });
    }

    const pageInstructions = JSON.parse(req.body.pageInstructions);
    const fileBuffer = await fs.readFile(req.file.path);
    const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
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
      'rotated.pdf',
      'application/pdf'
    );

    res.json({ success: true, fileId, fileName: 'rotated.pdf' });

  } catch (error) {
    console.error('Error rotating PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;