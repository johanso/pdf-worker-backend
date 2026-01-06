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
    
    // Configuración de contraste usando transferencias de función
    // Ghostscript usa curvas de transferencia para ajustar tonos
    const contrastSettings = this.getContrastSettings(contrast);
    
    // Comando base para escala de grises
    let cmd = `gs -sDEVICE=pdfwrite \
      -dCompatibilityLevel=1.4 \
      -dNOPAUSE -dQUIET -dBATCH \
      -dColorConversionStrategy=/Gray \
      -dProcessColorModel=/DeviceGray \
      ${contrastSettings} \
      -sOutputFile="${outputPath}" \
      "${inputPath}"`;

    console.log(`[Grayscale] Converting with contrast: ${contrast}`);
    const startTime = Date.now();
    
    await execAsync(cmd);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Grayscale] Completed in ${elapsed}s`);
    
    await fs.access(outputPath);
    return outputPath;
  }

  /**
   * Obtiene los parámetros de Ghostscript para cada nivel de contraste
   */
  getContrastSettings(contrast) {
    switch (contrast) {
      case 'light':
        // Más claro: aumenta los valores de gris (gamma > 1 aclara)
        return '-dDefaultGrayProfile=/usr/share/ghostscript/*/iccprofiles/gray.icc -c "{0.7 exp} settransfer" -f';
      
      case 'high':
        // Alto contraste: oscurece los tonos medios (gamma < 1)
        return '-c "{0.6 exp} settransfer" -f';
      
      case 'extreme':
        // Máximo contraste: casi umbralización, blanco y negro puro
        return '-c "{dup 0.5 lt {0.3 mul} {0.7 mul 0.3 add} ifelse} settransfer" -f';
      
      case 'normal':
      default:
        // Normal: sin ajustes de contraste
        return '';
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
