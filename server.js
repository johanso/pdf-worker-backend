require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const {
  apiLimiter,
  uploadLimiter,
  ocrLimiter,
  healthCheckLimiter,
  downloadLimiter
} = require('./src/middleware/rate-limit.middleware');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - necesario para obtener IPs reales detrás de reverse proxy (Caddy)
app.set('trust proxy', 1);

// ===== CONFIGURACIÓN DE CORS =====
// Obtener orígenes permitidos desde variable de entorno
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = allowedOriginsEnv
  .split(',')
  .map(origin => origin.trim())
  .filter(origin => origin.length > 0);

// En desarrollo, permitir localhost si no hay orígenes configurados
if (process.env.NODE_ENV === 'development' && allowedOrigins.length === 0) {
  allowedOrigins.push('http://localhost:3000');
  allowedOrigins.push('http://localhost:5173');
  allowedOrigins.push('http://localhost:5174');
  console.log('[CORS] Modo desarrollo: permitiendo localhost');
}

// Configuración de CORS restrictiva
const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requests sin origin (ej: Postman, curl, aplicaciones móviles)
    if (!origin) {
      return callback(null, true);
    }

    // Verificar si el origin está en la whitelist
    if (allowedOrigins.length === 0) {
      // Si no hay orígenes configurados, rechazar (excepto en desarrollo)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[CORS] WARN: No hay orígenes configurados. Permitiendo ${origin} en desarrollo.`);
        return callback(null, true);
      }
      console.log(`[CORS] Rechazado: ${origin} (no hay orígenes configurados)`);
      return callback(new Error('No está permitido por CORS'));
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Rechazado: ${origin}`);
      console.log(`[CORS] Orígenes permitidos: ${allowedOrigins.join(', ')}`);
      callback(new Error('No está permitido por CORS'));
    }
  },
  credentials: true, // Permitir cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 86400 // Cache preflight request por 24 horas
};

app.use(cors(corsOptions));

// Log de configuración CORS al iniciar
if (allowedOrigins.length > 0) {
  console.log(`[CORS] Orígenes permitidos: ${allowedOrigins.join(', ')}`);
} else {
  console.log(`[CORS] ⚠️  ADVERTENCIA: No hay orígenes configurados en ALLOWED_ORIGINS`);
}

// Middleware
app.use(express.json());

// Rate limiter general para todas las rutas /api/* como fallback
// Este se aplica a rutas que no tienen un limiter específico
app.use('/api/', apiLimiter);

// Health check con rate limiting permisivo
app.get('/health', healthCheckLimiter, (req, res) => {
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
app.use('/api/download', downloadLimiter, require('./src/routes/download.route'));

// ===== RUTAS LIBREOFFICE =====
app.use('/api/word-to-pdf', uploadLimiter, require('./src/routes/word-to-pdf.route'));
app.use('/api/pdf-to-word', uploadLimiter, require('./src/routes/pdf-to-word.route'));
app.use('/api/excel-to-pdf', uploadLimiter, require('./src/routes/excel-to-pdf.route'));
app.use('/api/pdf-to-excel', uploadLimiter, require('./src/routes/pdf-to-excel.route'));
app.use('/api/ppt-to-pdf', uploadLimiter, require('./src/routes/ppt-to-pdf.route'));
app.use('/api/pdf-to-ppt', uploadLimiter, require('./src/routes/pdf-to-ppt.route'));
app.use('/api/preview/office', uploadLimiter, require('./src/routes/preview-office.route'));

// ===== RUTAS GHOSTSCRIPT =====
app.use('/api/compress-pdf', uploadLimiter, require('./src/routes/compress-pdf.route'));
app.use('/api/grayscale-pdf', uploadLimiter, require('./src/routes/grayscale-pdf.route'));

// ===== RUTAS GHOSTSCRIPT AND PDFTK =====
app.use('/api/flatten-pdf', uploadLimiter, require('./src/routes/flatten-pdf.route'));

// ===== RUTAS PDF-LIB =====
app.use('/api/merge-pdf', uploadLimiter, require('./src/routes/merge-pdf.route'));
app.use('/api/organize-pdf', uploadLimiter, require('./src/routes/organize-pdf.route'));
app.use('/api/rotate-pdf', uploadLimiter, require('./src/routes/rotate-pdf.route'));
app.use('/api/split-pdf', uploadLimiter, require('./src/routes/split-pdf.route'));
app.use('/api/process-pages', uploadLimiter, require('./src/routes/process-pages.route'));
app.use('/api/delete-pages', uploadLimiter, require('./src/routes/delete-pages.route'));

// ===== RUTAS IMAGEMAGICK =====
app.use('/api/pdf-to-image', uploadLimiter, require('./src/routes/pdf-to-image.route'));
app.use('/api/image-to-pdf', uploadLimiter, require('./src/routes/image-to-pdf.route'));

// ===== RUTAS QPDF =====
app.use('/api/protect-pdf', uploadLimiter, require('./src/routes/protect-pdf.route'));
app.use('/api/unlock-pdf', uploadLimiter, require('./src/routes/unlock-pdf.route'));
app.use('/api/repair-pdf', uploadLimiter, require('./src/routes/repair-pdf.route'));

// ===== HTML TO PDF (PLAYWRIGHT) =====
app.use('/api/html-to-pdf', uploadLimiter, require('./src/routes/html-to-pdf.route'));

// ===== OCR PDF (TESSERACT) - Rate limit más estricto =====
app.use('/api/ocr-pdf', ocrLimiter, require('./src/routes/ocr-pdf.route'));

// ===== FIRMAR PDF (PDF-LIB + OPENSSL) =====
app.use('/api/sign-pdf', uploadLimiter, require('./src/routes/sign-pdf.route'));

// ===== CENSURAR PDF (PDF-LIB) =====
app.use('/api/censure-pdf', uploadLimiter, require('./src/routes/censure-pdf.route'));

// ===== MANEJO DE ERRORES =====
app.use(require('./src/middleware/error.middleware'));

// Auto-cleanup cada hora
const { autoCleanup } = require('./src/utils/cleanup.utils');
setInterval(autoCleanup, 60 * 60 * 1000);

/**
 * Asegura que existan los directorios necesarios al iniciar
 * Previene errores si los directorios fueron eliminados o en deploys limpios
 */
async function ensureDirectories() {
  const dirs = [
    path.join(__dirname, 'uploads'),   // Archivos subidos por multer
    path.join(__dirname, 'outputs'),   // Archivos procesados temporales
    path.join(__dirname, 'downloads')  // Archivos listos para descarga (FileStore)
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`[Setup] Directory ensured: ${path.basename(dir)}/`);
    } catch (error) {
      console.error(`[Setup] Error creating directory ${dir}:`, error.message);
    }
  }
}

// Iniciar servidor con verificación de directorios
async function startServer() {
  // Crear directorios necesarios
  await ensureDirectories();

  // Iniciar servidor
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
}

// Iniciar
startServer().catch(error => {
  console.error('[Setup] Failed to start server:', error);
  process.exit(1);
});