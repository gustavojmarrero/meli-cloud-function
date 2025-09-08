const { updateProductCosts } = require('./controllers/productsController');

(async () => {
    try {
        console.log('Iniciando actualización de costos...');
        await updateProductCosts();
        console.log('Actualización completada exitosamente.');
    } catch (error) {
        console.error('Error durante la actualización:', error);
    }
})(); 