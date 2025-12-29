const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const libreOfficeService = require('../services/libreoffice.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file.originalname.match(/\.(docx|doc)$/i)) {
      await cleanupFiles([inputPath]);
      return res.status(400).json({ error: 'Solo archivos .docx o .doc' });
    }
    
    const outputPath = await libreOfficeService.wordToPdf(inputPath, outputDir);
    const pdfBuffer = await fs.readFile(outputPath);
    await cleanupFiles([inputPath, outputPath]);

    const fileName = req.file.originalname.replace(/\.(docx|doc)$/i, '.pdf');
    const fileId = await fileStore.storeFile(pdfBuffer, fileName, 'application/pdf');

    res.json({ success: true, fileId, fileName });
    
  } catch (error) {
    console.error('Error Word→PDF:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;