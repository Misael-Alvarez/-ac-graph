# Iconos de arquitectura cloud

1,470 SVG listos para usar.

| Carpeta  | Iconos | Origen                                                                                     | Tipo                    | Fecha    |
| -------- | ------ | ------------------------------------------------------------------------------------------ | ----------------------- | -------- |
| `aws/`   | 809    | npm `aws-icons` v3.3.0, derivado del set oficial de AWS                                    | espejo de terceros      | mar 2026 |
| `azure/` | 101    | Microsoft, "Azure Public Service Icons" **V24** (+ 1 icono del set "Microsoft Entra")      | **descarga oficial**    | sep 2026 |
| `gcp/`   | 216    | npm `@f5-sales-demo/icons-gcp`, formato Iconify convertido a SVG                           | espejo de terceros      | jun 2026 |
| `oci/`   | 79     | Oracle, "OCI Architecture Diagram Toolkit" para draw.io (**v24.2**, más 2 de la librería)  | **descarga oficial**    | sep 2026 |
| `ibm/`   | 265    | repo oficial `IBM-Cloud/architecture-icons`                                                | repositorio oficial     | actual   |

`aws/` conserva la estructura oficial: `architecture-service/` (300),
`resource/` (468), `category/` (26), `architecture-group/` (15).

`azure/` y `oci/` contienen **solo los archivos que el sprite usa** (los que
`scripts/refreshIcons.mjs` asigna a una clave `az-*` u `oci-*`), con su nombre
original. `src/data/iconSources.json` dice qué archivo dibuja cada servicio.

## Azure (descarga oficial)

- Paquete: `Azure_Public_Service_Icons_V24.zip`, enlazado desde
  https://learn.microsoft.com/en-us/azure/architecture/icons/ y descargado el
  2026-09-14 de `https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip`.
  Los archivos se llaman `NNNNN-icon-service-<Producto>.svg`; el número se
  descarta al emparejar. 100 archivos.
- `azure/entra/Microsoft Entra ID color icon.svg`: el set de Azure ya no trae el
  icono principal de Entra ID; viene del paquete "Microsoft Entra architecture
  icons - Oct 2023", enlazado desde
  https://learn.microsoft.com/en-us/entra/architecture/architecture-icons y
  descargado el 2026-09-14 de `https://download.microsoft.com/download/3/1/a/31a56038-856a-4489-88e4-ee5a1c4352be/Microsoft%20Entra%20architecture%20icons%20-%20Oct%202023.zip`.
- Términos (`Microsoft_Terms_of_Use.pdf` dentro del zip, idénticos en la página
  de Entra): _"Microsoft permits the use of these icons in architectural
  diagrams, training materials, or documentation. You may copy, distribute, and
  display the icons only for the permitted use unless granted explicit
  permission by Microsoft. Microsoft reserves all other rights."_ Prohibido
  recortar, voltear, rotar o deformar los iconos, y usarlos para representar un
  producto propio. El sprite los deja tal cual (colores, degradados y
  proporciones); solo elimina metadatos y prefija los `id` internos.

## OCI (descarga oficial)

- Paquete: `OCI-Style-Guide-for-Drawio.zip`, enlazado desde
  https://docs.oracle.com/en-us/iaas/Content/General/Reference/graphicsfordiagrams.htm
  y descargado el 2026-09-14 de
  `https://docs.oracle.com/en-us/iaas/Content/Resources/Assets/OCI-Style-Guide-for-Drawio.zip`.
  Contiene `OCI Architecture Diagram Toolkit v24.2.drawio` (ene 2024) y
  `OCI Library.xml` (jul 2022).
- Oracle no publica los iconos como SVG: en draw.io son _stencils_ de mxGraph
  (trazados `move`/`line`/`curve` comprimidos dentro del estilo de cada celda).
  `scripts/ociDrawioToSvg.mjs` los reproduce como hace `mxStencil.js` y escribe
  un SVG por icono, con el título de la página como nombre:
  - `oci/*.svg` (77): página "Icons" del toolkit v24.2, el set más reciente.
  - `oci/library-2022/*.svg` (2): FastConnect y Site-to-Site VPN, que en el
    toolkit solo existen como estilo de conector; la librería de 2022 lleva su
    glifo como imagen SVG incrustada (clases `.st0` resueltas a atributos).
  - Reproducir: `node scripts/ociDrawioToSvg.mjs "<zip>/OCI Architecture Diagram Toolkit v24.2.drawio" <salida> --page Icons`
    y `node scripts/ociDrawioToSvg.mjs "<zip>/OCI Library.xml" <salida>`.
- Términos: la página oficial dice _"Use these assets to draw custom
  architecture diagrams for your OCI implementation."_ y el toolkit,
  _"Use this guide to create diagrams that have a unified visual language for
  topology diagrams using Oracle's Cloud products and services."_
  (Copyright © 2022, Oracle and/or its affiliates; sin licencia de
  redistribución más amplia: uso en diagramas de arquitectura). Los glifos se
  conservan con sus colores (Bark `#2d5967` sobre placa blanca) sin retocar.

## Lo que NO está aquí y por qué

- **Azure**: Copilot Studio, Semantic Kernel, Microsoft Fabric, Purview,
  CycleCloud, Managed Lustre, Bicep y Azure CLI no tienen icono en el set V24;
  GitHub, GitHub Actions y Codespaces son marca de GitHub y no forman parte de
  él. Conservan el símbolo propio de la app.
- **OCI**: VMware Solution (marca de VMware), Budgets y Cost Analysis no tienen
  icono en el toolkit v24.2. Conservan el símbolo propio de la app.

## Advertencias

`aws/` y `gcp/` son **espejos de terceros**, no descargas oficiales. AWS publica
cada trimestre y advierte explícitamente que revises no estar usando un set
legacy. El set de AWS aquí es de marzo 2026, así que le falta el paquete Q2 2026
como mínimo. Para producción, cotéjalo contra el oficial.

La licencia MIT de esos paquetes npm cubre el **código**, no los iconos: las
marcas siguen siendo de AWS, Google, IBM, Microsoft y Oracle, bajo sus propios
términos de uso (permitidos en diagramas de arquitectura y documentación; no
para representar productos propios ni para uso comercial como producto en sí).
