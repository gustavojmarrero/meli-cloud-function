# CLAUDE.md - Documentación Crítica del Proyecto MercadoLibre Cloud Function

## ⚠️ IMPORTANTE: Variables de Entorno para Despliegue

### Problema Conocido
El archivo `.env` NO se sube a Google Cloud Functions porque está en `.gitignore`.
Esto causa que las variables de entorno se pierdan en cada despliegue, resultando en el error:
```
Error: "undefined" is not valid JSON
```

### Variables de Entorno Requeridas

Las siguientes variables DEBEN estar configuradas en Google Cloud Functions:

```bash
# Base de datos MongoDB
URI_BD_GUATEVER=[VER ARCHIVO .env LOCAL]

# MercadoLibre API
MELI_CLIENT_ID=[VER ARCHIVO .env LOCAL]
MELI_CLIENT_SECRET=[VER ARCHIVO .env LOCAL]
MELI_USER_ID=[VER ARCHIVO .env LOCAL]

# Google Service Account (CRÍTICO para exportación a Sheets)
GOOGLE_CREDENTIALS=[VER ARCHIVO .env LOCAL - NO SUBIR A REPOSITORIO PÚBLICO]

# Google Sheets IDs
SPREADSHEET_ID=[VER ARCHIVO .env LOCAL]
SHEET_RANGE=[VER ARCHIVO .env LOCAL]
DRIVE_FOLDER_ID=[VER ARCHIVO .env LOCAL]

# Análisis de Ganancias (Configuración opcional)
TOP_PROFIT_LIMIT=50  # Número de SKUs a incluir en ranking (default: 50)
PROFIT_ANALYSIS_DAYS=180  # Días de análisis para cálculo de ganancias (default: 180)
COST_ANALYSIS_DAYS=365  # Días de análisis para cálculo de costo medio (default: 365)
```

## 🚀 Comando de Despliegue Completo

### ⚠️ IMPORTANTE: USAR SOLO EL SCRIPT PYTHON
El script bash fue eliminado porque corrompía el formato JSON de las credenciales.

### Opción 1: Usar el script Python de despliegue (ÚNICO MÉTODO RECOMENDADO)
```bash
npm run deploy
# o directamente:
python3 deploy-with-env.py
```

### Opción 2: Comando manual con todas las variables (NO RECOMENDADO)
NO usar comandos manuales. El formato JSON es muy complejo para manejarlo manualmente.
Usar siempre el script Python que lee las variables desde .env local.

## 📝 Verificar Variables después del Despliegue

Para confirmar que las variables están configuradas:
```bash
gcloud functions describe meli --region=us-central1 --format="value(environmentVariables)"
```

## 🔧 Endpoints Afectados por Variables de Entorno

Los siguientes endpoints requieren `GOOGLE_CREDENTIALS` para funcionar:
- `POST /api/orders/export-sales` - Exporta ventas a Google Sheets
- `POST /api/orders/export-visits` - Exporta visitas de productos a Google Sheets
- `GET /api/reports/top-profit-skus` - Analiza y exporta TOP SKUs por ganancia a Google Sheets

## 📊 Endpoint de Análisis de Ganancias: `/api/reports/top-profit-skus`

### Descripción
Analiza las ganancias de productos específicos, calcula costos medios de compra y exporta los TOP performers a Google Sheets.

### Funcionamiento

1. **Lee SKUs y ASINs desde Google Sheets**
   - Documento: `1PKFCSNVsRR8wM6mOeckoJUYGqKrZ9oWrbvSf_7FHLD8`
   - Hoja: `Lista`
   - Rango: `B2:D` (SKUs en columna B, ASINs en columna D)

2. **Calcula costo modal por ASIN**
   - Consulta colección `controlDeCompras_d` en MongoDB
   - Filtra compras por ASIN de los últimos N días (configurable con `COST_ANALYSIS_DAYS`, default: 365)
   - Extrae campo `pDdescuento` (precio de compra con IVA)
   - Calcula la **moda** usando rangos dinámicos de ±5%:
     * Para cada precio, crea un rango [precio × 0.95, precio × 1.05]
     * Encuentra el rango con mayor cantidad de compras (cluster modal)
     * En caso de empate, usa el cluster con precio mínimo más bajo
     * Retorna el precio más bajo del cluster más frecuente
   - La moda representa el costo más común al que se compró el producto

