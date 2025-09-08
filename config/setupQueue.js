// config/setupQueque.js
async function setupQueue() {
    const PQueue = (await import('p-queue')).default;
    const queue = new PQueue({ concurrency: 5, interval: 500, intervalCap: 5 });
    return queue;
}

module.exports = setupQueue;