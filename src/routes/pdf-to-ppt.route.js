const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const libreOfficeService = require('../services/libreoffice.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    const outputPath = await libreOfficeService.pdfToPpt(inputPath, outputDir);
    
    res.download(outputPath, path.basename(outputPath), async (err) => {
      await cleanupFiles([inputPath, outputPath]);
    });
    
  } catch (error) {
    console.error('Error PDF→PPT:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;
