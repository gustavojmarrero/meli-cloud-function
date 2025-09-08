// config/logger.js
const { createLogger, transports, format } = require('winston');

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
    ),
    transports: [
        new transports.Console(),
        new transports.File({ filename: 'app.log' })
    ],
});

module.exports = logger;