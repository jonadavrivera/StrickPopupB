# Strict Popup Blocker

Extensión Manifest V3 para **Brave** y otros navegadores basados en Chromium. Bloquea ventanas emergentes, popunders y pestañas abiertas por JavaScript de forma agresiva, con un interruptor **ON/OFF** y whitelist por sitio.

> Brave ya bloquea muchos popups con Shields. Esta extensión cubre el hueco que queda: `window.open` disparado tras un clic “válido”, popunders y nuevas pestañas generadas por la página.

---

## ¿Qué hace?

Con la protección **activada**:


| Capa                       | Comportamiento                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `window.open`              | Se intercepta en el contexto real de la página y siempre se bloquea (salvo whitelist) |
| Sellado de API             | Impide que el sitio reemplace fácilmente `window.open`                                |
| `target="_blank"`          | Cancela clics en enlaces que abren nueva pestaña sin modificadores                    |
| Ventanas `popup`           | Las cierra al crearse                                                                 |
| Navegación a nueva pestaña | Cierra destinos creados por la web (`webNavigation`)                                  |
| Refuerzo `tabs.onCreated`  | Cierra pestañas hijas no autorizadas que se escaparon                                 |


Con la protección **desactivada**, la extensión no interviene.

**Excepciones intencionadas** (para no romper el uso normal del navegador):

- Pestañas abiertas a mano (`Cmd/Ctrl + T`, botón “Nueva pestaña”)
- `Cmd/Ctrl + clic`, `Shift + clic` y clic medio (intención explícita del usuario)
- Sitios añadidos a la whitelist desde el popup de la extensión

---



## ¿Cómo funciona?

```
Página web
   │
   ├── window.open(...)
   │       → injected/popup-interceptor.js  → BLOQUEAR
   │
   ├── <a target="_blank">
   │       → content/content.js (click)     → BLOQUEAR
   │
   ├── onclick / listeners
   │       → siguen pasando por window.open sellado
   │
   └── si un popup/pestaña se abre igual
           → background/service-worker.js
               chrome.windows / tabs / webNavigation
           → CERRAR
```



### Por qué hay un script inyectado

El content script vive en un **mundo aislado**. Si solo haces `window.open = …` desde `content.js`, el JavaScript de la página puede seguir usando el `window.open` original.

Por eso `content.js` inyecta `injected/popup-interceptor.js` en el contexto de la página (`document_start`) y sella la propiedad con `Object.defineProperty`.

### Flujo del interruptor ON/OFF

1. El estado se guarda en `chrome.storage.local` (`enabled`).
2. El popup actualiza ese valor al mover el switch.
3. Content e injected reciben el cambio y dejan de bloquear (o vuelven a bloquear).
4. El service worker también respeta `enabled` antes de cerrar pestañas/ventanas.
5. El badge del icono muestra `OFF` o el número de bloqueos del día.



### Whitelist

Desde el popup puedes **permitir popups en el sitio actual**. Ese dominio se guarda en `allowedDomains` y todas las capas lo respetan.

---



## Estructura del proyecto

```
StrickPopupB/
├── manifest.json                 # Manifest V3 (permisos, scripts, iconos)
├── background/
│   └── service-worker.js         # Última defensa: cerrar popups/pestañas
├── content/
│   └── content.js                # Inyecta el interceptor + detecta clics
├── injected/
│   └── popup-interceptor.js      # Corre en la página; bloquea window.open
├── popup/
│   ├── popup.html                # UI del action
│   ├── popup.css
│   └── popup.js                  # Switch ON/OFF, whitelist, contador
├── shared/
│   └── constants.js              # Claves y valores por defecto
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```


| Archivo                         | Rol                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `manifest.json`                 | Define MV3, `run_at: document_start`, `web_accessible_resources`, permisos                       |
| `content/content.js`            | Inyecta el script de página, bloquea `target="_blank"`, autoriza Cmd/Ctrl+clic, reporta bloqueos |
| `injected/popup-interceptor.js` | Reemplaza y sella `window.open`; emite eventos de bloqueo                                        |
| `background/service-worker.js`  | Escucha `tabs`, `windows` y `webNavigation`; mantiene contador y badge                           |
| `popup/*`                       | Interfaz: protección ON/OFF, sitio actual, whitelist, registro reciente                          |


---



## Instalación (modo desarrollador)

Funciona en **Brave**, **Chrome**, **Edge** y otros Chromium.

1. Clona el repositorio:
  ```bash
   git clone https://github.com/jonadavrivera/StrickPopupB
   cd StrickPopupB
  ```
2. Abre el administrador de extensiones:
  - Brave: `brave://extensions`
  - Chrome: `chrome://extensions`
  - Edge: `edge://extensions`
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar extensión sin empaquetar** / **Load unpacked**.
5. Selecciona la carpeta del proyecto (la que contiene `manifest.json`).

No requiere build ni dependencias de npm.

---



## Uso

1. Haz clic en el icono de la extensión.
2. Usa el interruptor **ON / OFF** para activar o desactivar la protección.
3. Revisa el **sitio actual**.
4. Si un sitio legítimo necesita popups, pulsa **Permitir popups en este sitio**.
5. Consulta **Bloqueados hoy** y el listado de **Últimos bloqueos**.

---



## Permisos


| Permiso         | Motivo                                                     |
| --------------- | ---------------------------------------------------------- |
| `storage`       | Guardar ON/OFF, whitelist, contador y registro             |
| `tabs`          | Detectar y cerrar pestañas hijas no autorizadas            |
| `windows`       | Cerrar ventanas de tipo `popup`                            |
| `webNavigation` | Detectar aperturas a nueva pestaña iniciadas por la página |
| `scripting`     | Soporte de inyección / scripts en páginas                  |
| `<all_urls>`    | Interceptar popups en cualquier sitio                      |


---



## Limitaciones

No existe un bloqueo **100 % infalible** desde una extensión: algunas aperturas ocurren fuera del alcance del content script. Esta extensión combina varias capas para acercarse lo máximo posible.

Casos a tener en cuenta:

- Sitios que dependen de popups reales (OAuth, pagos, impresiones) → usa la whitelist o desactiva temporalmente.
- Redirecciones en la misma pestaña (`location.href = …`) no son popups; esta versión no las trata como tal.
- Brave Shields y esta extensión pueden convivir; no se sustituyen entre sí.

---



## Desarrollo

1. Edita los archivos fuente.
2. En `brave://extensions`, pulsa **Recargar** en la extensión.
3. Recarga las pestañas abiertas para que el content script se reinjecte.
4. Abre la consola de la página y del service worker para ver mensajes `[Strict Popup Blocker]`.

Ideas para versiones futuras:

- Modos Normal / Estricto / Muy estricto
- Página de opciones con whitelist editable
- Filtro de redirecciones sospechosas con `declarativeNetRequest`
- Lista de dominios publicitarios conocidos

---



## Licencia

MIT — puedes usarla, modificarla y publicarla libremente.