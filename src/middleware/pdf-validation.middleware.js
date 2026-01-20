const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const { sanitizeFilename } = require('../utils/file.utils');

/**
 * Middleware para validar PDFs
 * Detecta si está encriptado o corrupto
 */
async function validatePdf(req, res, next) {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    
    if (files.length === 0) {
      return next();
    }

    for (const file of files) {
      const buffer = await fs.readFile(file.path);
      
      // Verificar si el PDF tiene marcadores de encriptación en el header
      const header = buffer.slice(0, 1024).toString('utf-8');
      
      try {
        // Intentar cargar SIN ignoreEncryption para detectar protección
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: false });
        
        // Verificar si tiene páginas válidas
        if (pdf.getPageCount() === 0) {
          return res.status(400).json({
            error: 'El archivo PDF no contiene páginas',
            code: 'PDF_EMPTY',
            fileName: sanitizeFilename(file.originalname)
          });
        }

      } catch (error) {
        const errorMsg = error.message.toLowerCase();

        // Detectar PDF encriptado
        if (errorMsg.includes('encrypted') ||
            errorMsg.includes('password') ||
            errorMsg.includes('decrypt')) {
          return res.status(400).json({
            error: 'El archivo está protegido con contraseña. Usa la herramienta "Desbloquear PDF" primero.',
            code: 'PDF_ENCRYPTED',
            fileName: sanitizeFilename(file.originalname)
          });
        }

        // Detectar PDF corrupto
        if (errorMsg.includes('invalid') ||
            errorMsg.includes('failed') ||
            errorMsg.includes('parse') ||
            errorMsg.includes('expected')) {
          return res.status(400).json({
            error: 'El archivo PDF está corrupto o no es válido',
            code: 'PDF_INVALID',
            fileName: sanitizeFilename(file.originalname)
          });
        }
        
        // Error desconocido, loguear pero continuar
        console.warn('PDF validation warning:', error.message);
      }
    }
    
    next();
  } catch (error) {
    console.error('Error in PDF validation middleware:', error);
    next(); // Continuar si hay error en el middleware mismo
  }
}

/**
 * Versión async para usar con await en lugar de middleware
 */
async function checkPdfProtection(filePath) {
  const buffer = await fs.readFile(filePath);
  
  try {
    await PDFDocument.load(buffer, { ignoreEncryption: false });
    return { valid: true };
  } catch (error) {
    const errorMsg = error.message.toLowerCase();
    
    if (errorMsg.includes('encrypted') || errorMsg.includes('password')) {
      return { valid: false, code: 'PDF_ENCRYPTED', error: 'PDF protegido con contraseña' };
    }
    
    if (errorMsg.includes('invalid') || errorMsg.includes('failed')) {
      return { valid: false, code: 'PDF_INVALID', error: 'PDF corrupto o inválido' };
    }
    
    return { valid: true }; // En caso de duda, intentar procesar
  }
}

module.exports = { validatePdf, checkPdfProtection };
