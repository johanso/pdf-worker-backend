const fs = require('fs').promises;
const path = require('path');

async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // Archivo ya eliminado, ignorar
    }
  }
}

async function autoCleanup() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const dirs = ['uploads', 'outputs'];
  
  for (const dir of dirs) {
    const dirPath = path.join(__dirname, '../../', dir);
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath);
          console.log(`Deleted old file: ${file}`);
        }
      }
    } catch (err) {
      // Directorio no existe o error, ignorar
    }
  }
}

module.exports = { cleanupFiles, autoCleanup };
