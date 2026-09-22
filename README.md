# Strict Popup Blocker

Extensión Manifest V3 para **Brave** y otros navegadores basados en Chromium. Bloqueo de **popups por ventana**, con **capas opcionales** (cookies, descargas, storage, trackers) apagadas por defecto para no romper el uso normal de la web.

> Brave ya bloquea muchos popups con Shields. Esta extensión cubre el hueco que queda: `window.open` disparado tras un clic “válido”, popunders y nuevas pestañas generadas por la página.

---

## ¿Qué hace?

Con la protección **activada en una ventana**:


| Capa                       | Comportamiento                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `window.open`              | Se intercepta en el contexto real de la página y siempre se bloquea (salvo whitelist) |
| Sellado de API             | Impide que el sitio reemplace fácilmente `window.open`                                |
| `target="_blank"`          | Cancela clics en enlaces que abren nueva pestaña sin modificadores                    |
| Ventanas `popup`           | Las cierra al crearse                                                                 |
| Navegación a nueva pestaña | Cierra destinos creados por la web (`webNavigation`)                                  |
| Refuerzo `tabs.onCreated`  | Cierra pestañas hijas no autorizadas que se escaparon                                 |
| Cookies JS                 | Opcional: bloquea `document.cookie` y Cookie Store                                    |
| Cookies HTTP               | Opcional: quita `Cookie` / `Set-Cookie` (puede cerrar sesión)                         |
| Descargas                  | Opcional: cancela descargas iniciadas por el sitio                                    |
| Storage                    | Opcional: bloquea `localStorage` / `sessionStorage`                                   |
| Trackers                   | Opcional: beacon, service workers, notificaciones, clipboard                          |


El interruptor principal (**Popups**) es **por ventana**:

- Ventana A en **ON** → bloquea popups/pestañas **externas** solo ahí
- Ventana B en **OFF** → no interviene
- Toda ventana nueva arranca en **OFF**

Las **capas extras** (cookies, descargas, storage, trackers) están **apagadas por defecto**. Solo se aplican si Popups está ON y tú las activas. Así el sitio sigue funcionando en el día a día.

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

### Flujo del interruptor ON/OFF (por ventana)

1. El estado se guarda **por `windowId`** en memoria (+ `chrome.storage.session` para sobrevivir al reinicio del service worker).
2. El popup pregunta/actualiza solo la ventana desde la que lo abriste.
3. Content e injected reciben el estado de **esa** ventana y bloquean o no en consecuencia.
4. El service worker solo cierra popups/pestañas si la **ventana de origen** tenía la protección ON.
5. El badge del icono es por pestaña (`ON` / `OFF` / contador) según la ventana de esa pestaña.

### Incógnito

1. En `brave://extensions` → Strict Popup Blocker → activa **Permitir en privado** / **Allow in Incognito**.
2. Abre una ventana de incógnito y enciende el switch ahí.
3. Tus ventanas normales siguen en OFF (arranque por defecto).



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

1. Haz clic en el icono **desde la ventana** donde quieras protegerte.
2. Activa **Popups** (ON) — solo bloquea aperturas externas.
3. Si el sitio es sospechoso, enciende **capas extras** una a una.
4. Usa **Permitir excepciones** si un dominio de confianza se rompe.
5. Consulta el contador y el registro de bloqueos.

---



## Permisos


| Permiso                                  | Motivo                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| `storage`                                | Guardar whitelist, contador y registro                          |
| `tabs` / `windows`                       | Estado por ventana y cierre de popups                           |
| `webNavigation`                          | Detectar aperturas a nueva pestaña iniciadas por la página      |
| `scripting`                              | Inyección de scripts en páginas                                 |
| `downloads`                              | Cancelar descargas desde ventanas protegidas                    |
| `declarativeNetRequestWithHostAccess`    | Quitar cabeceras Cookie / Set-Cookie en pestañas protegidas     |
| `<all_urls>`                             | Aplicar lockdown en cualquier sitio                             |


---



## Limitaciones

No existe un lockdown **100 % infalible** desde una extensión. Se combinan varias capas para acercarse lo máximo posible.

Casos a tener en cuenta:

- Con solo **Popups ON**, la mayoría de sitios deberían seguir usable (se permiten aperturas al mismo dominio).
- **Cookies HTTP** y **Storage** son las capas más agresivas: actívalas solo en sitios dudosos.
- Sitios con OAuth/pagos en dominios externos pueden necesitar whitelist o Popups OFF un momento.
- Redirecciones en la misma pestaña (`location.href = …`) no se cancelan en esta versión.
- Brave Shields y esta extensión pueden convivir.

---



## Desarrollo

1. Edita los archivos fuente.
2. En `brave://extensions`, pulsa **Recargar** en la extensión.
3. Recarga las pestañas abiertas para que el content script se reinjecte.
4. Abre la consola de la página y del service worker para ver mensajes `[Strict Lockdown]`.

Ideas para versiones futuras:

- Interruptores independientes por capa (cookies / descargas / storage)
- Página de opciones con whitelist editable
- Filtro de redirecciones sospechosas
- Lista de dominios publicitarios conocidos

---



## Licencia

MIT — puedes usarla, modificarla y publicarla libremente.