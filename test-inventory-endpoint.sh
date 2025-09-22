#!/bin/bash

# Test del endpoint /api/products/by-inventory-ids

# URL base de la función de Google Cloud
BASE_URL="https://us-central1-your-project.cloudfunctions.net/meli"

# URL local para pruebas (si tienes servidor corriendo localmente)
# BASE_URL="http://localhost:3000"

echo "Probando endpoint de consulta de productos por inventoryIds..."

# Ejemplo con un solo inventoryId
echo -e "\n1. Prueba con un inventoryId:"
curl -X POST "$BASE_URL/api/products/by-inventory-ids" \
  -H "Content-Type: application/json" \
  -d '{
    "inventoryIds": ["GJWQ88312"]
  }'

# Ejemplo con múltiples inventoryIds
echo -e "\n\n2. Prueba con múltiples inventoryIds:"
curl -X POST "$BASE_URL/api/products/by-inventory-ids" \
  -H "Content-Type: application/json" \
  -d '{
    "inventoryIds": ["GJWQ88312", "GJWQ88313", "GJWQ88314"]
  }'

# Ejemplo con el máximo de 20 inventoryIds
echo -e "\n\n3. Prueba con 20 inventoryIds (máximo permitido):"
curl -X POST "$BASE_URL/api/products/by-inventory-ids" \
  -H "Content-Type: application/json" \
  -d '{
    "inventoryIds": [
      "GJWQ88312", "GJWQ88313", "GJWQ88314", "GJWQ88315", "GJWQ88316",
      "GJWQ88317", "GJWQ88318", "GJWQ88319", "GJWQ88320", "GJWQ88321",
      "GJWQ88322", "GJWQ88323", "GJWQ88324", "GJWQ88325", "GJWQ88326",
      "GJWQ88327", "GJWQ88328", "GJWQ88329", "GJWQ88330", "GJWQ88331"
    ]
  }'

# Prueba de validación: más de 20 IDs (debe devolver error)
echo -e "\n\n4. Prueba con más de 20 inventoryIds (debe devolver error):"
curl -X POST "$BASE_URL/api/products/by-inventory-ids" \
  -H "Content-Type: application/json" \
  -d '{
    "inventoryIds": [
      "ID1", "ID2", "ID3", "ID4", "ID5", "ID6", "ID7", "ID8", "ID9", "ID10",
      "ID11", "ID12", "ID13", "ID14", "ID15", "ID16", "ID17", "ID18", "ID19", "ID20",
      "ID21"
    ]
  }'

echo -e "\n"