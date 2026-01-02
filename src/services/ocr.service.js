const { execAsync } = require('../utils/file.utils');
const path = require('path');
const fs = require('fs').promises;

class OcrService {
  constructor() {
    // Idiomas soportados por Tesseract
    this.supportedLanguages = {
      'spa': 'Español',
      'eng': 'English',
      'fra': 'Français',
      'deu': 'Deutsch',
      'ita': 'Italiano',
      'por': 'Português',
      'cat': 'Català',
      'nld': 'Nederlands',
      'pol': 'Polski',
      'rus': 'Русский',
      'chi_sim': '简体中文',
      'chi_tra': '繁體中文',
      'jpn': '日本語',
      'kor': '한국어',
      'ara': 'العربية'
    };
  }

  /**
   * Detecta si un PDF necesita OCR (es escaneado/imagen)
   * @param {string} inputPath - Ruta al PDF
   * @returns {Promise<{needsOcr: boolean, textContent: number, imageContent: number}>}
   */
  async detectPdfType(inputPath) {
    try {
      // Extraer texto existente con pdftotext
      const textResult = await execAsync(`pdftotext -q "${inputPath}" - | wc -w`);
      const wordCount = parseInt(textResult.stdout.trim()) || 0;

      // Contar páginas
      const pageResult = await execAsync(`pdfinfo "${inputPath}" | grep "Pages:" | awk '{print $2}'`);
      const pageCount = parseInt(pageResult.stdout.trim()) || 1;

      // Ratio de palabras por página
      const wordsPerPage = wordCount / pageCount;

      // Si tiene menos de 50 palabras por página, probablemente es escaneado
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
      // En caso de error, asumir que necesita OCR
      return { needsOcr: true, wordCount: 0, pageCount: 1, wordsPerPage: 0, type: 'unknown' };
    }
  }

  /**
   * Realiza OCR en un PDF y genera un PDF searchable
   * @param {string} inputPath - Ruta al PDF de entrada
   * @param {string} outputDir - Directorio de salida
   * @param {Object} options - Opciones de OCR
   * @returns {Promise<string>} - Ruta al PDF con OCR
   */
  async ocrPdf(inputPath, outputDir, options = {}) {
    const {
      languages = ['spa', 'eng'],  // Idiomas para reconocimiento
      dpi = 300,                    // Resolución para conversión
      optimize = true,              // Optimizar tamaño del resultado
      mode = 'sandwich'             // 'sandwich' (texto invisible) o 'replace' (solo texto)
    } = options;

    const timestamp = Date.now();
    const tempDir = path.join(outputDir, `ocr-temp-${timestamp}`);
    const filename = path.basename(inputPath, '.pdf');
    const outputPath = path.join(outputDir, `${filename}-ocr-${timestamp}.pdf`);

    try {
      // 1. Validar idiomas instalados
      const installedLangs = await this.getInstalledLanguages();
      const validLanguages = languages.filter(lang => installedLangs.includes(lang));
      
      if (validLanguages.length === 0) {
        throw new Error(`Ninguno de los idiomas solicitados está instalado: ${languages.join(', ')}`);
      }
      
      if (validLanguages.length < languages.length) {
        const missing = languages.filter(l => !validLanguages.includes(l));
        console.warn(`[OCR] Idiomas no disponibles (ignorados): ${missing.join(', ')}`);
      }

      // 2. Crear directorio temporal
      await fs.mkdir(tempDir, { recursive: true });

      // 3. Obtener número de páginas y validar límite
      const pageResult = await execAsync(`pdfinfo "${inputPath}" | grep "Pages:" | awk '{print $2}'`);
      const pageCount = parseInt(pageResult.stdout.trim()) || 1;

      const MAX_PAGES = 100;
      if (pageCount > MAX_PAGES) {
        throw new Error(`El PDF tiene ${pageCount} páginas. Máximo permitido: ${MAX_PAGES}`);
      }

      console.log(`[OCR] Processing ${pageCount} pages with languages: ${validLanguages.join('+')}`);

      // 4. Convertir PDF a imágenes de alta resolución
      console.log(`[OCR] Converting PDF to images at ${dpi} DPI...`);
      await execAsync(`pdftoppm -png -r ${dpi} "${inputPath}" "${tempDir}/page"`);

      // 5. Obtener lista de imágenes generadas
      const files = await fs.readdir(tempDir);
      const imageFiles = files
        .filter(f => f.startsWith('page') && f.endsWith('.png'))
        .sort();

      if (imageFiles.length === 0) {
        throw new Error('No se pudieron extraer imágenes del PDF');
      }

      console.log(`[OCR] Extracted ${imageFiles.length} images`);

      // 6. Procesar cada imagen con Tesseract
      const langParam = validLanguages.join('+');
      const ocrPages = [];

      for (let i = 0; i < imageFiles.length; i++) {
        const imgPath = path.join(tempDir, imageFiles[i]);
        const pageNum = i + 1;
        const pagePdfPath = path.join(tempDir, `ocr-page-${String(pageNum).padStart(4, '0')}`);

        console.log(`[OCR] Processing page ${pageNum}/${imageFiles.length}...`);

        // Tesseract genera PDF con texto invisible superpuesto
        await execAsync(`tesseract "${imgPath}" "${pagePdfPath}" -l ${langParam} --dpi ${dpi} --psm 1 pdf`);

        ocrPages.push(`${pagePdfPath}.pdf`);
      }

      // 7. Unir todas las páginas OCR en un solo PDF
      console.log('[OCR] Merging OCR pages...');
      
      if (ocrPages.length === 1) {
        await fs.copyFile(ocrPages[0], outputPath);
      } else {
        const pagesList = ocrPages.map(p => `"${p}"`).join(' ');
        await execAsync(`pdfunite ${pagesList} "${outputPath}"`);
      }

      // 8. Optimizar el PDF resultante (opcional)
      if (optimize) {
        console.log('[OCR] Optimizing output...');
        const optimizedPath = path.join(outputDir, `${filename}-ocr-optimized-${timestamp}.pdf`);
        
        try {
          await execAsync(
            `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook ` +
            `-dNOPAUSE -dQUIET -dBATCH -sOutputFile="${optimizedPath}" "${outputPath}"`
          );
          
          // Verificar que la optimización fue exitosa
          const originalSize = (await fs.stat(outputPath)).size;
          const optimizedSize = (await fs.stat(optimizedPath)).size;
          
          if (optimizedSize < originalSize && optimizedSize > 0) {
            await fs.unlink(outputPath);
            await fs.rename(optimizedPath, outputPath);
            console.log(`[OCR] Optimized: ${Math.round(originalSize/1024)}KB -> ${Math.round(optimizedSize/1024)}KB`);
          } else {
            await fs.unlink(optimizedPath).catch(() => {});
          }
        } catch (e) {
          console.log('[OCR] Optimization skipped:', e.message);
        }
      }

      // 9. Limpiar archivos temporales
      await this.cleanupDir(tempDir);

      // 10. Verificar resultado
      await fs.access(outputPath);
      const stats = await fs.stat(outputPath);

      console.log(`[OCR] Complete: ${outputPath} (${Math.round(stats.size/1024)}KB)`);

      return outputPath;

    } catch (error) {
      // Limpiar en caso de error
      await this.cleanupDir(tempDir);
      throw error;
    }
  }

