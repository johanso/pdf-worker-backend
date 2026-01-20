const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

/**
 * Sanitiza el nombre de archivo para prevenir path traversal
 * Elimina: ../, ..\, caracteres especiales peligrosos, etc.
 */
function sanitizeFilename(filename) {
  // 1. Usar path.basename para eliminar cualquier ruta
  let safe = path.basename(filename);

  // 2. Eliminar caracteres nulos y peligrosos
  safe = safe.replace(/\x00/g, '');

  // 3. Eliminar secuencias de path traversal que pudieran quedar
  safe = safe.replace(/\.\.+/g, '.');

  // 4. Eliminar caracteres no permitidos (mantener letras, números, -, _, .)
  safe = safe.replace(/[^a-zA-Z0-9._-]/g, '_');

  // 5. Prevenir nombres que empiecen con punto (archivos ocultos)
  if (safe.startsWith('.')) {
    safe = '_' + safe;
  }

  // 6. Limitar longitud del nombre (máximo 200 caracteres)
  if (safe.length > 200) {
    const ext = path.extname(safe);
    const nameWithoutExt = safe.slice(0, 200 - ext.length);
    safe = nameWithoutExt + ext;
  }

  // 7. Si quedó vacío, usar un nombre genérico
  if (!safe || safe.length === 0) {
    safe = 'file';
  }

  return safe;
}

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    // Sanitizar nombre original
    const safeName = sanitizeFilename(file.originalname);

    // Generar ID único criptográficamente seguro
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();

    // Formato: timestamp-randomid-nombreoriginal.ext
    const uniqueName = `${timestamp}-${uniqueId}-${safeName}`;

    cb(null, uniqueName);
  }
});

// Extensiones permitidas (whitelist)
const ALLOWED_EXTENSIONS = new Set([
  // PDFs
  '.pdf',
  // Office
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Imágenes
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp',
  // HTML
  '.html', '.htm',
  // Comprimidos
  '.gz'
]);

/**
 * Validador de tipo de archivo
 */
function fileFilter(req, file, cb) {
  // Obtener extensión del archivo sanitizado
  const originalExt = path.extname(file.originalname).toLowerCase();

  // Quitar .gz si es comprimido para verificar la extensión real
  const realExt = originalExt === '.gz'
    ? path.extname(file.originalname.replace(/\.gz$/i, '')).toLowerCase()
    : originalExt;

  // Verificar si la extensión está permitida
  if (ALLOWED_EXTENSIONS.has(realExt) || ALLOWED_EXTENSIONS.has(originalExt)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de archivo no permitido: ${originalExt}. Extensiones permitidas: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`));
  }
}

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB
    files: 50
  }
});

// Exportar función de sanitización para usar en otras partes
module.exports.sanitizeFilename = sanitizeFilename;