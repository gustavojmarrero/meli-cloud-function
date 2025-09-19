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