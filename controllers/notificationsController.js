// controllers/meliNotificationController.js
const Notification = require('../models/meliNotification');

const receiveNotification = async (req, res) => {
  const notificationData = req.body;
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