# GymHora RD

Aplicación web en español para explorar la ocupación y las horas pico de gimnasios en República Dominicana. Diseño adaptable a celulares, favoritos locales, filtros por ciudad y ocupación, gráficas, exportación CSV e instalación como PWA.

## Ejecutar

Requiere Node.js 22 o posterior. Sin dependencias externas de ejecución.

```sh
cd /workspace/kenatural
npm ci
npm start
```

El servidor escucha en el puerto 3000 (configurable con `PORT`). Para desarrollo con reinicio automático: `npm run dev`. Para verificar: `npm run check` y `npm test`.

## Demostración y alcance

Por defecto presenta **seis gimnasios ficticios** en cuatro ciudades, con conteos y perfiles horarios ilustrativos. No son un directorio verificado, estadísticas obtenidas de internet ni conteos reales. La demostración no genera falsas actualizaciones en vivo. No se verificaron datos de gimnasios en internet: el acceso a la web consultada fue bloqueado en este entorno.

La aplicación no registra ubicación ni datos personales de visitantes. Los favoritos se conservan en el almacenamiento local del navegador. El CSV señala si los datos son ficticios, su fuente y la fecha de medición.

## Conectar una fuente real

El gimnasio o proveedor debe exponer un endpoint **HTTPS** autorizado con el siguiente JSON. Configura `GYM_DATA_URL` en el servidor y, si la fuente requiere autenticación Bearer, `GYM_DATA_TOKEN` mediante las variables seguras del alojamiento. Nunca publiques el token en el navegador ni en Git. No hay un proveedor contratado o conectado actualmente.

```json
{
  "gyms": [
    {
      "id": "id-estable-de-la-sede",
      "name": "Nombre verificado del gimnasio",
      "city": "Santo Domingo",
      "area": "Sector",
      "capacity": 120,
      "people": 45,
      "observedAt": "2026-10-15T14:30:00Z",
      "source": "Sistema de acceso autorizado de la sede",
      "hourly": [
        { "hour": 6, "occupancy": 18 },
        { "hour": 18, "occupancy": 85 }
      ]
    }
  ]
}
```

`observedAt` debe ser la fecha real de la medición, en ISO 8601 con zona horaria. El ejemplo debe sustituirse con una medición actual. `people` es un entero no negativo; `capacity` es un entero positivo. `hourly` contiene porcentajes históricos de 0 a 100 por hora local de República Dominicana, sin horas duplicadas; puede estar vacío. El proveedor debe definir un período histórico coherente para las sedes que compara y proporcionar conteos agregados, sin información personal. La aplicación muestra el perfil suministrado; no calcula popularidad de Google ni predice asistencia futura.

El navegador consulta cada 30 segundos mientras la pestaña está visible. Un dato con más de 2 minutos o una consulta fallida se identifica como no actual y se oculta el conteo actual. No se reemplaza una falla del proveedor con datos ficticios. El servidor valida el esquema, usa un tiempo máximo de 8 segundos y no permite redirecciones de la fuente. Solo administra `GYM_DATA_URL` una persona autorizada; es una configuración del servidor.

## Instalar en el celular

Publica el servidor en un alojamiento con HTTPS y un proceso Node.js persistente. Este repositorio no se ha desplegado en un servicio público. Abre la dirección pública y pulsa **Instalar**; en iPhone usa Safari → Compartir → Añadir a pantalla de inicio. No es un APK ni una publicación en App Store o Google Play.

La PWA conserva la interfaz para volver a abrirla sin conexión después de la primera visita. Los datos de ocupación nunca se guardan como respuesta offline y necesitan conexión. La instalación y el modo sin conexión requieren HTTPS (localhost se admite para desarrollo).

## Validación realizada

- 7 pruebas automatizadas de validación de datos y separación entre demostración y fuente conectada.
- Comprobación de sintaxis de servidor, cliente y service worker.
- Navegador Chromium: búsqueda, filtros, favoritos persistentes, estado vacío, detalle, descarga CSV, registro del service worker, recursos PWA y distribución móvil sin desbordamiento.
- Casos de fuente actual, medición antigua, error de consulta y texto de proveedor tratado como texto, sin ejecutar HTML.

La conexión con un proveedor real y la instalación desde un dominio público HTTPS siguen pendientes de disponer de ese proveedor y del despliegue.

## Desplegar en Render desde GitHub

Este despliegue es independiente del entorno de Codex. El código debe estar subido a la rama `main` de `haironmanuel/kenatural` antes de empezar. Comprueba en GitHub que aparecen `package.json`, `server.js`, `public/` y `render.yaml`.

### Opción recomendada: Blueprint

1. Entra en https://render.com y conecta tu cuenta de GitHub.
2. Selecciona **New → Blueprint** y autoriza el repositorio `haironmanuel/kenatural`.
3. Selecciona la rama `main`. Render leerá el archivo `render.yaml` de este repositorio.
4. Revisa que el servicio sea **Web Service**, con Node.js y el plan Free si está disponible en tu cuenta. Confirma la creación del servicio.
5. Espera a que el despliegue se marque como **Live**. Copia la URL HTTPS que Render muestre en la página del servicio y ábrela en Safari. No hay una URL asignada de antemano en este repositorio.

### Alternativa: configuración manual

En **New → Web Service**, elige el mismo repositorio y configura:

| Campo | Valor |
|---|---|
| Branch | `main` |
| Root Directory | Vacío (raíz del repositorio) |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Variable `NODE_VERSION` | `24` |
| Health Check Path | `/` |

No selecciones Static Site: la API necesita un servidor Node.js. No fijes `PORT`; el servidor utiliza el valor que proporciona Render. La demostración no necesita claves, base de datos ni variables de proveedor. Si usas un plan gratuito, el servicio puede suspenderse por inactividad y la primera visita puede tardar en cargar.

Para comprobar el despliegue, abre la URL asignada: deben aparecer seis gimnasios y el aviso de demostración. La ruta `/api/gyms` de esa misma URL debe devolver `mode: "demo"`. En iPhone, usa Safari → Compartir → Añadir a pantalla de inicio para instalar la aplicación.

Si falla el despliegue, revisa **Logs** en Render. Si falta `package.json`, confirma la rama y el directorio raíz; si el proceso no inicia, confirma `npm start` y Node 24. Para futuros cambios, sube un nuevo commit y comprueba en Render que ese commit se despliegue. No se necesita publicar el entorno de Codex.
