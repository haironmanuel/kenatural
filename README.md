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

Por defecto presenta **seis gimnasios ficticios** en cuatro ciudades, con conteos y perfiles horarios ilustrativos. Junto a ellos pueden aparecer gimnasios añadidos por usuarios, identificados como reportes manuales de la comunidad. No son un directorio verificado, estadísticas obtenidas de internet ni conteos reales. La demostración no genera falsas actualizaciones en vivo. No se verificaron datos de gimnasios en internet: el acceso a la web consultada fue bloqueado en este entorno.

La aplicación no registra la ubicación de visitantes. Como invitado, los favoritos se conservan en el almacenamiento local del navegador. Al crear una cuenta se almacenan el correo, el nombre, la ciudad opcional, los favoritos y un hash de la contraseña. El CSV señala si los datos de ocupación son ficticios, su fuente y la fecha de medición.

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
- 16 pruebas de autenticación, gimnasios y perfiles: registro, contraseña, cookies, aislamiento, expiración, cierre de sesión, límites de intentos y persistencia.
- Una prueba de integración con PostgreSQL 17 real: registro, acceso, edición y favoritos conservados al reconectar. Para repetirla, configura `GYMHORA_TEST_DATABASE_URL` con una base exclusiva para pruebas y ejecuta `npm test`; sin esa variable se omite esa prueba, sin omitir las otras 28. No uses la URL de producción para pruebas.
- Chromium: creación de cuenta, confirmación de contraseña, errores de acceso, edición de perfil, favoritos en un segundo contexto de navegador, restauración de sesión y cierre de sesión en escritorio y móvil.
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

## Cuentas y perfiles

Pulsa **Iniciar sesión** en la cabecera. Puedes crear una cuenta con nombre, correo y contraseña de 10 a 128 caracteres. Después podrás editar tu nombre y ciudad en **Mi perfil**, guardar favoritos en la cuenta y cerrar sesión. Los favoritos de invitado se mantienen separados; no se importan automáticamente a ninguna cuenta. Se puede explorar y descargar CSV sin registrarse.

Las contraseñas se guardan con scrypt y una sal aleatoria. Las sesiones duran 7 días y usan tokens aleatorios cuyo hash se almacena en la base de datos. El navegador recibe una cookie HttpOnly y SameSite=Lax; en producción también es Secure, con prefijo `__Host-`. No se guardan contraseñas ni tokens de sesión en localStorage o en la caché offline. El servidor comprueba el origen de las solicitudes de escritura y limita los intentos de autenticación. Estos límites están en memoria por instancia; un despliegue con varias instancias necesitará un limitador compartido.

El correo es un identificador de acceso: esta versión **no verifica la propiedad del correo ni envía correos de recuperación de contraseña**. Tampoco incluye inicio de sesión con Google o Apple.

### Desarrollo local

`npm start` crea la base SQLite en `.local/accounts.sqlite`, una carpeta ignorada por Git. Se puede cambiar su ubicación con `SQLITE_PATH`. Requiere Node 24 recomendado (o una versión de Node 22 que incluya `node:sqlite`). Reiniciar la aplicación conserva las cuentas mientras se conserve ese archivo. Las pruebas automáticas crean bases aisladas temporales y no utilizan cuentas reales.

### Activar cuentas persistentes en Render

**No uses SQLite en el disco efímero del servicio web de Render.** En producción, si falta una conexión PostgreSQL válida, el servidor conserva la exploración pero desactiva el registro y el inicio de sesión con un aviso explícito.

