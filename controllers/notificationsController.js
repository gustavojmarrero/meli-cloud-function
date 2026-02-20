// controllers/meliNotificationController.js
const Notification = require('../models/meliNotification');

const INVENTORY_APP_URL = process.env.INVENTORY_APP_URL || 'https://inventory-app-f52ryed3da-uc.a.run.app';
const INVENTORY_API_KEY = process.env.INVENTORY_API_KEY || '';

/**
 * Reenvía notificaciones stock-locations al backend de inventario.
 * Extrae el userProductId del resource y llama a sync-fbm-product
 * para que MeLi refleje el stock correcto tras ventas y cambios.
 * Fire-and-forget: no bloquea la respuesta al webhook de MeLi.
 */
function forwardStockLocationToInventory(resource) {
  if (!INVENTORY_API_KEY) {
    console.warn('stock-locations: INVENTORY_API_KEY no configurada, no se reenvía');
    return;
  }

  // Resource format: /user-products/MLMU123456/stock
  const parts = resource.split('/');
  const idx = parts.indexOf('user-products');
  if (idx === -1 || !parts[idx + 1]) {
    console.warn(`stock-locations: no se pudo extraer userProductId de: ${resource}`);
    return;
  }
  const userProductId = parts[idx + 1];

  const url = `${INVENTORY_APP_URL}/api/inventory/sync-fbm-product-by-meli-id/${userProductId}`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': INVENTORY_API_KEY,
    },
    body: JSON.stringify({ source: 'meli-webhook-forward' }),
  })
    .then(res => console.log(`stock-locations forward ${userProductId}: ${res.status}`))
    .catch(err => console.error(`stock-locations forward ${userProductId} error: ${err.message}`));
}

const receiveNotification = async (req, res) => {
  const notificationData = req.body;

  // Si no hay _id, generamos uno basado en resource y user_id
  if (!notificationData._id) {
    const resourceId = notificationData.resource?.split('/').pop() || '';
    const userId = notificationData.user_id || '';
    notificationData._id = `${notificationData.topic}_${resourceId}_${userId}_${Date.now()}`;
  }

  try {
    const updatedNotification = await Notification.findOneAndUpdate(
      { _id: notificationData._id }, // Solo usamos _id en el filtro
      notificationData,
      { upsert: true, new: true, setDefaultsOnInsert: true } // Añadimos setDefaultsOnInsert
    );

    if (!updatedNotification) {
      console.log('Notificación ya fue procesada, no se actualiza.');
      return res.status(200).json({ message: 'Notificación ya fue procesada, no se actualiza.' });
    }

    // Reenviar stock-locations al backend de inventario (fire-and-forget)
    if (notificationData.topic === 'stock-locations' && notificationData.resource) {
      forwardStockLocationToInventory(notificationData.resource);
    }

    console.log('Notificación guardada o actualizada correctamente');
    return res.status(200).json(updatedNotification);
  } catch (error) {
    console.error('Error al guardar o actualizar la notificación:', error);
    return res.status(500).json({ error: 'Error al guardar o actualizar la notificación' });
  }
};

module.exports = {
  receiveNotification
};