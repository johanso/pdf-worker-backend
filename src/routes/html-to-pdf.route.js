const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const wkhtmltopdfService = require('../services/wkhtmltopdf.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const { execAsync } = require('../utils/file.utils');
const path = require('path');

// Endpoint principal de conversión
router.post('/', upload.single('file'), async (req, res) => {
  let inputPath;
  const outputDir = path.join(__dirname, '../../outputs');
  const tempFiles = [];
  
  try {
    const isUrl = req.body.isUrl === 'true';
    
    if (isUrl) {
      inputPath = req.body.url;
      if (!inputPath) {
        return res.status(400).json({ error: 'URL requerida' });
      }
    } else {
      if (!req.file) {
        return res.status(400).json({ error: 'Archivo HTML requerido' });
      }
      inputPath = req.file.path;
      tempFiles.push(inputPath);
    }
    
    const options = {
      format: req.body.pageFormat || 'A4',
      isUrl
    };
    
    const outputPath = await wkhtmltopdfService.htmlToPdf(inputPath, outputDir, options);
    tempFiles.push(outputPath);
    
    res.download(outputPath, path.basename(outputPath), async (err) => {
      await cleanupFiles(tempFiles);
    });
    
  } catch (error) {
    console.error('Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

// Nuevo endpoint de preview (screenshot estático)
router.post('/preview', upload.single('file'), async (req, res) => {
  let inputPath;
  const outputDir = path.join(__dirname, '../../outputs');
  const tempFiles = [];
  
  try {
    const isUrl = req.body.isUrl === 'true';
    
    if (isUrl) {
      inputPath = req.body.url;
    } else {
      if (!req.file) {
        return res.status(400).json({ error: 'Archivo requerido' });
      }
      inputPath = req.file.path;
      tempFiles.push(inputPath);
    }
    
    const viewport = req.body.viewport ? JSON.parse(req.body.viewport) : { width: 1440, height: 900 };
    const outputPath = path.join(outputDir, `preview-${Date.now()}.png`);
    tempFiles.push(outputPath);
    
    const source = isUrl ? inputPath : `file://${inputPath}`;
    
    // Generar screenshot con wkhtmltoimage
    await execAsync(`wkhtmltoimage \
      --width ${viewport.width} \
      --quality 90 \
      --enable-javascript \
      --javascript-delay 1000 \
      --load-error-handling ignore \
      "${source}" "${outputPath}"`);
    
    res.sendFile(outputPath, async (err) => {
      await cleanupFiles(tempFiles);
    });
    
  } catch (error) {
    console.error('Error generando preview:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al generar preview' });
  }
});

module.exports = router;
