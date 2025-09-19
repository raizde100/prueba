# Buscador de Licitaciones por Producto (Perú · OCDS)

Plataforma open‑source para que empresas encuentren licitaciones públicas en Perú según los **productos/servicios que venden (UNSPSC)**, usando datos en formato **OCDS** desde el portal de **Contrataciones Abiertas**.

> **TL;DR**
>
> * Ingesta desde `/api/v1/records` (OCDS **record packages**) → normalización a Postgres → indexación en OpenSearch → API propia → UI web.
> * Matching por **`tender.items[].additionalClassifications[scheme="UNSPSC"].id`** con soporte de lotes.
> * Filtros por plazo, entidad, ubicación, monto y modalidad.

---

## Tabla de contenidos

1. [Arquitectura](#arquitectura)
2. [Fuentes de datos y endpoints](#fuentes-de-datos-y-endpoints)
3. [Modelo de datos](#modelo-de-datos)
4. [Instalación rápida (Docker)](#instalación-rápida-docker)
5. [Configuración](#configuración)
6. [Pipeline de ingesta](#pipeline-de-ingesta)
7. [Indexación y búsqueda](#indexación-y-búsqueda)
8. [API del backend](#api-del-backend)
9. [Aplicación web](#aplicación-web)
10. [Calidad de datos y reglas Perú](#calidad-de-datos-y-reglas-perú)
11. [Monitoreo y operación](#monitoreo-y-operación)
12. [Roadmap](#roadmap)
13. [Contribuir](#contribuir)
14. [Licencia](#licencia)

---

## Arquitectura

```mermaid
flowchart LR
  A[OCDS Records API\ncontratacionesabiertas.oece.gob.pe/api/v1/records] -->|JSON| B[Ingestor\nPython]
  B --> C[(Blob/Raw JSON)]
  B --> D[(Postgres\nEsquema normalizado)]
  D --> E[(OpenSearch\nÍndice tenders)]
  E --> F[API propia\n(REST/GraphQL)]
  F --> G[Web App\n(Next.js/React)]
  F --> H[Alertas\nJobs/Workers]
```

---

## Fuentes de datos y endpoints

**Base Perú (OCDS):**

* `GET /api/v1/records` → Paquetes de **records** con `records[].compiledRelease` (principal para indexar). Cada record suele incluir `ocid`, `compiledRelease`, y `releases[]` con `url` a releases unitarios.
* `GET` a las URLs en `records[].releases[].url` → *releases* individuales (para auditoría/historial y deltas).

> **Nota:** Los nombres exactos de parámetros de paginación pueden variar. El ingestor permite configurar el nombre del parámetro de página y tamaño (ej. `page`, `pageSize`).

**Opcional (planeamiento/demanda futura):** datasets de PAC (Plan Anual de Contrataciones) para radar de oportunidades. Integración fuera del alcance del MVP.

---

## Modelo de datos

### Principios

* Usar **`compiledRelease`** como fuente canónica para el estado más reciente de cada proceso (`ocid`).
* Mantener **raw JSON** para trazabilidad.
* Normalizar a tablas relacionales y derivar vistas para búsqueda.

### Tablas (Postgres)

**processes**

* `ocid` (PK)
* `release_id`, `date`, `published_date`
* `buyer_id`, `buyer_name`
* `title`, `description`
* `procurement_method`, `procurement_method_details`
* `main_category`
* `amount`, `currency`, `currency_name`, `amount_pen`
* `tender_start`, `tender_end`, `enquiry_start`, `enquiry_end`
* `data_segment_id` (p. ej., "2025-08")

**parties**

* `ocid` (FK), `party_id`, `name`
* `id_scheme`, `id_value`, `ruc`
* `role` (buyer, procuringEntity, supplier, tenderer, etc.)
* `region`, `department`

**items**

* `ocid` (FK), `item_id`, `description`, `quantity`, `unit_name`
* `unspsc_id`, `unspsc_desc`
* `base_class_scheme`, `base_class_id`, `base_class_desc` (ej. CUBSO)
* `related_lot`
* `total_value_amount`, `currency`

**lots**

* `ocid` (FK), `lot_id`, `title`, `description`, `value_amount`, `currency`

**awards**

* `ocid` (FK), `award_id`, `date`, `value_amount`, `currency`, `status`

**award\_items**

* `ocid` (FK), `award_id`, `item_id`, `unspsc_id`, `quantity`, `total_value_amount`

**suppliers**

* `ocid` (FK), `award_id`, `supplier_id`, `supplier_name`, `ruc`

**contracts**

* `ocid` (FK), `contract_id`, `award_id`, `title`, `description`, `date_signed`
* `start_date`, `end_date`, `duration_days`
* `value_amount`, `currency`, `status`

**contract\_items**

* `ocid` (FK), `contract_id`, `item_id`, `unspsc_id`, `quantity`, `total_value_amount`

**documents**

* `ocid` (FK), `scope` ENUM('tender','award','contract'), `scope_id`
* `document_id`, `document_type`, `title`, `url`, `format`, `date_published`

**raw\_records**

* `ocid` (PK), `payload` JSONB, `ingested_at` TIMESTAMPTZ

### Mapeo de campos (paths OCDS → tablas clave)

* **UNSPSC**: `compiledRelease.tender.items[].additionalClassifications[?scheme=="UNSPSC"].{id,description}` → `items.unspsc_id`, `items.unspsc_desc`
* **Clasificación base local**: `compiledRelease.tender.items[].classification` (ej. `scheme="CUBSO"`) → `items.base_class_*`
* **Plazos**: `compiledRelease.tender.tenderPeriod.{startDate,endDate}` → `processes.tender_start/end`
* **Monto**: `compiledRelease.tender.value.{amount,currency,currencyName,amount_PEN}` → `processes.amount*`
* **Comprador**: `compiledRelease.buyer` y/o `compiledRelease.parties[roles contains buyer]` (RUC en `additionalIdentifiers[scheme=="PE-RUC"]`)
* **Documentos**: `compiledRelease.tender.documents[]`, `compiledRelease.awards[].documents[]`, `compiledRelease.contracts[].documents[]`

---

## Instalación rápida (Docker)

Requisitos: Docker ≥ 24, Docker Compose ≥ 2.20

```bash
# 1) Clonar
git clone https://example.com/peru-ocds-licitaciones.git
cd peru-ocds-licitaciones

# 2) Variables de entorno
cp .env.example .env
# Edita .env con tus credenciales/URLs

# 3) Levantar stack
docker compose up -d

# 4) Cargar datos (backfill o sample)
docker compose exec api python scripts/ingest_records.py --since "2025-01-01"

# 5) Construir índice
docker compose exec api python scripts/build_index.py
```

Servicios por defecto:

* **Postgres**: `localhost:5432`
* **OpenSearch**: `localhost:9200`
* **API**: `localhost:8080`
* **Web**: `localhost:3000`

---

## Configuración

`.env` (ejemplo):

```ini
# Fuente OCDS Perú
OCDS_API_BASE=https://contratacionesabiertas.oece.gob.pe/api/v1
OCDS_RECORDS_ENDPOINT=/records
OCDS_PAGE_PARAM=page
OCDS_PAGESIZE_PARAM=pageSize
OCDS_PAGESIZE=50
OCDS_TIMEOUT_SECONDS=60

# Base de datos
POSTGRES_HOST=db
POSTGRES_DB=licitaciones
POSTGRES_USER=licitaciones
POSTGRES_PASSWORD=secret

# OpenSearch
OPENSEARCH_HOST=opensearch
OPENSEARCH_PORT=9200
OPENSEARCH_INDEX=tenders

# API y Web
API_PORT=8080
WEB_PORT=3000

# Alertas / Jobs
CRON_INGEST=*/30 * * * *
CRON_REINDEX=0 3 * * *
```

> Si el proveedor cambia los nombres de los parámetros de paginación, actualiza `OCDS_PAGE_PARAM` y `OCDS_PAGESIZE_PARAM`.

---

## Pipeline de ingesta

### 1) Full load (backfill)

* Paginar `GET {OCDS_API_BASE}{OCDS_RECORDS_ENDPOINT}` y persistir **cada record** en `raw_records`.
* Parsear `compiledRelease` y **upsert** en tablas (`ocid` es la clave lógica). Guardar `release_id` y fechas.

### 2) Incremental (near‑real‑time)

* Consultar por ventanas de tiempo basadas en `compiledRelease.date` o `publishedDate`.
* Reintentos con backoff; idempotencia por (`ocid`,`release_id`).

### 3) Drill‑down bajo demanda

* Para auditoría/historial, follow a `records[].releases[].url` y mostrar diffs en UI.

### 4) Limpieza/normalización

* Dedupe de `parties` por `(identifier.scheme, identifier.id)` y fuzzy por nombre.
* Enlace `awards` ↔ `contracts` por `awardID` (con heurísticas si faltan vínculos directos).

Scripts CLI (resumen):

```bash
python scripts/ingest_records.py --since "2025-01-01" --max-pages 500
python scripts/reconcile_awards_contracts.py
python scripts/build_index.py --full
```

---

## Indexación y búsqueda

### Diseño de índice (OpenSearch)

Campos sugeridos en `tenders`:

* `ocid` (keyword)
* `title`, `description` (text)
* `buyer_name` (keyword + text)
* `unspsc` (keyword, multi‑valor) — desde `additionalClassifications`
* `unspsc_segment`, `unspsc_family`, `unspsc_class`, `unspsc_commodity` (keyword) — derivaciones de los 8 dígitos
* `department`, `region` (keyword)
* `main_category`, `procurement_method`, `procurement_method_details` (keyword)
* `amount_pen` (double), `amount`, `currency` (keyword)
* `tender_end` (date), `published_date` (date)
* `has_lots` (boolean)

### Relevancia (scoring)

1. **Match UNSPSC**: commodity > class > family > segment (boost descendente).
2. **Plazo**: tender con `tender_end` futuro > pasado.
3. **Monto**: mayor `amount_pen` recibe leve boost.
4. **Recencia**: mayor `published_date`.

### Consultas ejemplo

* Por UNSPSC exacto: `unspsc:25101611 AND tender_end:[now TO *]`
* Por familia: `unspsc_family:2510 AND department:"Lima"`
* Texto + UNSPSC: `"camión" AND (unspsc:25101611 OR unspsc_family:2510)`

---

## API del backend

### Endpoints

* `GET /search`

  * **Query params**: `q`, `unspsc`(multi), `department`, `buyer`, `method`, `min_amount`, `max_amount`, `deadline_from`, `deadline_to`, `page`, `page_size`.
  * **Respuesta**: lista paginada de procesos y/o lotes con `ocid`, `title`, `buyer_name`, `amount_pen`, `tender_end`, `unspsc[]`, `highlights[]`, `documents[]`.

* `GET /tenders/{ocid}`

  * **Respuesta**: detalle desde Postgres (procesos, items, lotes, awards, contracts, documentos) + historial opcional.

* `POST /alerts`

  * **Body**: filtros persistidos (UNSPSC, entidad, monto, ubicación, plazo) + canal de notificación.

### Ejemplos

```
GET /search?unspsc=25101611&department=Lima&deadline_from=2025-09-01
GET /tenders/ocds-xxxx-1234567890
```

---

## Aplicación web

### Funciones clave

* **Búsqueda** por texto y por UNSPSC (autocomplete jerárquico).
* **Filtros**: plazo, entidad, ubicación, modalidad, monto.
* **Resultados**: cards con título, entidad, monto (PEN), deadline, UNSPSC, badges de modalidad, links a documentos.
* **Detalle**: pestañas para Items/Lotes, Documentos, Historial.
* **Alertas**: guardar búsqueda y frecuencia.

### Tech stack sugerido

* **Frontend**: Next.js (App Router) + Tailwind + shadcn/ui.
* **Backend**: FastAPI / Node (NestJS) + SQLAlchemy/Prisma.
* **Auth**: OIDC (Auth0/Keycloak) si necesitas cuentas y alertas.

---

## Calidad de datos y reglas Perú

* **UNSPSC en `additionalClassifications`**: es tu fuente primaria de matching; guarda también la **clasificación base** (ej. CUBSO) como apoyo.
* **RUC**: buscar en `parties[].additionalIdentifiers[scheme=="PE-RUC"].id`.
* **Montos**: si existe `amount_PEN`, úsalo para ranking y filtros; si no, conviértelo externamente.
* **Award ↔ Contract**: reforzar vínculos por `awardID` y validación por montos/fechas/items.
* **Deduplicación**: `parties` y proveedores pueden venir duplicados/variantes; aplicar normalización.

---

## Monitoreo y operación

* **Jobs**: cron de ingesta incremental (cada 30 min) y reindex nocturno.
* **Métricas**:

  * Registros nuevos/actualizados por ventana.
  * % de items con UNSPSC presente.
  * Latencia de indexación.
  * Alertas enviadas y clics.
* **Logs**: estructura por `ocid`, `release_id`, `ingested_at`.
* **Backups**: snapshots de OpenSearch y dumps de Postgres.

---

## Roadmap

* Mapeo CUBSO ↔ UNSPSC para mejorar recall cuando falte UNSPSC.
* Detalle por **lote** en resultados (cuando existan `tender.lots`).
* Enriquecimiento con **PAC** y análisis de demanda futura.
* Clasificador ML para sugerir UNSPSC desde texto de ítems.
* Envío de alertas multi‑canal (email, WhatsApp, webhook).

---

## Contribuir

¡PRs y issues bienvenidos! Por favor sigue el estándar Conventional Commits y adjunta muestras de `records` anonimizadas cuando reportes bugs de parsing.

### Estándares de código

* Python 3.11+, Ruff + Black.
* Tests con Pytest, cobertura >80%.
* Migraciones con Alembic.

---

## Licencia

MIT. Ver `LICENSE`.
