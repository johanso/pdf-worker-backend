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
 * POST /api/repair-pdf
 * Repara un PDF dañado o corrupto usando QPDF
 * 
 * Body params:
 * - file: archivo PDF
 * - mode: 'auto' | 'aggressive' | 'linearize' (default: 'auto')
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

    // Opciones
    const mode = req.body.mode || 'auto';
    const validModes = ['auto', 'aggressive', 'linearize'];
    const finalMode = validModes.includes(mode) ? mode : 'auto';

    console.log(`[Repair] Processing: ${originalName} - Mode: ${finalMode}`);
    const startTime = Date.now();

    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-repaired-${timestamp}.pdf`);

    // Primero verificar el estado del PDF
    let checkResult;
    let warnings = [];
    
    try {
      checkResult = await execAsync(`qpdf --check "${inputPath}" 2>&1 || true`);
      if (checkResult.stdout) {
        // Extraer advertencias
        const lines = checkResult.stdout.split('\n').filter(l => l.trim());
        warnings = lines.filter(l => 
          l.includes('warning') || 
          l.includes('error') || 
          l.includes('recovering')
        );
      }
    } catch (e) {
      // El check puede fallar en archivos muy dañados, continuamos
      warnings.push('No se pudo verificar el archivo - posiblemente muy dañado');
    }

    // Construir comando según el modo
    let cmd;
    let repairActions = [];
    
    switch (finalMode) {
      case 'aggressive':
        // Modo agresivo: reconstruye todo desde cero
        cmd = `qpdf --qdf --object-streams=disable --compress-streams=n "${inputPath}" "${outputPath}"`;
        repairActions = ['Reconstrucción completa', 'Streams descomprimidos', 'Objetos reorganizados'];
        break;
        
      case 'linearize':
        // Modo linearize: optimiza para web + repara
        cmd = `qpdf --linearize --compress-streams=y "${inputPath}" "${outputPath}"`;
        repairActions = ['Linearizado para web', 'Streams optimizados', 'Estructura reparada'];
        break;
        
      case 'auto':
      default:
        // Modo auto: reparación estándar
        cmd = `qpdf --compress-streams=y "${inputPath}" "${outputPath}"`;
        repairActions = ['Tabla xref reconstruida', 'Objetos verificados', 'Streams comprimidos'];
        break;
    }

    await execAsync(cmd);
    tempFiles.push(outputPath);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Repair] Completed in ${elapsed}s`);

    // Verificar que el archivo reparado es válido
    try {
      await execAsync(`qpdf --check "${outputPath}"`);
    } catch (e) {
      // Si aún tiene errores después de reparar, intentar modo más agresivo
      if (finalMode !== 'aggressive') {
        console.log('[Repair] Standard repair failed, trying aggressive mode...');
        const aggressivePath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-repaired-aggressive-${timestamp}.pdf`);
        await execAsync(`qpdf --qdf --object-streams=disable "${inputPath}" "${aggressivePath}"`);
        tempFiles.push(aggressivePath);
        
        // Verificar si el agresivo funcionó
        try {
          await execAsync(`qpdf --check "${aggressivePath}"`);
          // Si funcionó, usar este
          await fs.unlink(outputPath).catch(() => {});
          await fs.rename(aggressivePath, outputPath);
          repairActions.push('Reparación agresiva aplicada');
        } catch (e2) {
          // Mantener el original reparado aunque tenga advertencias
        }
      }
    }

    // Obtener tamaño resultante
    const resultStats = await fs.stat(outputPath);
    const resultSize = resultStats.size;

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = req.body.fileName || originalName.replace(/\.pdf$/i, '-repaired.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Repair] Complete: ${(originalSize/1024/1024).toFixed(2)}MB -> ${(resultSize/1024/1024).toFixed(2)}MB`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize,
      mode: finalMode,
      repairActions,
      warnings: warnings.length > 0 ? warnings.slice(0, 5) : [],
      fullyRepaired: warnings.length === 0
    });
    
  } catch (error) {
    console.error('[Repair] Error:', error);
    await cleanupFiles(tempFiles);
    
    // Mensajes de error más amigables
    let errorMessage = 'Error al reparar PDF';
    if (error.message.includes('invalid password')) {
      errorMessage = 'El PDF está protegido con contraseña. Desbloquéalo primero.';
    } else if (error.message.includes('not a PDF')) {
      errorMessage = 'El archivo no es un PDF válido';
    } else if (error.message.includes('damaged beyond repair')) {
      errorMessage = 'El PDF está demasiado dañado para ser reparado';
    }
    
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

/**
 * POST /api/repair-pdf/check
 * Verifica el estado de un PDF sin repararlo
 */
router.post('/check', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
    }

    const originalName = req.file.originalname.replace(/\.gz$/, '');
    
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

    console.log(`[Repair Check] Analyzing: ${originalName}`);

    let status = 'ok';
    let issues = [];
    let canRepair = true;

    // ✅ Primero verificar que sea un PDF válido leyendo la cabecera
    try {
      const buffer = await fs.readFile(inputPath);
      const header = buffer.toString('ascii', 0, 8);
      
      if (!header.startsWith('%PDF-')) {
        status = 'invalid';
        issues.push('El archivo no es un PDF válido');
        canRepair = false;
        
        await cleanupFiles(tempFiles);
        return res.json({
          success: true,
          fileName: originalName,
          status,
          issues,
          canRepair,
          recommendation: 'El archivo no es un PDF válido'
        });
      }
    } catch (e) {
      status = 'invalid';
      issues.push('No se pudo leer el archivo');
      canRepair = false;
      
      await cleanupFiles(tempFiles);
      return res.json({
        success: true,
        fileName: originalName,
        status,
        issues,
        canRepair,
        recommendation: 'El archivo no es válido'
      });
    }

    // ✅ Ejecutar qpdf --check y capturar stdout/stderr correctamente
    try {
      const { stdout, stderr } = await execAsync(`qpdf --check "${inputPath}"`);
      const output = stdout + stderr;
      
      // Si contiene esta línea, el PDF está bien
      if (output.includes('No syntax or stream encoding errors') || 
          output.includes('no errors')) {
        status = 'ok';
      } else if (output.includes('warning')) {
        status = 'damaged';
        issues.push('Advertencias menores detectadas');
      }
    } catch (e) {
      // ✅ qpdf retorna exit code != 0 cuando hay errores
      const output = (e.stdout || '') + (e.stderr || '') + (e.message || '');
      
      // Verificar si está encriptado
      if (output.includes('invalid password') || 
          output.includes('encrypted') ||
          output.includes('operation requires password')) {
        status = 'encrypted';
        issues.push('El PDF está protegido con contraseña');
        canRepair = false;
      } else {
        status = 'damaged';
        
        // Extraer problemas específicos
        if (output.includes('xref')) issues.push('Tabla de referencias dañada');
        if (output.includes('stream')) issues.push('Streams de datos corruptos');
        if (output.includes('object')) issues.push('Objetos internos dañados');
        if (output.includes('trailer')) issues.push('Trailer del PDF dañado');
        if (output.includes('page')) issues.push('Posibles páginas afectadas');
        
        if (issues.length === 0) {
          issues.push('Estructura del PDF dañada');
        }
      }
    }

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileName: originalName,
      status,
      issues,
      canRepair,
      recommendation: status === 'ok' 
        ? 'El PDF parece estar en buen estado' 
        : status === 'encrypted'
        ? 'Desbloquea el PDF primero'
        : status === 'invalid'
        ? 'El archivo no es un PDF válido'
        : 'Se recomienda reparar este PDF'
    });
    
  } catch (error) {
    console.error('[Repair Check] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al verificar PDF', details: error.message });
  }
});

/**
 * GET /api/repair-pdf/info
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Repara PDFs dañados o corruptos reconstruyendo su estructura interna',
    useCases: [
      'Recuperar PDFs que no abren o dan error',
      'Arreglar archivos descargados incompletos',
      'Reparar documentos de discos dañados',
      'Solucionar errores de "archivo corrupto"'
    ],
    modeOptions: [
      { 
        value: 'auto', 
        label: 'Automático', 
        description: 'Detecta y repara problemas comunes',
        default: true 
      },
      { 
        value: 'aggressive', 
        label: 'Reparación profunda', 
        description: 'Reconstruye todo el PDF desde cero (más lento)' 
      },
      { 
        value: 'linearize', 
        label: 'Reparar y optimizar', 
        description: 'Repara y optimiza para visualización web' 
      }
    ],
    limits: {
      maxFileSize: '150MB'
    },
    engine: 'qpdf'
  });
});

module.exports = router;