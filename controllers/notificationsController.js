// controllers/meliNotificationController.js
const Notification = require('../models/meliNotification');

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