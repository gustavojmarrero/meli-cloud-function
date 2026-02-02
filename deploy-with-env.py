#!/usr/bin/env python3
"""
Script de despliegue para MercadoLibre Cloud Function con variables de entorno.
Este script lee las variables del archivo .env y las incluye en el despliegue.
"""

import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path

def load_env_file():
    """Carga las variables de entorno desde el archivo .env"""
    env_vars = {}
    env_file = Path('.env')

    if not env_file.exists():
        print("❌ Error: Archivo .env no encontrado")
        print("Por favor, crea un archivo .env con las variables necesarias")
        sys.exit(1)

    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env_vars[key.strip()] = value.strip()

    return env_vars

def validate_env_vars(env_vars):
    """Valida que las variables críticas estén presentes"""
    required_vars = ['GOOGLE_CREDENTIALS', 'URI_BD_GUATEVER', 'MELI_CLIENT_ID']

    for var in required_vars:
        if var not in env_vars:
            print(f"❌ Error: {var} no está definida en .env")
            sys.exit(1)

    # Validar que GOOGLE_CREDENTIALS sea un JSON válido
    try:
        json.loads(env_vars['GOOGLE_CREDENTIALS'])
    except json.JSONDecodeError as e:
        print(f"❌ Error: GOOGLE_CREDENTIALS no es un JSON válido: {e}")
        sys.exit(1)

    print("✅ Variables de entorno verificadas")

def create_yaml_env_file(env_vars):
    """Crea un archivo YAML temporal con las variables de entorno"""
    # Crear archivo temporal
    fd, temp_file = tempfile.mkstemp(suffix='.yaml', prefix='meli-env-')

    try:
        with os.fdopen(fd, 'w') as f:
            for key, value in env_vars.items():
                # Para GOOGLE_CREDENTIALS, asegurar que el JSON se preserve correctamente
                if key == 'GOOGLE_CREDENTIALS':
                    # Validar que es un JSON válido
                    json_obj = json.loads(value)
                    # Escribir como JSON string
                    f.write(f"{key}: '{value}'\n")
                else:
                    # Para otras variables, escapar comillas si las hay
                    escaped_value = value.replace("'", "''")
                    f.write(f"{key}: '{escaped_value}'\n")

        print(f"📝 Archivo de variables de entorno creado: {temp_file}")
        return temp_file
    except Exception as e:
        os.unlink(temp_file)
        raise e

def deploy_function(env_file):
    """Despliega la función a Google Cloud Functions"""
    print("🔄 Desplegando función a Google Cloud Functions...")
    print("   Región: us-central1")
    print("   Runtime: nodejs22")

    cmd = [
        'gcloud', 'functions', 'deploy', 'meli',
        '--runtime', 'nodejs22',
        '--trigger-http',
        '--allow-unauthenticated',
        '--region', 'us-central1',
        '--env-vars-file', env_file,
        '--timeout', '540s',
        '--memory', '512MB'
    ]

    try:
        result = subprocess.run(cmd, capture_output=False, text=True)
        if result.returncode != 0:
            print("❌ Error en el despliegue")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Error ejecutando gcloud: {e}")
        sys.exit(1)

def verify_deployment():
    """Verifica que las variables estén configuradas correctamente"""
    print("\n📊 Verificando variables de entorno...")

    cmd = [
        'gcloud', 'functions', 'describe', 'meli',
        '--region', 'us-central1',
        '--format', 'json'
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            env_vars = data.get('serviceConfig', {}).get('environmentVariables', {})

            # Verificar variables críticas
            if 'GOOGLE_CREDENTIALS' in env_vars:
                # Verificar que GOOGLE_CREDENTIALS sea un JSON válido
                try:
                    json.loads(env_vars['GOOGLE_CREDENTIALS'])
                    print("✅ GOOGLE_CREDENTIALS está configurada correctamente")
                except:
                    print("⚠️  GOOGLE_CREDENTIALS está configurada pero no es JSON válido")
            else:
                print("❌ GOOGLE_CREDENTIALS NO está configurada")

            if 'URI_BD_GUATEVER' in env_vars:
                print("✅ URI_BD_GUATEVER está configurada")
            else:
                print("❌ URI_BD_GUATEVER NO está configurada")

            if 'MELI_CLIENT_ID' in env_vars:
                print("✅ MELI_CLIENT_ID está configurada")
            else:
                print("❌ MELI_CLIENT_ID NO está configurada")
    except Exception as e:
        print(f"⚠️  No se pudo verificar el despliegue: {e}")

def main():
    print("🚀 Iniciando despliegue de la función 'meli' a Google Cloud Functions...")

    # Verificar que gcloud está instalado
    try:
        subprocess.run(['gcloud', '--version'], capture_output=True, check=True)
    except:
        print("❌ Error: gcloud CLI no está instalado")
        print("Por favor, instala Google Cloud SDK primero")
        sys.exit(1)

    print("📖 Leyendo variables de entorno desde .env...")
    env_vars = load_env_file()

    validate_env_vars(env_vars)

    # Crear archivo YAML temporal
    env_file = create_yaml_env_file(env_vars)

    try:
        # Desplegar la función
        deploy_function(env_file)

        print("\n✅ Despliegue completado exitosamente!")

        # Verificar el despliegue
        verify_deployment()

        print("\n🔗 URL de la función:")
        print("https://us-central1-intranet-guatever.cloudfunctions.net/meli")
        print("\n📝 Endpoints disponibles:")
        print("  - POST /api/orders/export-sales   - Exportar ventas a Google Sheets")
        print("  - POST /api/orders/export-visits  - Exportar visitas a Google Sheets")
        print("  - POST /api/notifications         - Recibir notificaciones de MercadoLibre")
        print("  - POST /api/orders/process-pending - Procesar órdenes pendientes")
        print("\n🎉 ¡Despliegue completado!")

    finally:
        # Limpiar archivo temporal
        os.unlink(env_file)

if __name__ == "__main__":
    main()