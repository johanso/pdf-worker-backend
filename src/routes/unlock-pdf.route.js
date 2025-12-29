const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const qpdfService = require('../services/qpdf.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  const password = req.body.password;
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    if (!password) {
      return res.status(400).json({ error: 'Se requiere contraseña' });
    }
    
    const outputPath = await qpdfService.decryptPdf(inputPath, outputDir, password);
    
    res.download(outputPath, path.basename(outputPath), async (err) => {
      await cleanupFiles([inputPath, outputPath]);
    });
    
  } catch (error) {
    console.error('Error al desbloquear PDF:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Contraseña incorrecta o error al desbloquear', details: error.message });
  }
});

module.exports = router;
