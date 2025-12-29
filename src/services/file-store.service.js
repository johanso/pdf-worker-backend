const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Almacén en memoria: { fileId: { path, fileName, mimeType, createdAt } }
const fileStore = new Map();

// Directorio para archivos temporales de descarga
const DOWNLOAD_DIR = path.join(__dirname, '../../downloads');

// Tiempo de expiración: 10 minutos
const EXPIRATION_MS = 10 * 60 * 1000;

// Asegurar que existe el directorio
async function ensureDir() {
  try {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  } catch (e) {}
}

/**
 * Guarda un archivo y devuelve un fileId único
 */
async function storeFile(buffer, fileName, mimeType) {
  await ensureDir();
  
  const fileId = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(fileName) || '.bin';
  const storedName = `${fileId}${ext}`;
  const filePath = path.join(DOWNLOAD_DIR, storedName);
  
  await fs.writeFile(filePath, buffer);
  
  fileStore.set(fileId, {
    path: filePath,
    fileName,
    mimeType,
    createdAt: Date.now()
  });
  
  console.log(`[FileStore] Stored: ${fileId} -> ${fileName}`);
  return fileId;
}

/**
 * Obtiene info de un archivo por su ID
 */
function getFile(fileId) {
  return fileStore.get(fileId) || null;
}

/**
 * Elimina un archivo del store
 */
async function deleteFile(fileId) {
  const file = fileStore.get(fileId);
  if (file) {
    try {
      await fs.unlink(file.path);
    } catch (e) {}
    fileStore.delete(fileId);
    console.log(`[FileStore] Deleted: ${fileId}`);
  }
}

/**
 * Limpia archivos expirados
 */
async function cleanupExpired() {
  const now = Date.now();
  for (const [fileId, file] of fileStore.entries()) {
    if (now - file.createdAt > EXPIRATION_MS) {
      await deleteFile(fileId);
    }
  }
}

// Limpieza automática cada 2 minutos
setInterval(cleanupExpired, 2 * 60 * 1000);

module.exports = {
  storeFile,
  getFile,
  deleteFile,
  cleanupExpired,
  DOWNLOAD_DIR
};
