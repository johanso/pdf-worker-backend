const rateLimit = require('express-rate-limit');

/**
 * Rate limiter general para todas las rutas de API
 * Previene abuso general del servicio
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  standardHeaders: true, // Devuelve info de rate limit en headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita headers `X-RateLimit-*`
  message: {
    error: 'Demasiadas solicitudes desde esta IP, por favor intenta de nuevo en 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '15 minutos'
  },
  // Excluir IPs locales del rate limit en desarrollo
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') {
      const ip = req.ip || req.connection.remoteAddress;
      return ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
    }
    return false;
  }
});

/**
 * Rate limiter estricto para operaciones de procesamiento de archivos
 * Estas operaciones consumen mucho CPU/memoria
 */
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 30, // 30 requests por ventana (3 por minuto promedio)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas operaciones de procesamiento. Por favor espera antes de procesar más archivos.',
    code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
    retryAfter: '10 minutos',
    hint: 'Este límite protege el servidor de sobrecarga. Contacta soporte si necesitas mayor capacidad.'
  },
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') {
      const ip = req.ip || req.connection.remoteAddress;
      return ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
    }
    return false;
  }
});

/**
 * Rate limiter muy estricto para operaciones OCR
 * OCR es extremadamente costoso en CPU y tiempo
 */
const ocrLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutos
  max: 10, // 10 requests por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Límite de operaciones OCR alcanzado. El OCR es un proceso muy costoso.',
    code: 'OCR_RATE_LIMIT_EXCEEDED',
    retryAfter: '30 minutos',
    hint: 'OCR consume muchos recursos. Procesa tus documentos en lotes para mayor eficiencia.'
  },
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') {
      const ip = req.ip || req.connection.remoteAddress;
      return ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
    }
    return false;
  }
});

/**
 * Rate limiter permisivo para health checks
 * Permite monitoreo frecuente sin bloquear
 */
const healthCheckLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // 60 requests por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiados health checks',
    code: 'HEALTH_CHECK_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * Rate limiter para descarga de archivos
 * Previene descarga masiva automatizada
 */
const downloadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 50, // 50 descargas por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas descargas en poco tiempo.',
    code: 'DOWNLOAD_RATE_LIMIT_EXCEEDED',
    retryAfter: '5 minutos'
  },
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') {
      const ip = req.ip || req.connection.remoteAddress;
      return ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
    }
    return false;
  }
});

module.exports = {
  apiLimiter,
  uploadLimiter,
  ocrLimiter,
  healthCheckLimiter,
  downloadLimiter
};
