const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      libreoffice: 'available',
      ghostscript: 'available',
      imagemagick: 'available',
      qpdf: 'available',
      tesseract: 'available',
      playwright: 'available'
    }
  });
});

// ===== RUTA DE DESCARGA =====
app.use('/api/download', require('./src/routes/download.route'));

// ===== RUTAS LIBREOFFICE =====
app.use('/api/word-to-pdf', require('./src/routes/word-to-pdf.route'));
app.use('/api/pdf-to-word', require('./src/routes/pdf-to-word.route'));
app.use('/api/excel-to-pdf', require('./src/routes/excel-to-pdf.route'));
app.use('/api/pdf-to-excel', require('./src/routes/pdf-to-excel.route'));
app.use('/api/ppt-to-pdf', require('./src/routes/ppt-to-pdf.route'));
app.use('/api/pdf-to-ppt', require('./src/routes/pdf-to-ppt.route'));
app.use('/api/preview/office', require('./src/routes/preview-office.route'));

// ===== RUTAS GHOSTSCRIPT =====
app.use('/api/compress-pdf', require('./src/routes/compress-pdf.route'));
app.use('/api/grayscale-pdf', require('./src/routes/grayscale-pdf.route'));

// ===== RUTAS GHOSTSCRIPT AND PDFTK =====
app.use('/api/flatten-pdf', require('./src/routes/flatten-pdf.route'));

// ===== RUTAS PDF-LIB =====
app.use('/api/merge-pdf', require('./src/routes/merge-pdf.route'));
app.use('/api/organize-pdf', require('./src/routes/organize-pdf.route'));
app.use('/api/rotate-pdf', require('./src/routes/rotate-pdf.route'));
app.use('/api/split-pdf', require('./src/routes/split-pdf.route'));
app.use('/api/process-pages', require('./src/routes/process-pages.route'));
app.use('/api/delete-pages', require('./src/routes/delete-pages.route'));

// ===== RUTAS IMAGEMAGICK =====
app.use('/api/pdf-to-image', require('./src/routes/pdf-to-image.route'));
app.use('/api/image-to-pdf', require('./src/routes/image-to-pdf.route'));

// ===== RUTAS QPDF =====
app.use('/api/protect-pdf', require('./src/routes/protect-pdf.route'));
app.use('/api/unlock-pdf', require('./src/routes/unlock-pdf.route'));
app.use('/api/repair-pdf', require('./src/routes/repair-pdf.route'));

// ===== HTML TO PDF (PLAYWRIGHT) =====
app.use('/api/html-to-pdf', require('./src/routes/html-to-pdf.route'));

// ===== OCR PDF (TESSERACT) =====
app.use('/api/ocr-pdf', require('./src/routes/ocr-pdf.route'));

// ===== MANEJO DE ERRORES =====
app.use(require('./src/middleware/error.middleware'));

// Auto-cleanup cada hora
const { autoCleanup } = require('./src/utils/cleanup.utils');
setInterval(autoCleanup, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`PDF Worker running on port ${PORT}`);
  console.log(`Endpoints disponibles:`);
  console.log(` - GET  /health`);
  console.log(` - GET  /api/download/:fileId`);
  console.log(` - POST /api/ocr-pdf`);
  console.log(` - POST /api/ocr-pdf/detect`);
  console.log(` - GET  /api/ocr-pdf/languages`);
  console.log(` - GET  /api/ocr-pdf/health`);
});