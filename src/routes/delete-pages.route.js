const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
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
    const srcDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="modified.pdf"');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error deleting pages:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;
