const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const qpdfService = require('../services/qpdf.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../../outputs');
  const password = req.body.password;
  
  try {
    if (!req.file.originalname.match(/\.pdf$/i)) {
      await cleanupFiles([inputPath]);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }
    
    if (!password) {
      await cleanupFiles([inputPath]);
      return res.status(400).json({ error: 'Se requiere contraseña' });
    }
    
    const outputPath = await qpdfService.decryptPdf(inputPath, outputDir, password);
    const pdfBuffer = await fs.readFile(outputPath);
    await cleanupFiles([inputPath, outputPath]);

    const fileName = 'unlocked-' + req.file.originalname;
    const fileId = await fileStore.storeFile(pdfBuffer, fileName, 'application/pdf');

    res.json({ success: true, fileId, fileName });
    
  } catch (error) {
    console.error('Error al desbloquear PDF:', error);
    await cleanupFiles([inputPath]);
    res.status(500).json({ error: 'Contraseña incorrecta o error al desbloquear', details: error.message });
  }
});

module.exports = router;