3. **Analiza órdenes de los últimos N días**
   - Por defecto: últimos 180 días (configurable con `PROFIT_ANALYSIS_DAYS`)
   - Filtra órdenes con estado `paid`
   - Calcula ganancia por SKU usando la fórmula:
     ```
     ganancia = precioAcumulado - costoAcum - comisionVta - comisionEnvio
     ```
     Donde:
     - `precioAcumulado = (unit_price × quantity) / 1.16` (sin IVA)
     - `costoAcum = product_cost × quantity`
     - `comisionVta = (sale_fee × quantity) / 1.16` (sin IVA)
     - `comisionEnvio = shipping_cost / 1.16` (sin IVA)

4. **Genera ranking y exporta**
   - Ordena SKUs por ganancia total descendente
   - Filtra solo SKUs con ganancia > 0
   - Toma TOP N (configurable con `TOP_PROFIT_LIMIT`, default: 50)
   - Exporta a hoja `GananciaTop50`:
     - Columna A: SKU
     - Columna B: ASIN
     - Columna C: Ganancia total (formato 2 decimales)
     - Columna D: Costo Medio (mediana de compras, formato 2 decimales)

### Ejemplo de Uso
```bash
# Localmente
curl http://localhost:8080/api/reports/top-profit-skus

# En producción
curl https://us-central1-your-project.cloudfunctions.net/meli/api/reports/top-profit-skus
```

### Respuesta Exitosa
```json
{
  "message": "Exportación completada: TOP 50 SKUs exportados.",
  "totalSkusAnalizados": 887,
  "skusConGanancia": 50,
  "topSkus": [
    {
      "sku": "GM000873",
      "asin": "B09QVK6831",
      "ganancia": "145696.26",
      "costoMedio": "243.87"
    },
    {
      "sku": "GM001015",
      "asin": "B08XYZABC1",
      "ganancia": "74846.62",
      "costoMedio": "189.50"
    },
    ...
  ]
}
```

### Variables de Entorno
- `TOP_PROFIT_LIMIT`: Número máximo de SKUs en el ranking (default: 50)
- `PROFIT_ANALYSIS_DAYS`: Días hacia atrás para analizar ganancias (default: 180)
- `COST_ANALYSIS_DAYS`: Días hacia atrás para calcular costo medio (default: 365)

## 🐛 Solución de Problemas

### Error: "undefined" is not valid JSON
**Causa**: La variable `GOOGLE_CREDENTIALS` no está definida en la función.
**Solución**: Redesplegar con todas las variables usando el comando completo arriba.

### Error: Authentication failed
**Causa**: Las credenciales de Google no son válidas o están mal formateadas.
**Solución**: Verificar que el JSON de `GOOGLE_CREDENTIALS` esté bien escapado con `\n` en lugar de saltos de línea reales.

## 📋 Checklist de Despliegue

- [ ] Archivo `.env` local tiene todas las variables
- [ ] Usar script `deploy.sh` o comando completo con `--set-env-vars`
- [ ] Verificar variables con `gcloud functions describe`
- [ ] Probar endpoints de exportación después del despliegue
- [ ] NO confiar en que `.env` se subirá (está en .gitignore)

## 🔐 Seguridad

**IMPORTANTE**: Este archivo contiene credenciales sensibles.
- NO compartir públicamente
- NO subir a repositorios públicos
- Considerar migrar a Google Secret Manager en el futuro

## 📚 Archivos Relacionados

- `.env` - Variables locales (NO se sube a GCP)
- `.env.example` - Plantilla de variables sin valores
- `deploy.sh` - Script automatizado de despliegue
- `config/googleSheetsConfig.js` - Usa GOOGLE_CREDENTIALS
- `.gcloudignore` - Excluye .env del despliegue