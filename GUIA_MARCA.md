# Guía rápida de identidad — TVM Server v0.2

Manual de referencia: **Manual de marca GyA.pdf**, versión 3, 2026, entregado para este proyecto.

## Decisiones visuales

| Elemento | Valor | Origen |
| --- | --- | --- |
| Celeste principal | `#00AEEF` | Manual, página 14 |
| Azul secundario | `#2F88E4` | Manual, página 14 |
| Gris | `#545454` | Manual, página 14 |
| Blanco | `#FFFFFF` | Manual, página 15 |
| Logotipo | Archivo `frontend/public/brand/gya-logo-horizontal.png` | Extraído de la página 11 |
| Isotipo | `frontend/public/brand/gya-simbolo.png` | Extraído de la página 11 |
| Ondas decorativas | `frontend/public/brand/gya-ondas.png` | Basadas en la página 25 |
| Fuente principal | Spartakus (si está disponible) | Página 18 |
| Fuente secundaria | Readex Pro | Página 19 |
| Fuente de complemento | Exo 2 | Página 20 |

> El diseño corporativo convive con un fondo oscuro en el panel lateral para mantener la estética que ya fue aprobada. El logo original celeste se ubica sobre una placa blanca, de modo que no se altera la marca ni se la superpone directamente sobre negro.

## Comportamiento y limitaciones

- Backend/API, tablas, roles y rutas **sin cambios** respecto a TVM Server v0.1.
- `index.html` carga un favicon oficial extraído del manual; no es un logo inventado.
- No distribuir fuentes sin una licencia de distribución compatible: este paquete **no incluye archivos de fuentes**.
- El frontend puede ser previsualizado en Windows, pero sin PostgreSQL/backend solo muestra el login y no permite usar los paneles.
- La Raspberry continúa con TVM Player v1.4; sin sincronización remota en esta etapa.
- Recomendación de implementación: confirmar el derecho de usar el manual, logo y activos en las plataformas donde se publicará (material provisto por quien encarga el trabajo).
