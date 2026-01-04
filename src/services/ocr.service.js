const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const execAsync = promisify(exec);

class OcrService {
  constructor() {
    this.outputDir = path.join(__dirname, '../../outputs');
  }

  /**
   * Detecta si un PDF necesita OCR
   */
  async detectPdfType(inputPath) {
    try {
      // Usar ocrmypdf --skip-text para detectar si ya tiene texto
      const { stdout } = await execAsync(
        `pdftotext -q "${inputPath}" - | wc -w`
      );
      const wordCount = parseInt(stdout.trim()) || 0;

      // Contar páginas
      const { stdout: pageInfo } = await execAsync(
        `pdfinfo "${inputPath}" 2>/dev/null | grep "Pages:" | awk '{print $2}'`
      );
      const pageCount = parseInt(pageInfo.trim()) || 1;
      const wordsPerPage = wordCount / pageCount;

      // Menos de 50 palabras por página = probablemente escaneado
      const needsOcr = wordsPerPage < 50;

      return {
        needsOcr,
        wordCount,
        pageCount,
        wordsPerPage: Math.round(wordsPerPage),
        type: needsOcr ? 'scanned' : 'text-based'
      };
    } catch (error) {
      console.error('[OCR] Error detecting PDF type:', error.message);
      return { needsOcr: true, wordCount: 0, pageCount: 1, wordsPerPage: 0, type: 'unknown' };
    }
  }

  /**
   * Aplica OCR usando ocrmypdf (MUCHO más rápido que tesseract directo)
   */
  async ocrPdf(inputPath, outputDir, options = {}) {
    const {
      languages = ['spa', 'eng'],
      dpi = 300,
      optimize = true,
      skipText = true  // No re-procesar páginas que ya tienen texto
    } = options;

    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = Date.now();
    const randomId = crypto.randomBytes(4).toString('hex');
    const outputPath = path.join(outputDir, `ocr-${timestamp}-${randomId}.pdf`);

    try {
      // Validar idiomas instalados
      const installedLangs = await this.getInstalledLanguages();
      const validLanguages = languages.filter(lang => installedLangs.includes(lang));
      
      if (validLanguages.length === 0) {
        validLanguages.push('eng');
      }

      // Contar páginas para el log
      const { stdout: pageInfo } = await execAsync(
        `pdfinfo "${inputPath}" 2>/dev/null | grep "Pages:" | awk '{print $2}'`
      );
      const pageCount = parseInt(pageInfo.trim()) || 1;

      console.log(`[OCR] Starting ocrmypdf: ${pageCount} pages, languages: ${validLanguages.join('+')}, dpi: ${dpi}`);

      // Construir comando ocrmypdf
      // --jobs 2: usa 2 CPUs en paralelo
      // --skip-text: no re-OCR páginas que ya tienen texto (más rápido)
      // --optimize 1-3: nivel de optimización (1=rápido, 3=máximo)
      // --fast-web-view: optimiza para visualización web
      // --deskew: endereza páginas torcidas
      const langParam = validLanguages.join('+');
      const optimizeLevel = optimize ? 2 : 0;
      const skipTextFlag = skipText ? '--skip-text' : '--force-ocr';
      
      const cmd = [
        'ocrmypdf',
        `--jobs 2`,                    // Usar 2 CPUs
        `--language ${langParam}`,     // Idiomas
        `--image-dpi ${dpi}`,          // DPI para imágenes sin metadata
        `--optimize ${optimizeLevel}`, // Nivel de optimización
        skipTextFlag,                  // Skip o force OCR
        '--deskew',                    // Enderezar páginas
        '--clean',                     // Limpiar imágenes antes de OCR
        '--quiet',                     // Menos output
        `"${inputPath}"`,
        `"${outputPath}"`
      ].join(' ');

      console.log(`[OCR] Command: ${cmd}`);

      const startTime = Date.now();
      await execAsync(cmd, { timeout: 600000 }); // 10 min timeout
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      // Verificar que se creó el archivo
      await fs.access(outputPath);
      const stats = await fs.stat(outputPath);

      console.log(`[OCR] Complete in ${duration}s: ${outputPath} (${Math.round(stats.size/1024)}KB)`);

      return outputPath;

    } catch (error) {
      // Limpiar archivo de salida si existe
      try {
        await fs.unlink(outputPath);
      } catch (e) {}

      // Parsear errores comunes de ocrmypdf
      const errorMsg = error.message || error.stderr || 'Error desconocido';
      
      if (errorMsg.includes('PriorOcrFoundError')) {
        throw new Error('Este PDF ya tiene texto OCR. Usa --force-ocr para re-procesar.');
      }
      if (errorMsg.includes('EncryptedPdfError')) {
        throw new Error('El PDF está encriptado. Desbloquéalo primero.');
      }
      if (errorMsg.includes('InputFileError')) {
        throw new Error('El archivo PDF está corrupto o no es válido.');
      }
      
      console.error('[OCR] Error:', errorMsg);
      throw new Error(`Error en OCR: ${errorMsg.substring(0, 200)}`);
    }
  }

  /**
   * Extrae solo el texto (sin generar PDF)
   */
  async extractText(inputPath, outputDir, options = {}) {
    const { languages = ['spa', 'eng'] } = options;

    try {
      // Primero intentar extraer texto existente
      const { stdout: existingText } = await execAsync(
        `pdftotext -q "${inputPath}" -`
      );

      if (existingText.trim().length > 100) {
        return {
          text: existingText.trim(),
          source: 'existing',
          pageCount: 1
        };
      }

      // Si no hay texto, usar OCR
      const langParam = languages.join('+');
      const { stdout } = await execAsync(
        `ocrmypdf --sidecar /dev/stdout --language ${langParam} --skip-text "${inputPath}" - 2>/dev/null || true`
      );

      return {
        text: stdout.trim(),
        source: 'ocr',
        languages
      };

    } catch (error) {
      console.error('[OCR] Extract text error:', error.message);
      throw new Error('Error al extraer texto');
    }
  }

  /**
   * Lista idiomas instalados en Tesseract
   */
  async getInstalledLanguages() {
    try {
      const { stdout } = await execAsync('tesseract --list-langs 2>&1');
      const lines = stdout.split('\n').slice(1);
      return lines.map(l => l.trim()).filter(l => l.length > 0 && l !== 'osd');
    } catch (error) {
      return ['eng', 'spa'];
    }
  }

  /**
   * Verifica dependencias
   */
  async checkDependencies() {
    const deps = {
      ocrmypdf: false,
      tesseract: false,
      ghostscript: false,
      pdftotext: false
    };

    try {
      await execAsync('ocrmypdf --version');
      deps.ocrmypdf = true;
    } catch (e) {}

    try {
      await execAsync('tesseract --version');
      deps.tesseract = true;
    } catch (e) {}

    try {
      await execAsync('gs --version');
      deps.ghostscript = true;
    } catch (e) {}

    try {
      await execAsync('pdftotext -v 2>&1');
      deps.pdftotext = true;
    } catch (e) {}

    return deps;
  }
}

module.exports = new OcrService();
