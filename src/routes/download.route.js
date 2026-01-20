const express = require('express');
const router = express.Router();
const fileStore = require('../services/file-store.service');

/**
 * @swagger
 * /api/download/{fileId}:
 *   get:
 *     summary: Descarga un archivo procesado
 *     description: Descarga el archivo resultante de cualquier operación usando el fileId retornado
 *     tags: [Download]
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del archivo retornado en la respuesta de procesamiento
 *         example: abc123def456
 *     responses:
 *       200:
 *         description: Archivo descargado exitosamente
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.wordprocessingml.document:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Archivo no encontrado o expirado (se eliminan automáticamente después de 1 hora)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Archivo no encontrado o expirado
 *                 code:
 *                   type: string
 *                   example: FILE_NOT_FOUND
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
 * @swagger
 * /api/download/{fileId}:
 *   delete:
 *     summary: Elimina un archivo procesado manualmente
 *     description: Los archivos se eliminan automáticamente después de 1 hora. Este endpoint permite eliminarlos antes.
 *     tags: [Download]
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del archivo a eliminar
 *     responses:
 *       200:
 *         description: Archivo eliminado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 */
router.delete('/:fileId', async (req, res) => {
  const { fileId } = req.params;
  await fileStore.deleteFile(fileId);
  res.json({ success: true });
});

module.exports = router;
