const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const imageMagickService = require('../services/imagemagick.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  const format = req.body.format || 'jpg';
  const quality = parseInt(req.body.quality) || 90;
  const dpi = parseInt(req.body.dpi) || 300;
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    const outputFiles = await imageMagickService.pdfToImages(
      inputPath, outputDir, format, quality, dpi
    );
    
    if (outputFiles.length === 1) {
      res.download(outputFiles[0], path.basename(outputFiles[0]), async (err) => {
        await cleanupFiles([inputPath, ...outputFiles]);
      });
    } else {
      // TODO: Crear ZIP con múltiples imágenes
      res.json({ 
        message: 'Múltiples imágenes generadas',
        files: outputFiles.map(f => path.basename(f))
      });
    }
    
  } catch (error) {
    console.error('Error PDF→Imagen:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

module.exports = router;
