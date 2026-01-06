const { execAsync } = require('../utils/file.utils');
const path = require('path');
const fs = require('fs').promises;

class GhostscriptService {
  
  /**
   * Convierte un PDF a escala de grises con control de contraste
   * 
   * @param {string} inputPath - Ruta del PDF original
   * @param {string} outputDir - Directorio de salida
   * @param {object} options - Opciones de conversión
   * @param {string} options.contrast - Nivel: 'light' | 'normal' | 'high' | 'extreme'
   */
  async convertToGrayscale(inputPath, outputDir, options = {}) {
    const { contrast = 'normal' } = options;
    
    const filename = path.basename(inputPath, '.pdf');
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${filename}-grayscale-${timestamp}.pdf`);
    
    console.log(`[Grayscale] Converting with contrast: ${contrast}`);
    const startTime = Date.now();

    if (contrast === 'normal') {
      // Conversión simple a escala de grises
      const cmd = `gs -sDEVICE=pdfwrite \
        -dCompatibilityLevel=1.4 \
        -dNOPAUSE -dQUIET -dBATCH \
        -dColorConversionStrategy=/Gray \
        -dProcessColorModel=/DeviceGray \
        -sOutputFile="${outputPath}" \
        "${inputPath}"`;
      
      await execAsync(cmd);
    } else {
      // Para otros niveles de contraste, usamos un proceso de dos pasos:
      // 1. Convertir a grises con Ghostscript
      // 2. Ajustar contraste con ImageMagick
      
      const tempGray = path.join(outputDir, `${filename}-temp-gray-${timestamp}.pdf`);
      
      // Paso 1: Convertir a escala de grises
      const gsCmd = `gs -sDEVICE=pdfwrite \
        -dCompatibilityLevel=1.4 \
        -dNOPAUSE -dQUIET -dBATCH \
        -dColorConversionStrategy=/Gray \
        -dProcessColorModel=/DeviceGray \
        -sOutputFile="${tempGray}" \
        "${inputPath}"`;
      
      await execAsync(gsCmd);
      
      // Paso 2: Ajustar contraste con ImageMagick
      const contrastParams = {
        'light': '-brightness-contrast 15x-10',      // Más brillo, menos contraste
        'high': '-brightness-contrast -5x30',        // Menos brillo, más contraste
        'extreme': '-brightness-contrast -10x50 -normalize'  // Máximo contraste
      };
      
      const imCmd = `convert -density 150 "${tempGray}" ${contrastParams[contrast]} "${outputPath}"`;
      await execAsync(imCmd);
      
      // Limpiar archivo temporal
      await fs.unlink(tempGray).catch(() => {});
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Grayscale] Completed in ${elapsed}s`);
    
    await fs.access(outputPath);
    return outputPath;
  }

  /**
   * Obtiene los parámetros de Ghostscript para cada nivel de contraste
   * Retorna objeto con preProcess (antes del input) y postProcess (después)
   */
  getContrastSettings(contrast) {
    // Usamos -dConvertCMYKImagesToRGB y ajustes de gamma mediante render intent
    switch (contrast) {
      case 'light':
        // Más claro: gamma 1.4 aclara los tonos
        return { gamma: 1.4 };
      
      case 'high':
        // Alto contraste: gamma 0.7 oscurece medios
        return { gamma: 0.7 };
      
      case 'extreme':
        // Máximo contraste: gamma muy bajo
        return { gamma: 0.5 };
      
      case 'normal':
      default:
        return { gamma: 1.0 };
    }
  }

  /**
   * Presets de compresión simplificados (sin estimaciones falsas)
   */
  getPresets() {
    return {
      extreme: {
        name: 'Compresión Extrema',
        description: 'Menor tamaño, menos calidad',
        pdfSettings: '/screen',
        dpi: 72,
        imageQuality: 40
      },
      recommended: {
        name: 'Compresión Recomendada', 
        description: 'Buen balance calidad/tamaño',
        pdfSettings: '/ebook',
        dpi: 120,
        imageQuality: 60
      },
      low: {
        name: 'Baja Compresión',
        description: 'Alta calidad, archivo más grande',
        pdfSettings: '/printer',
        dpi: 200,
        imageQuality: 85
      }
    };
  }

  /**
   * Comprime PDF con preset (modo simple) - OPTIMIZADO PARA VELOCIDAD
   */
  async compressPdfWithPreset(inputPath, outputDir, preset = 'recommended') {
    const presets = this.getPresets();
    const config = presets[preset] || presets.recommended;
    
    return this.compressPdf(inputPath, outputDir, {
      dpi: config.dpi,
      imageQuality: config.imageQuality,
      pdfSettings: config.pdfSettings
    });
  }

  /**
   * Comprime PDF - OPTIMIZADO PARA VELOCIDAD
   */
  async compressPdf(inputPath, outputDir, options = {}) {
    const {
      dpi = 120,
      imageQuality = 60,
      pdfSettings = '/ebook'
    } = options;

    const filename = path.basename(inputPath, '.pdf');
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${filename}-compressed-${timestamp}.pdf`);
    
    const finalDpi = Math.max(36, Math.min(600, parseInt(dpi) || 120));
    const finalQuality = Math.max(10, Math.min(100, parseInt(imageQuality) || 60));
    
    // Comando OPTIMIZADO - menos parámetros, más rápido
    const cmd = `gs -sDEVICE=pdfwrite \
      -dCompatibilityLevel=1.4 \
      -dPDFSETTINGS=${pdfSettings} \
      -dNOPAUSE -dQUIET -dBATCH \
      -dFastWebView=true \
      -dDetectDuplicateImages=true \
      -dCompressFonts=true \
      -dSubsetFonts=true \
      -dColorImageResolution=${finalDpi} \
      -dGrayImageResolution=${finalDpi} \
      -dMonoImageResolution=${finalDpi} \
      -dJPEGQ=${finalQuality} \
      -sOutputFile="${outputPath}" \
      "${inputPath}"`;

    console.log(`[Compress] Preset DPI: ${finalDpi}, Quality: ${finalQuality}`);
    const startTime = Date.now();
    
    await execAsync(cmd);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Compress] Completed in ${elapsed}s`);
    
    await fs.access(outputPath);
    return outputPath;
  }
}

module.exports = new GhostscriptService();
