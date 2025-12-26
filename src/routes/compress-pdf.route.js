const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const ghostscriptService = require('../services/ghostscript.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  const quality = req.body.quality || 'medium';
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    const originalStats = await fs.stat(inputPath);
    const outputPath = await ghostscriptService.compressPdf(inputPath, outputDir, quality);
    const compressedStats = await fs.stat(outputPath);
    
    const reduction = ((originalStats.size - compressedStats.size) / originalStats.size * 100).toFixed(2);
    
    res.download(outputPath, path.basename(outputPath), async (err) => {
      await cleanupFiles([inputPath, outputPath]);
    });
    
  } catch (error) {
    console.error('Error al comprimir:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Error al comprimir', details: error.message });
  }
});

module.exports = router;
