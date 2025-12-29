const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { validatePdf } = require('../middleware/pdf-validation.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const { PDFDocument, degrees } = require('pdf-lib');
const fs = require('fs').promises;

router.post('/', upload.single('file'), validatePdf, async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file || !req.body.pageInstructions) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo o instrucciones' });
    }

    const pageInstructions = JSON.parse(req.body.pageInstructions);
    if (!Array.isArray(pageInstructions) || pageInstructions.length === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Instrucciones inválidas' });
    }

    const fileBuffer = await fs.readFile(req.file.path);
    const srcDoc = await PDFDocument.load(fileBuffer);
    const newDoc = await PDFDocument.create();

    const totalPages = srcDoc.getPageCount();
    const indicesToCopy = pageInstructions.map(inst => inst.originalIndex);

    if (indicesToCopy.some(idx => idx < 0 || idx >= totalPages)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Índices de página fuera de rango' });
    }

    const copiedPages = await newDoc.copyPages(srcDoc, indicesToCopy);

    pageInstructions.forEach((inst, i) => {
      const page = copiedPages[i];
      const rotation = inst.rotation || 0;
      if (rotation !== 0) {
        const existingRotation = page.getRotation().angle;
        page.setRotation(degrees((existingRotation + rotation) % 360));
      }
      newDoc.addPage(page);
    });

    const pdfBytes = await newDoc.save();
    await cleanupFiles(tempFiles);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="processed.pdf"');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error processing pages:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;
