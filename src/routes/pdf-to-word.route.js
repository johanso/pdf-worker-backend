const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const pdf2docxService = require('../services/pdf2docx.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      await cleanupFiles([inputPath]);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    const outputPath = await pdf2docxService.pdfToWord(inputPath, outputDir);
    const docxBuffer = await fs.readFile(outputPath);
    await cleanupFiles([inputPath, outputPath]);

    const fileName = req.file.originalname.replace(/\.pdf$/i, '.docx');
    const fileId = await fileStore.storeFile(
      docxBuffer, 
      fileName, 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    res.json({ success: true, fileId, fileName });
    
  } catch (error) {
    console.error('Error PDF→Word:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;