  /**
   * OCR rápido: extrae solo el texto (sin generar PDF)
   * @param {string} inputPath - Ruta al PDF
   * @param {Object} options - Opciones
   * @returns {Promise<{text: string, pages: Array}>}
   */
  async extractText(inputPath, outputDir, options = {}) {
    const {
      languages = ['spa', 'eng'],
      dpi = 200  // Menor DPI para solo texto
    } = options;

    const timestamp = Date.now();
    const tempDir = path.join(outputDir, `ocr-text-${timestamp}`);

    try {
      await fs.mkdir(tempDir, { recursive: true });

      // Convertir a imágenes
      await execAsync(`pdftoppm -png -r ${dpi} "${inputPath}" "${tempDir}/page"`);

      const files = await fs.readdir(tempDir);
      const imageFiles = files.filter(f => f.endsWith('.png')).sort();

      const langParam = languages.join('+');
      const pages = [];
      let fullText = '';

      for (let i = 0; i < imageFiles.length; i++) {
        const imgPath = path.join(tempDir, imageFiles[i]);
        
        const result = await execAsync(`
          tesseract "${imgPath}" stdout -l ${langParam} --psm 1
        `);

        const pageText = result.stdout.trim();
        pages.push({
          page: i + 1,
          text: pageText,
          wordCount: pageText.split(/\s+/).filter(w => w.length > 0).length
        });

        fullText += pageText + '\n\n';
      }

      await this.cleanupDir(tempDir);

      return {
        text: fullText.trim(),
        pages,
        totalWords: pages.reduce((sum, p) => sum + p.wordCount, 0)
      };

    } catch (error) {
      await this.cleanupDir(tempDir);
      throw error;
    }
  }

  /**
   * Obtiene los idiomas instalados en Tesseract
   */
  async getInstalledLanguages() {
    try {
      const result = await execAsync('tesseract --list-langs 2>&1');
      const lines = result.stdout.split('\n').slice(1); // Ignorar primera línea
      return lines.filter(l => l.trim().length > 0);
    } catch (error) {
      return ['eng', 'spa']; // Fallback
    }
  }

  /**
   * Verifica que las dependencias estén instaladas
   */
  async checkDependencies() {
    const deps = {
      tesseract: false,
      pdftoppm: false,
      pdfunite: false,
      ghostscript: false
    };

    try {
      await execAsync('tesseract --version');
      deps.tesseract = true;
    } catch (e) {}

    try {
      await execAsync('pdftoppm -v 2>&1');
      deps.pdftoppm = true;
    } catch (e) {}

    try {
      await execAsync('pdfunite -v 2>&1');
      deps.pdfunite = true;
    } catch (e) {}

    try {
      await execAsync('gs --version');
      deps.ghostscript = true;
    } catch (e) {}

    return deps;
  }

  /**
   * Limpia un directorio temporal
   */
  async cleanupDir(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        await fs.unlink(path.join(dirPath, file)).catch(() => {});
      }
      await fs.rmdir(dirPath).catch(() => {});
    } catch (e) {
      // Ignorar errores de limpieza
    }
  }
}

module.exports = new OcrService();