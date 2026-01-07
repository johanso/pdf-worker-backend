const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * POST /api/protect-pdf
 * Protege un PDF con contraseña y permisos granulares usando QPDF
 * 
 * Body params:
 * - file: archivo PDF
 * - userPassword: contraseña para abrir el PDF (opcional)
 * - ownerPassword: contraseña de propietario (opcional, default = userPassword)
 * - encryption: '128' | '256' (default: '256')
 * - permissions: JSON string con permisos (opcional)
 *   - print: boolean (default: false)
 *   - copy: boolean (default: false)
 *   - modify: boolean (default: false)
 *   - annotate: boolean (default: false)
 *   - fillForms: boolean (default: false)
 *   - assemble: boolean (default: false)
 * - compressed: 'true' si el archivo viene comprimido con gzip
 */
router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
    }

    const originalName = req.file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.pdf$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }

    // Validar que al menos una contraseña esté presente
    const userPassword = req.body.userPassword || '';
    const ownerPassword = req.body.ownerPassword || userPassword;
    
    if (!userPassword && !ownerPassword) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Se requiere al menos una contraseña' });
    }

    if (userPassword && userPassword.length < 4) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    // Descomprimir si es necesario
    const isCompressed = req.body.compressed === 'true';
    let inputPath = req.file.path;

    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      const buffer = await fs.readFile(req.file.path);
      const decompressed = await decompressIfNeeded(buffer, req.file.originalname);
      if (decompressed !== buffer) {
        inputPath = req.file.path + '.pdf';
        await fs.writeFile(inputPath, decompressed);
        tempFiles.push(inputPath);
      }
    }
    
    // Obtener tamaño original
    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size;

    // Parsear permisos
    let permissions = {
      print: false,
      copy: false,
      modify: false,
      annotate: false,
      fillForms: false,
      assemble: false
    };

    if (req.body.permissions) {
      try {
        const parsed = JSON.parse(req.body.permissions);
        permissions = { ...permissions, ...parsed };
      } catch (e) {
        console.log('[Protect] Error parsing permissions, using defaults');
      }
    }

    // Nivel de encriptación
    const encryption = req.body.encryption === '128' ? '128' : '256';

    console.log(`[Protect] Processing: ${originalName}`);
    console.log(`[Protect] Encryption: ${encryption}-bit, User PWD: ${userPassword ? 'yes' : 'no'}, Owner PWD: ${ownerPassword ? 'yes' : 'no'}`);
    console.log(`[Protect] Permissions:`, permissions);

    const startTime = Date.now();
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-protected-${timestamp}.pdf`);

    // Construir argumentos de permisos para QPDF
    // QPDF usa --print=none|low|full, --modify=none|all, etc.
    const permissionArgs = [];

    // Print: none, low (solo baja resolución), full
    if (permissions.print) {
      permissionArgs.push('--print=full');
    } else {
      permissionArgs.push('--print=none');
    }

    // Modify: none, annotate, form, assembly, all
    if (permissions.modify) {
      permissionArgs.push('--modify=all');
    } else if (permissions.annotate && permissions.fillForms && permissions.assemble) {
      permissionArgs.push('--modify=annotate');
    } else if (permissions.fillForms) {
      permissionArgs.push('--modify=form');
    } else if (permissions.assemble) {
      permissionArgs.push('--modify=assembly');
    } else if (permissions.annotate) {
      permissionArgs.push('--modify=annotate');
    } else {
      permissionArgs.push('--modify=none');
    }

    // Extract/copy text
    if (permissions.copy) {
      permissionArgs.push('--extract=y');
    } else {
      permissionArgs.push('--extract=n');
    }

    // Annotate (si no está incluido en modify)
    if (permissions.annotate && !permissions.modify) {
      permissionArgs.push('--annotate=y');
    } else if (!permissions.annotate) {
      permissionArgs.push('--annotate=n');
    }

    // Construir comando QPDF
    // Formato: qpdf --encrypt user-password owner-password key-length [restrictions] -- input output
    const encryptionKey = encryption === '256' ? '256' : '128';
    
    // Escapar contraseñas para shell (reemplazar comillas)
    const escapePassword = (pwd) => pwd.replace(/'/g, "'\\''");
    const escapedUserPwd = escapePassword(userPassword || '');
    const escapedOwnerPwd = escapePassword(ownerPassword || userPassword);

    const cmd = `qpdf --encrypt '${escapedUserPwd}' '${escapedOwnerPwd}' ${encryptionKey} ${permissionArgs.join(' ')} -- "${inputPath}" "${outputPath}"`;
    
    console.log(`[Protect] Command: qpdf --encrypt [user] [owner] ${encryptionKey} ${permissionArgs.join(' ')} -- input output`);

    await execAsync(cmd);
    tempFiles.push(outputPath);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Protect] Completed in ${elapsed}s`);

    // Obtener tamaño resultante
    const resultStats = await fs.stat(outputPath);
    const resultSize = resultStats.size;

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = originalName.replace(/\.pdf$/i, '-protected.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Protect] Complete: ${outputFileName} (${(resultSize/1024/1024).toFixed(2)}MB)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize,
      encryption: `${encryption}-bit`,
      permissions,
      hasUserPassword: !!userPassword,
      hasOwnerPassword: !!ownerPassword
    });
    
  } catch (error) {
    console.error('[Protect] Error:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al proteger PDF';
    if (error.message.includes('already encrypted')) {
      errorMessage = 'El PDF ya está protegido. Desbloquéalo primero.';
    }
    
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

/**
 * GET /api/protect-pdf/info
 * Información sobre opciones disponibles
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Protege PDFs con contraseña y restricciones de seguridad',
    useCases: [
      'Proteger documentos confidenciales',
      'Evitar que copien tu contenido',
      'Restringir impresión no autorizada',
      'Compartir PDFs de solo lectura'
    ],
    passwords: {
      user: {
        label: 'Contraseña para abrir',
        description: 'Se pedirá esta contraseña para poder ver el documento',
        required: false
      },
      owner: {
        label: 'Contraseña de propietario',
        description: 'Permite saltarse las restricciones (si no se especifica, usa la de usuario)',
        required: false
      }
    },
    encryptionOptions: [
      { value: '256', label: '256-bit AES', description: 'Máxima seguridad (recomendado)', default: true },
      { value: '128', label: '128-bit AES', description: 'Compatible con lectores antiguos' }
    ],
    permissionOptions: [
      { key: 'print', label: 'Permitir imprimir', description: 'El usuario puede imprimir el documento', default: false },
      { key: 'copy', label: 'Permitir copiar texto', description: 'El usuario puede seleccionar y copiar texto', default: false },
      { key: 'modify', label: 'Permitir editar', description: 'El usuario puede modificar el contenido', default: false },
      { key: 'annotate', label: 'Permitir comentarios', description: 'El usuario puede agregar notas y comentarios', default: false },
      { key: 'fillForms', label: 'Permitir llenar formularios', description: 'El usuario puede completar campos de formulario', default: false },
      { key: 'assemble', label: 'Permitir reorganizar', description: 'El usuario puede agregar, eliminar o rotar páginas', default: false }
    ],
    limits: {
      maxFileSize: '150MB',
      minPasswordLength: 4
    },
    engine: 'qpdf'
  });
});

module.exports = router;