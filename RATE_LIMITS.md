# Rate Limiting Configuration

Este servidor implementa rate limiting para proteger contra abuso y sobrecarga.

## Límites por Tipo de Endpoint

### 1. Health Check
- **Ruta**: `GET /health`
- **Límite**: 60 requests por minuto
- **Ventana**: 1 minuto
- **Uso**: Monitoreo y health checks frecuentes

### 2. Descarga de Archivos
- **Ruta**: `/api/download/*`
- **Límite**: 50 requests por ventana
- **Ventana**: 5 minutos
- **Uso**: Descarga de archivos procesados

### 3. Procesamiento de Archivos (Upload Limiter)
- **Rutas**: La mayoría de endpoints de procesamiento
  - `/api/word-to-pdf`, `/api/pdf-to-word`
  - `/api/excel-to-pdf`, `/api/pdf-to-excel`
  - `/api/ppt-to-pdf`, `/api/pdf-to-ppt`
  - `/api/compress-pdf`, `/api/grayscale-pdf`
  - `/api/merge-pdf`, `/api/split-pdf`, `/api/rotate-pdf`
  - `/api/protect-pdf`, `/api/unlock-pdf`, `/api/repair-pdf`
  - `/api/image-to-pdf`, `/api/pdf-to-image`
  - `/api/sign-pdf`, `/api/censure-pdf`
  - etc.
- **Límite**: 30 requests por ventana
- **Ventana**: 10 minutos
- **Promedio**: ~3 requests por minuto
- **Razón**: Estas operaciones consumen mucho CPU/memoria

### 4. OCR (Límite Más Estricto)
- **Ruta**: `/api/ocr-pdf/*`
- **Límite**: 10 requests por ventana
- **Ventana**: 30 minutos
- **Razón**: OCR es extremadamente costoso en CPU y tiempo

### 5. API General (Fallback)
- **Ruta**: `/api/*` (rutas sin limiter específico)
- **Límite**: 100 requests por ventana
- **Ventana**: 15 minutos
- **Uso**: Protección general para cualquier endpoint de API

## Headers de Respuesta

Cuando se aplica rate limiting, el servidor retorna estos headers:

```
RateLimit-Limit: 30          # Límite máximo de requests
RateLimit-Remaining: 25      # Requests restantes en la ventana actual
RateLimit-Reset: 1234567890  # Timestamp Unix cuando se resetea el contador
```

## Respuesta al Exceder el Límite

Cuando se excede el límite, el servidor responde con:

**Status Code**: `429 Too Many Requests`

**Body**:
```json
{
  "error": "Demasiadas operaciones de procesamiento. Por favor espera antes de procesar más archivos.",
  "code": "UPLOAD_RATE_LIMIT_EXCEEDED",
  "retryAfter": "10 minutos",
  "hint": "Este límite protege el servidor de sobrecarga. Contacta soporte si necesitas mayor capacidad."
}
```

## Desarrollo Local

En modo desarrollo (`NODE_ENV=development`), las IPs locales están exentas:
- `127.0.0.1`
- `::1`
- `localhost`

Esto permite testing sin restricciones en local.

## Configuración de Proxy

El servidor está configurado con `trust proxy: 1` para obtener la IP real del cliente detrás de Caddy u otro reverse proxy.

Esto es **crítico** para que el rate limiting funcione correctamente en producción.

## Ajuste de Límites

Para ajustar los límites, edita `src/middleware/rate-limit.middleware.js`:

```javascript
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // Ventana de tiempo
  max: 30,                  // Número máximo de requests
  // ...
});
```

## Monitoreo

Para ver cuántos requests quedan, el cliente puede leer los headers `RateLimit-*` en cada respuesta.

## Bypass para Usuarios Premium (Futuro)

Si implementas autenticación, puedes skipear el rate limit para usuarios premium:

```javascript
const uploadLimiter = rateLimit({
  // ...
  skip: (req) => {
    // Skip si el usuario es premium
    return req.user && req.user.isPremium;
  }
});
```

## Testing

Para probar el rate limiting:

```bash
node test-rate-limit.js
```

O manualmente con curl:

```bash
# Hacer múltiples requests rápidamente
for i in {1..70}; do
  curl -w "\n%{http_code}\n" http://localhost:3001/health
done
```

Las primeras ~60 deben retornar 200, las siguientes deben retornar 429.
