# Plan de diseño "Aurora": una sola anatomía para todo AC Graph

Fecha: 2026-09-09 · Estado: **ejecutado en esta misma entrega** (ver `docs/CHECKPOINTS.md`, "Aurora").

## Diagnóstico

Cada superficie del producto había crecido con su propio formato:

| Superficie           | Cabecera                       | Búsqueda             | Filas / celdas                           | Grupos                       |
| -------------------- | ------------------------------ | -------------------- | ---------------------------------------- | ---------------------------- |
| Explorar servicios   | `code-panel-header` + contador | `browser-search`     | `browser-tile` (icono 26 + texto)        | pegajosos, versalitas 10.5   |
| Buscador (⌘K)        | solo campo                     | `palette-search`     | `palette-row` (icono 17 + texto + kbd)   | `palette-group` sin contador |
| Selector de iconos   | campo + chips                  | `icon-picker-search` | `icon-picker-tile` (rejilla)             | pegajosos                    |
| Inspector            | héroe                          | —                    | campos                                   | `inspector-section-header`   |
| Historial / Análisis | `code-panel-header`            | —                    | `version-row` / `insight-row`            | `group-header` sin contador  |
| Menús / contextual   | —                              | —                    | `topbar-menu-item` / `context-menu-item` | `topbar-menu-group`          |

Resultado: seis tamaños de icono, cuatro alturas de fila, tres estilos de campo, dos de cabecera. Se **siente** distinto al cambiar de panel, que es lo contrario de premium.

## Principios

1. **Una anatomía, muchos contenidos.** Panel → cabecera → (búsqueda) → (pestañas) → cuerpo con secciones pegajosas → pie. Fila → tesela de icono 28 px → título 13 px → subtítulo 11 px → meta a la derecha (kbd, contador, nube). Rejilla → tesela 30 px + etiqueta. Campo → 34 px, radio 10, anillo violeta.
2. **Un material.** Cristal esmerilado con filo de luz para todo lo que flota; pista hundida + pulgar elevado para lo segmentado; teclas que parecen teclas.
3. **Un lenguaje de hover.** Tinte + filo + barra lateral que crece; nunca escala en filas (mueve a los vecinos).
4. **Un lenguaje de estado.** Chips con tono por significado (éxito/aviso/peligro/info/neutro/acento), iguales en el inspector y en el lienzo.
5. **Movimiento con propósito.** Entradas escalonadas, cámara que se desliza, tooltips propios; todo sobre transform/opacity; apagado con `prefers-reduced-motion`.
6. **Nada de adorno.** Todo control cambia algo observable; la auditoría `scripts/audit-controls.mjs` lo comprueba (68 controles) y forma parte de la verificación.

## Tokens (extensión de `tokens.ts` / `globals.css`)

- Radios: `--r-row: 10px`, `--r-tile: 12px`, `--r-panel: 18px`, `--r-field: 10px`.
- Alturas: fila 40 px (icono 28), fila compacta 34 px (menús), campo 34 px, cabecera de panel 44 px.
- Tipografía: título de fila 13/600 tracking −0.005em, subtítulo 11/400, versalitas de sección 10.5/600 tracking 0.08em.
- Cristal: `--glass-1` 62 % (barras), `--glass-2` 78 % (paneles), `--glass-3` 94 % (menús, tooltips).

## Ejecución (esta entrega)

1. **Capa "Aurora" en `globals.css`**: define la anatomía y la aplica sobre las clases existentes de las seis superficies (browser, paleta, selector, historial, análisis, menús, contextual, inspector) para que todas midan y respondan igual sin romper selectores de pruebas.
2. **Paleta ⌘K como panel**: misma cabecera con título y contador, mismas filas que el explorador (tesela 28, título, meta), mismos grupos con contador.
3. **Lienzo**: brillo superior en tarjetas de servicio (gloss) y banda tintada en la cabecera del grupo para dar profundidad de material también al dibujo.
4. **Iconos propios** en Explorar, en el selector y en su propio diálogo, con la misma tesela y la misma subida.
5. **Auditoría funcional** repetible (`node scripts/audit-controls.mjs`) en CI local antes de cada entrega.

## Siguientes pasos (fuera de esta entrega)

- ~~Extraer componentes React `Panel`, `PanelHeader`, `Row`, `Tile`, `Field` y migrar las seis superficies a ellos.~~ **Hecho** (2026-09-10, H1 #2 fase 2): `src/components/ui/{PanelHead,Kbd,SearchField,Chip,GroupHeader,Tile,Row,Field,Section}.tsx`; las clases propias de cada superficie viajan por props porque el CSS y las pruebas las nombran, y la anatomía común la impone el componente. Verificado con `styles:compare` = 0 diferencias.
- Tooltips con descripción larga (segunda línea) para las herramientas del dock.
- Modo compacto para portátiles de 13".
