require('dotenv').config();
const mongoose = require('mongoose');

// Conectar a MongoDB
const mongoURI = `${process.env.URI_BD_GUATEVER}?maxPoolSize=5`;

async function testNotification() {
  try {
    await mongoose.connect(mongoURI);
    console.log('Conectado a MongoDB');
    
    const Notification = require('./models/meliNotification');
    
    const notificationData = {
      application_id: 5769719673370618,
      attempts: 1,
      processed: false,
      received: new Date("2025-09-07T21:45:38.362Z"),
      resource: "/shipments/45472509999",
      sent: new Date("2025-09-07T20:45:38.431Z"),
      topic: "shipments",
      user_id: 397528431
    };
    
    console.log('Intentando guardar notificación:', notificationData);
    
    // Primero intentamos directamente con save
    try {
      const newNotification = new Notification(notificationData);
      const saved = await newNotification.save();
      console.log('Notificación guardada con save():', saved);
    } catch (saveError) {
      console.error('Error con save():', saveError.message);
      console.error('Detalle del error:', saveError);
    }
    
    // Ahora intentamos con findOneAndUpdate como en el controlador
    try {
      const updated = await Notification.findOneAndUpdate(
        { _id: notificationData._id },
        notificationData,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log('Notificación guardada con findOneAndUpdate():', updated);
    } catch (updateError) {
      console.error('Error con findOneAndUpdate():', updateError.message);
      console.error('Detalle del error:', updateError);
    }
    
  } catch (error) {
    console.error('Error general:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Conexión cerrada');
  }
}

testNotification();