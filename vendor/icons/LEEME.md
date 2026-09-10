# Iconos de arquitectura cloud

1,296 SVG listos para usar.

| Carpeta | Iconos | Origen | Fecha |
|---|---|---|---|
| `aws/` | 809 | npm `aws-icons` v3.3.0, derivado del set oficial de AWS | mar 2026 |
| `gcp/` | 216 | npm `@f5-sales-demo/icons-gcp`, formato Iconify convertido a SVG | jun 2026 |
| `ibm/` | 271 | repo oficial `IBM-Cloud/architecture-icons` | actual |

`aws/` conserva la estructura oficial: `architecture-service/` (300),
`resource/` (468), `category/` (26), `architecture-group/` (15).

## Lo que NO está aquí y por qué

- **Azure (~624 iconos)** — en npm solo existen como componentes React con el
  SVG embebido en JSX, y el paquete más completo es de nov 2024. Habría que
  convertir de JSX a SVG desde una fuente ya desactualizada. Bájalo del
  oficial: https://learn.microsoft.com/en-us/azure/architecture/icons/
  (marca la casilla de términos y aparece el botón)
- **Entra ID** — descarga aparte del set de Azure:
  https://learn.microsoft.com/en-us/entra/architecture/architecture-icons
- **OCI** — no hay espejo en npm ni en GitHub que valga la pena:
  https://docs.oracle.com/en-us/iaas/Content/General/Reference/graphicsfordiagrams.htm

## Advertencias

Estos son **espejos de terceros**, no descargas oficiales. AWS publica cada
trimestre y advierte explícitamente que revises no estar usando un set legacy.
El set de AWS aquí es de marzo 2026, así que le falta el paquete Q2 2026 como
mínimo. Para producción, cotéjalo contra el oficial.

La licencia MIT de estos paquetes npm cubre el **código**, no los iconos: las
marcas siguen siendo de AWS, Google e IBM, bajo sus propios términos de uso
(permitidos en diagramas de arquitectura y documentación; no para representar
productos propios ni para uso comercial como producto en sí).
