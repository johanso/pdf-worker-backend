const express = require('express');
const router = express.Router();
const fileStore = require('../services/file-store.service');

/**
 * GET /api/download/:fileId
 * Descarga un archivo procesado por su ID
 */
router.get('/:fileId', async (req, res) => {
  const { fileId } = req.params;
  
  const file = fileStore.getFile(fileId);
  
  if (!file) {
    return res.status(404).json({ 
      error: 'Archivo no encontrado o expirado',
      code: 'FILE_NOT_FOUND'
    });
  }
  
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', 'attachment');
  
  res.sendFile(file.path, async (err) => {
    if (err) {
      console.error('[Download] Error sending file:', err);
    }
    // Opcional: eliminar después de descargar
    // await fileStore.deleteFile(fileId);
  });
});

/**
 * DELETE /api/download/:fileId
 * Elimina un archivo manualmente
 */
router.delete('/:fileId', async (req, res) => {
  const { fileId } = req.params;
  await fileStore.deleteFile(fileId);
  res.json({ success: true });
});

module.exports = router;
