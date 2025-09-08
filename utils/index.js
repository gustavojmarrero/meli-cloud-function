// Función para loguear en Google Cloud Logging
async function logToCloud(message, severity = 'INFO') {
    const log = logging.log('meli-api-log');
    const metadata = {
        resource: { type: 'cloud_function' },
        severity: severity,
    };
    const entry = log.entry(metadata, message);
    await log.write(entry);
}


const retryOnFail = async (
    func,
    maxRetries = 5,
    initialDelay = 20000
) => {
    let delay = initialDelay;

    for (let i = 0; i < maxRetries; i++) {
        console.log(`Retrying ${i + 1} of ${maxRetries}...`);
        const result = await func();

        if (result.success) {
            return result;
        } else if (result.error === 'Too many requests' || result.error === 'too_many_requests') {
            console.log('Received 429 Too Many Requests, waiting before retrying...');
            await new Promise((res) => setTimeout(res, delay));
            delay *= 2; // Incrementa el retraso exponencialmente
        } else {
            console.error(`Error in retryOnFail: ${result.error}`);
            if (i === maxRetries - 1) throw new Error(result.error);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
};



module.exports = { retryOnFail, logToCloud };