# CORS Configuration

Este servidor implementa CORS (Cross-Origin Resource Sharing) restrictivo para controlar qué sitios web pueden acceder a la API desde el navegador.

## ¿Qué es CORS?

CORS es un mecanismo de seguridad del navegador que previene que sitios web maliciosos hagan requests a tu API sin permiso.

**Sin CORS configurado:**
- ❌ Cualquier sitio web puede usar tu API
- ❌ Posibles ataques de sitios maliciosos
- ❌ Robo de recursos (procesamiento, ancho de banda)

**Con CORS configurado:**
- ✅ Solo dominios autorizados pueden usar la API
- ✅ Protección contra sitios maliciosos
- ✅ Control total sobre quién accede

## Configuración

### Producción (Recomendado)

Crear archivo `.env` en la raíz del proyecto:

```bash
# .env
NODE_ENV=production
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com
```

**Importante:**
- NO incluir `http://` para dominios HTTPS
- Incluir TODOS los subdominios que usarás (www, app, admin, etc.)
- Separar múltiples orígenes con comas (sin espacios)
- NO usar `*` en producción

### Desarrollo

En desarrollo (`NODE_ENV=development`), si no configuras `ALLOWED_ORIGINS`, se permiten automáticamente:
- `http://localhost:3000` (React default)
- `http://localhost:5173` (Vite default)
- `http://localhost:5174` (Vite alternate)

Para agregar más puertos en desarrollo:

```bash
# .env
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080,http://127.0.0.1:3000
```

## Comportamiento

### Request desde origen permitido

```bash
# Request desde https://tu-dominio.com
curl -H "Origin: https://tu-dominio.com" \
     -H "Content-Type: application/json" \
     http://api.tu-dominio.com/health
```

**Respuesta:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://tu-dominio.com
Access-Control-Allow-Credentials: true
```

✅ Request aceptado

### Request desde origen NO permitido

```bash
# Request desde https://sitio-malicioso.com
curl -H "Origin: https://sitio-malicioso.com" \
     http://api.tu-dominio.com/health
```

**Logs del servidor:**
```
[CORS] Rechazado: https://sitio-malicioso.com
[CORS] Orígenes permitidos: https://tu-dominio.com, https://www.tu-dominio.com
```

**Respuesta:**
```
HTTP/1.1 500 Internal Server Error
No está permitido por CORS
```

❌ Request rechazado

### Requests sin Origin (Postman, curl, apps móviles)

Requests que no vienen del navegador (sin header `Origin`) son permitidos:

```bash
# curl sin header Origin
curl http://api.tu-dominio.com/health
```

✅ Request aceptado (útil para testing, apps móviles, APIs)

## Headers CORS Configurados

El servidor envía estos headers:

```
Access-Control-Allow-Origin: https://tu-dominio.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Expose-Headers: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
Access-Control-Max-Age: 86400
```

### ¿Qué significa cada header?

- **Allow-Origin**: El origen permitido (nunca "*" en esta configuración)
- **Allow-Credentials**: Permite enviar cookies y headers de autenticación
- **Allow-Methods**: Métodos HTTP permitidos
- **Allow-Headers**: Headers que el cliente puede enviar
- **Expose-Headers**: Headers que el cliente puede leer (útil para rate limiting)
- **Max-Age**: Cuánto tiempo cachear la respuesta preflight (24 horas)

## Preflight Requests

Para requests con métodos/headers no estándar, el navegador primero envía un "preflight" (OPTIONS):

```
OPTIONS /api/merge-pdf HTTP/1.1
Origin: https://tu-dominio.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
```

El servidor responde:

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://tu-dominio.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 86400
```

Luego el navegador envía el request real.

## Troubleshooting

### Error: "No está permitido por CORS"

**Causa:** El origin del frontend no está en `ALLOWED_ORIGINS`

**Solución:**
```bash
# Agregar el dominio a .env
ALLOWED_ORIGINS=https://tu-dominio.com,https://mi-frontend.com
```

Reiniciar servidor:
```bash
pm2 restart pdf-worker
```

### Error: "Access-Control-Allow-Origin: null"

**Causa:** Abriste el HTML directamente desde el disco (`file://`)

**Solución:** Usa un servidor web local:
```bash
# Python
python -m http.server 8000

# Node.js
npx http-server

# Vite
npm run dev
```

### CORS funciona en desarrollo pero no en producción

**Causa:** `NODE_ENV` no está configurado como `production` o `ALLOWED_ORIGINS` no está configurado

**Solución:**
```bash
# En .env del servidor
NODE_ENV=production
ALLOWED_ORIGINS=https://tu-dominio.com
```

### Requests de Postman son rechazados

**Causa:** Postman envía header `Origin` simulando navegador

**Solución:**
- Quita el header `Origin` en Postman
- O agrega el origin de Postman a `ALLOWED_ORIGINS`

## Testing

### Test 1: Verificar origen permitido

```bash
curl -v -H "Origin: https://tu-dominio.com" http://localhost:3001/health 2>&1 | grep -i "access-control"
```

Debe retornar:
```
< Access-Control-Allow-Origin: https://tu-dominio.com
```

### Test 2: Verificar origen rechazado

```bash
curl -v -H "Origin: https://sitio-malicioso.com" http://localhost:3001/health 2>&1
```

Debe retornar error CORS.

### Test 3: Verificar preflight

```bash
curl -X OPTIONS \
     -H "Origin: https://tu-dominio.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: content-type" \
     -v http://localhost:3001/api/merge-pdf 2>&1 | grep -i "access-control"
```

## Múltiples Dominios

Para servir a múltiples frontends:

```bash
# .env
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com,https://app.tu-dominio.com,https://admin.tu-dominio.com
```

## CORS con CDN (Cloudflare, etc.)

Si usas un CDN delante del servidor, asegúrate que:
1. El CDN pase el header `Origin` al backend
2. El CDN cachee respuestas CORS correctamente
3. Configura `Vary: Origin` en las respuestas

## Seguridad

### ❌ NO hacer esto:

```javascript
// NUNCA en producción
app.use(cors({ origin: '*' }));
```

Esto permite que **cualquier sitio web** use tu API.

### ✅ Hacer esto:

```javascript
// Whitelist específica
const allowedOrigins = ['https://tu-dominio.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
```

## Logs del Servidor

Al iniciar, verás:

```
[CORS] Orígenes permitidos: https://tu-dominio.com, https://www.tu-dominio.com
```

Si no hay orígenes configurados:

```
[CORS] ⚠️  ADVERTENCIA: No hay orígenes configurados en ALLOWED_ORIGINS
[CORS] Modo desarrollo: permitiendo localhost
```

Cuando se rechaza un request:

```
[CORS] Rechazado: https://sitio-no-autorizado.com
[CORS] Orígenes permitidos: https://tu-dominio.com
```

## Referencias

- [MDN: CORS](https://developer.mozilla.org/es/docs/Web/HTTP/CORS)
- [Express CORS middleware](https://github.com/expressjs/cors)
