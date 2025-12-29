const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const ghostscriptService = require('../services/ghostscript.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  const quality = req.body.quality || 'medium';
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      await cleanupFiles([inputPath]);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    const outputPath = await ghostscriptService.compressPdf(inputPath, outputDir, quality);
    const pdfBuffer = await fs.readFile(outputPath);
    await cleanupFiles([inputPath, outputPath]);

    const fileName = 'compressed-' + req.file.originalname;
    const fileId = await fileStore.storeFile(pdfBuffer, fileName, 'application/pdf');

    res.json({ success: true, fileId, fileName });
    
  } catch (error) {
    console.error('Error al comprimir:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Error al comprimir', details: error.message });
  }
});

module.exports = router;