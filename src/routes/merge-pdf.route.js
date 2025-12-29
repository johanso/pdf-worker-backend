const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const { PDFDocument, degrees } = require('pdf-lib');
const fs = require('fs').promises;

router.post('/', upload.array('files', 50), async (req, res) => {
  const tempFiles = req.files ? req.files.map(f => f.path) : [];
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron archivos' });
    }

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
        const fileBuffer = await fs.readFile(file.path);
        const pdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

        copiedPages.forEach((page) => {
          const existingRotation = page.getRotation().angle;
          page.setRotation(degrees((existingRotation + rotation) % 360));
          mergedPdf.addPage(page);
        });
      } catch (error) {
        console.error('Error loading PDF:', file.originalname, error.message);
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: 'El archivo "' + file.originalname + '" no es un PDF válido o está corrupto.' 
        });
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No se pudo generar el PDF (sin páginas)' });
    }

    const pdfBytes = await mergedPdf.save();
    await cleanupFiles(tempFiles);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error merging PDFs:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

module.exports = router;
