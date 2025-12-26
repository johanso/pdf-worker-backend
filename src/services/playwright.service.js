const { chromium } = require('playwright');
const path = require('path');

class PlaywrightService {
  constructor() {
    this.browser = null;
  }

  async getBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
    }
    return this.browser;
  }

  async htmlToPdf(input, outputDir, options = {}) {
    const browser = await this.getBrowser();
    
    const viewportWidth = options.viewport?.width || 1440;
    const viewportHeight = options.viewport?.height || 900;
    
    console.log(`[PDF] Viewport: ${viewportWidth}x${viewportHeight}`);
    
    const context = await browser.newContext({
      viewport: { 
        width: viewportWidth, 
        height: viewportHeight 
      },
      deviceScaleFactor: 1,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    try {
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);
      
      const url = options.isUrl ? input : `file://${input}`;
      console.log(`[PDF] Cargando: ${url}`);
      
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 60000
      });
      
      // Forzar media type 'screen'
      await page.emulateMedia({ media: 'screen' });
      
      await page.waitForTimeout(2000);
      await this.dismissPopups(page);
      await this.loadFullPage(page);
      
      // Solo preparar header/footer para PDF (sin romper el layout)
      await this.prepareForPdf(page);
      
      const timestamp = Date.now();
      const baseName = options.isUrl ? 'webpage' : path.basename(input, '.html');
      const outputPath = path.join(outputDir, `${baseName}-${timestamp}.pdf`);
      
      // Márgenes
      let margin = { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' };
      if (options.margin) {
        margin = {
          top: typeof options.margin.top === 'number' ? `${options.margin.top}mm` : (options.margin.top || '10mm'),
          right: typeof options.margin.right === 'number' ? `${options.margin.right}mm` : (options.margin.right || '10mm'),
          bottom: typeof options.margin.bottom === 'number' ? `${options.margin.bottom}mm` : (options.margin.bottom || '10mm'),
          left: typeof options.margin.left === 'number' ? `${options.margin.left}mm` : (options.margin.right || '10mm')
        };
      }
      
      const pdfWidth = `${viewportWidth}px`;
      console.log(`[PDF] Width: ${pdfWidth}, Márgenes:`, margin);
      
      await page.pdf({
        path: outputPath,
        width: pdfWidth,
        printBackground: true,
        margin: margin,
        preferCSSPageSize: false
      });
      
      console.log(`[PDF] Generado: ${outputPath}`);
      return outputPath;
      
    } finally {
      await context.close();
    }
  }

  async generatePreview(input, outputDir, options = {}) {
    const browser = await this.getBrowser();
    
    const viewportWidth = options.viewport?.width || 1440;
    const viewportHeight = options.viewport?.height || 900;
    
    console.log(`[Preview] Viewport: ${viewportWidth}x${viewportHeight}`);
    
    const context = await browser.newContext({
      viewport: { 
        width: viewportWidth, 
        height: viewportHeight 
      },
      deviceScaleFactor: 1,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    try {
      page.setDefaultTimeout(60000);
      
      const url = options.isUrl ? input : `file://${input}`;
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 60000
      });
      
      await page.waitForTimeout(2000);
      await this.dismissPopups(page);
      await this.loadFullPage(page);
      
      const timestamp = Date.now();
      const outputPath = path.join(outputDir, `preview-${timestamp}.png`);
      
      await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: 'png'
      });
      
      console.log(`[Preview] Generado: ${outputPath}`);
      return outputPath;
      
    } finally {
      await context.close();
    }
  }

  // Preparar página para PDF sin romper el layout
  async prepareForPdf(page) {
    await page.evaluate(() => {
      // 1. Asegurar colores correctos
      const style = document.createElement('style');
      style.id = 'pdf-print-styles';
      style.textContent = `
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        
        /* Asegurar que header y footer sean visibles */
        header, footer, .header, .footer,
        [role="banner"], [role="contentinfo"] {
          visibility: visible !important;
          opacity: 1 !important;
        }
      `;
      document.head.appendChild(style);
      
      // 2. Encontrar elementos fixed/sticky que son header o footer
      const allElements = document.querySelectorAll('*');
      let headerEl = null;
      let footerEl = null;
      
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const position = style.position;
        const tag = el.tagName.toLowerCase();
        const className = el.className.toString().toLowerCase();
        const role = el.getAttribute('role');
        
        if (position === 'fixed' || position === 'sticky') {
          const rect = el.getBoundingClientRect();
          
          // Es header si está arriba
          if (rect.top < 100 && (
            tag === 'header' || 
            tag === 'nav' ||
            className.includes('header') || 
            className.includes('navbar') ||
            className.includes('nav-') ||
            role === 'banner' ||
            role === 'navigation'
          )) {
            headerEl = el;
          }
          
          // Es footer si está abajo
          if (rect.top > window.innerHeight - 200 && (
            tag === 'footer' ||
            className.includes('footer') ||
            role === 'contentinfo'
          )) {
            footerEl = el;
          }
        }
      });
      
      // 3. Mover header al inicio del body (sin cambiar otros elementos)
      if (headerEl) {
        const clone = headerEl.cloneNode(true);
        clone.style.position = 'relative';
        clone.style.top = 'auto';
        clone.style.left = 'auto';
        clone.style.right = 'auto';
        clone.style.width = '100%';
        clone.style.zIndex = 'auto';
        
        // Ocultar el original
        headerEl.style.display = 'none';
        
        // Insertar clon al inicio
        document.body.insertBefore(clone, document.body.firstChild);
      }
      
      // 4. Mover footer al final del body
      if (footerEl) {
        const clone = footerEl.cloneNode(true);
        clone.style.position = 'relative';
        clone.style.bottom = 'auto';
        clone.style.left = 'auto';
        clone.style.right = 'auto';
        clone.style.width = '100%';
        clone.style.zIndex = 'auto';
        
        // Ocultar el original
        footerEl.style.display = 'none';
        
        // Insertar clon al final
        document.body.appendChild(clone);
      }
      
      // 5. Quitar padding-top del body si había para el header fixed
      const bodyStyle = window.getComputedStyle(document.body);
      const paddingTop = parseInt(bodyStyle.paddingTop);
      if (paddingTop > 50 && headerEl) {
        // Probablemente era para compensar un header fixed
        // No lo quitamos porque el contenido lo necesita
      }
    });
    
    await page.waitForTimeout(300);
  }

  async loadFullPage(page) {
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      
      await new Promise((resolve) => {
        let lastHeight = 0;
        let sameHeightCount = 0;
        const maxAttempts = 50;
        let attempts = 0;
        
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          const currentScroll = window.scrollY + window.innerHeight;
          
          window.scrollBy(0, window.innerHeight);
          attempts++;
          
          if (scrollHeight === lastHeight) {
            sameHeightCount++;
          } else {
            sameHeightCount = 0;
          }
          lastHeight = scrollHeight;
          
          if (currentScroll >= scrollHeight - 10 || sameHeightCount >= 3 || attempts >= maxAttempts) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            setTimeout(resolve, 500);
          }
        }, 150);
      });
    });
    
    await page.waitForTimeout(1000);
  }

  async dismissPopups(page) {
    const selectors = [
      '[class*="cookie"] button[class*="accept"]',
      '[class*="cookie"] button[class*="agree"]',
      '[id*="cookie"] button',
      '[class*="consent"] button',
      'button:has-text("Accept")',
      'button:has-text("Aceptar")',
      'button:has-text("OK")',
      '[class*="modal"] [class*="close"]',
      '[class*="popup"] [class*="close"]',
    ];
    
    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          if (await el.isVisible()) {
            await el.click();
            await page.waitForTimeout(200);
          }
        }
      } catch (e) {}
    }
    
    await page.waitForTimeout(500);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

const playwrightService = new PlaywrightService();

process.on('SIGINT', async () => {
  await playwrightService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await playwrightService.close();
  process.exit(0);
});

module.exports = playwrightService;
