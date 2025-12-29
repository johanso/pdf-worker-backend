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
      qpdf: 'available'
    }
  });
});

// ===== RUTAS LIBREOFFICE =====
app.use('/api/word-to-pdf', require('./src/routes/word-to-pdf.route'));
app.use('/api/pdf-to-word', require('./src/routes/pdf-to-word.route'));
app.use('/api/excel-to-pdf', require('./src/routes/excel-to-pdf.route'));
app.use('/api/pdf-to-excel', require('./src/routes/pdf-to-excel.route'));
app.use('/api/ppt-to-pdf', require('./src/routes/ppt-to-pdf.route'));
app.use('/api/pdf-to-ppt', require('./src/routes/pdf-to-ppt.route'));

// ===== RUTAS GHOSTSCRIPT =====
app.use('/api/compress-pdf', require('./src/routes/compress-pdf.route'));

// ===== RUTAS IMAGEMAGICK =====
app.use('/api/pdf-to-image', require('./src/routes/pdf-to-image.route'));
app.use('/api/merge-pdf', require('./src/routes/merge-pdf.route'));
app.use('/api/organize-pdf', require('./src/routes/organize-pdf.route'));
app.use('/api/rotate-pdf', require('./src/routes/rotate-pdf.route'));
app.use('/api/split-pdf', require('./src/routes/split-pdf.route'));
app.use('/api/process-pages', require('./src/routes/process-pages.route'));

// ===== RUTAS QPDF =====
app.use('/api/protect-pdf', require('./src/routes/protect-pdf.route'));
app.use('/api/unlock-pdf', require('./src/routes/unlock-pdf.route'));

// ===== MANEJO DE ERRORES =====
app.use(require('./src/middleware/error.middleware'));

// Auto-cleanup cada hora
const { autoCleanup } = require('./src/utils/cleanup.utils');
setInterval(autoCleanup, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 PDF Worker running on port ${PORT}`);
  console.log(`📍 Available endpoints:`);
  console.log(`   - POST /api/word-to-pdf`);
  console.log(`   - POST /api/pdf-to-word`);
  console.log(`   - POST /api/excel-to-pdf`);
  console.log(`   - POST /api/pdf-to-excel`);
  console.log(`   - POST /api/ppt-to-pdf`);
  console.log(`   - POST /api/pdf-to-ppt`);
  console.log(`   - POST /api/compress-pdf`);
  console.log(`   - POST /api/pdf-to-image`);
  console.log(`   - POST /api/protect-pdf`);
  console.log(`   - POST /api/unlock-pdf`);
});

// HTML to PDF
app.use('/api/html-to-pdf', require('./src/routes/html-to-pdf.route'));