1. En Render crea una base **PostgreSQL** o selecciona una existente. Si creas una nueva, usa la misma región que el servicio `gymhora-rd`. Revisa precio, caducidad y copias de seguridad del plan antes de confirmar; los planes gratuitos, si se ofrecen, pueden tener caducidad y no son almacenamiento permanente.
2. Abre la página de esa base de datos. Copia su **Internal Database URL** si ambas están en Render y en la misma región.
3. En el servicio web **gymhora-rd → Environment**, añade `DATABASE_URL` con esa URL como valor privado. No la publiques en GitHub ni la pegues en el chat.
4. Configura también `NODE_ENV=production` si no está ya configurado por el Blueprint. Render proporciona `RENDER=true`; cualquiera de las dos marcas activa las cookies seguras y evita usar SQLite accidentalmente.
5. Guarda los cambios y vuelve a desplegar el último commit desde **Manual Deploy → Deploy latest commit**, o espera al despliegue automático si está activo. El servidor crea sus tablas e índices al iniciar; el usuario PostgreSQL debe tener permisos para crearlos.
6. Abre la aplicación mediante HTTPS. Pulsa **Iniciar sesión → Crear cuenta**, registra una cuenta, cambia su ciudad y guarda un favorito. Cierra sesión y vuelve a entrar para comprobar la persistencia.

`DATABASE_URL` se configura manualmente en Render: `render.yaml` no crea una base de datos ni contrata un plan de pago. No hace falta un secreto de firma de sesión, pues se utilizan tokens aleatorios almacenados en la base. La conexión respeta las opciones TLS de la URL de PostgreSQL, sin desactivar la verificación de certificados. Si usas un dominio personalizado y necesitas fijar el origen permitido explícitamente, configura `PUBLIC_ORIGIN` con su origen HTTPS exacto (sin ruta ni barra final). Normalmente se deriva del dominio de la petición.

La conexión a tu base de producción y su funcionamiento desde Safari se deben comprobar después de configurar `DATABASE_URL`; las pruebas locales no demuestran que esa conexión externa ya funcione.


## Añadir gimnasios y reportar su ocupación manualmente

Abre **Mis gimnasios** sobre el listado, o **Mi perfil → Administrar mis gimnasios**. Debes iniciar sesión para publicar. Introduce el nombre, la ciudad y el sector y selecciona:

- **Tranquilo:** hay bastante espacio.
- **Moderado:** hay movimiento.
- **Muy concurrido:** poco espacio libre.

El gimnasio aparecerá en el listado público con la etiqueta **Comunidad · Sin verificar**, fecha de actualización y estado reportado. No se crea un conteo de personas, un porcentaje ni un historial de horas pico a partir de esa selección. Los reportes de más de dos horas se muestran como antiguos y dejan de participar en los filtros de ocupación reciente. Las mediciones automáticas conservan su umbral de dos minutos.

Desde **Mis gimnasios**, el autor puede editar los datos, publicar otro estado y eliminar la entrada con confirmación. Cada cuenta puede gestionar hasta 20 gimnasios. El servidor deriva el autor de la sesión y comprueba ese autor para cada modificación y eliminación; no acepta un propietario indicado por el navegador. Añadir una sede no certifica la propiedad del gimnasio ni que su información sea auténtica. Los datos publicados son visibles para visitantes durante la prueba o un período pagado vigente; el correo y el identificador del autor no se incluyen en el listado público. El CSV distingue `REPORTE_MANUAL` y exporta el estado textual, dejando vacíos los conteos y porcentajes que no existen.

Los datos se guardan en la misma base de las cuentas. Para Render, sigue siendo necesaria una `DATABASE_URL` PostgreSQL válida. El arranque crea una tabla adicional con `CREATE TABLE IF NOT EXISTS`, sin borrar cuentas ni favoritos. Si ya configuraste la base, solo necesitas desplegar el nuevo commit. Si todavía no la configuraste, el aviso de cuentas no disponibles también impedirá publicar gimnasios; no se simula que se hayan guardado.

Se comprobaron las operaciones en SQLite y PostgreSQL, el aislamiento entre cuentas, la validación, la persistencia tras reconectar y el funcionamiento en Chromium en escritorio y móvil. La suite contiene 29 pruebas: 28 habituales y una integración PostgreSQL optativa mediante `GYMHORA_TEST_DATABASE_URL`.


## Plan para publicar gimnasios: RD$1,599 al mes y 7 días gratis

La cuenta personal, la búsqueda y los favoritos siguen siendo gratuitos. La publicación de cada gimnasio tiene un precio de **RD$1,599 mensuales por gimnasio**, con una **única prueba de siete días por cuenta de publicador**. Todos los gimnasios de esa cuenta comparten la fecha de fin de prueba; el precio mensual es por sede, no por los veinte perfiles permitidos. Añadir el primer gimnasio inicia el plazo de siete períodos de 24 horas medidos por el servidor. El formulario pide aceptar expresamente las condiciones antes de guardar un gimnasio nuevo.

**Estado actual: plan y período de prueba implementados; cobros reales pendientes.** El propietario de GymHora todavía no ha contratado una pasarela. No hay Checkout, formulario de tarjeta, cargos automáticos, renovación automática, cancelación de cargos ni endpoint de activación de pago. La pantalla lo informa y `GET /api/listing-plan` devuelve `paymentsAvailable: false`. Aceptar las condiciones de prueba no autoriza un cargo futuro; esa autorización tendrá que solicitarse al contratar la suscripción con la pasarela elegida.

Mientras dure la prueba, el gimnasio aparece en el listado. Al vencer, el servidor lo excluye del listado público y de las búsquedas públicas, pero conserva su información y permite al autor verla, editarla o eliminarla. El panel muestra el estado, los días restantes y la fecha y hora de vencimiento. No se inventan pagos: los datos del navegador como `paid`, `paid_until` o `trial_ends_at` no conceden acceso ni extienden el plazo.

### Migración de los perfiles existentes

Al iniciar esta versión, los publicadores que ya tienen gimnasios reciben una sola prueba de siete días desde la migración. Las fechas se guardan en `gymhora_publisher_trials`; reiniciar, redesplegar, editar, borrar o volver a añadir un gimnasio en esa cuenta no reinicia la prueba. Una cuenta nueva que solo busca gimnasios no inicia una prueba. Esta medida no verifica la identidad del negocio ni impide que una persona registre cuentas diferentes; para ello haría falta verificación comercial adicional.

Se crea además `gymhora_listing_subscriptions`, reservada para períodos pagados confirmados por una futura integración de pagos. No existe una API que permita al usuario escribir esa tabla. El listado contempla la fecha `paid_until` por gimnasio, pero el código actual no registra ni confirma pagos reales. Los registros pagados presentes en las pruebas son fixtures exclusivos de bases de prueba.

### Qué falta para cobrar de verdad

1. Contratar una pasarela compatible con el país donde está registrado el negocio y con suscripciones recurrentes en DOP. Confirmar con el proveedor sus comisiones, requisitos comerciales y soporte de pruebas gratis.
2. Integrar el pago alojado por la pasarela para **RD$1,599 por gimnasio al mes**, con consentimiento claro, sin almacenar tarjetas en GymHora.
3. Verificar los eventos firmados del proveedor y el importe, moneda, gimnasio y período antes de habilitar un período pagado. Hacer el procesamiento idempotente y contemplar renovaciones, pagos rechazados, cancelaciones y reembolsos. Un regreso a una página de éxito no debe activar una suscripción.
4. Añadir gestión de la suscripción y cancelación, configurar las credenciales únicamente en Render y probar todo con la modalidad de pruebas del proveedor antes de aceptar dinero real.

Hasta completar esos pasos, no hay forma de pagar desde la aplicación. Por ello, al cumplirse los siete días, la publicación queda pausada. Ten en cuenta este límite antes de invitar gimnasios a iniciar una prueba. No se crearon cuentas de pago ni se contrataron servicios durante esta implementación.

### Validación de la prueba y el acceso

La suite verifica precio y moneda, consentimiento obligatorio, rechazo de estados de pago fabricados, el límite exacto de siete días, ocultamiento al vencer, conservación de datos privados, prueba compartida por cuenta, persistencia al redesplegar y no reinicio al eliminar y recrear. También se comprobaron con Chromium la pantalla de precio, el alta gratuita de usuario, el consentimiento, la visibilidad de un gimnasio durante la prueba y su ocultamiento tras vencer, la edición posterior y el diseño móvil. La integración PostgreSQL comprueba el vencimiento tras reconectar y la lectura de un período pagado de prueba sin exponer una API que simule un pago.
