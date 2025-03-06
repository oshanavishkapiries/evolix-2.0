const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

// Custom format for logs
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} | ${level.toUpperCase()} | ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) log += `\n${JSON.stringify(meta, null, 2)}`;
    return log;
  })
);

// Application logs configuration
const appTransport = new winston.transports.DailyRotateFile({
  filename: path.join(__dirname, '../logs/app/%DATE%-app.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: customFormat
});

// Utility logs configuration
const utilityTransport = new winston.transports.DailyRotateFile({
  filename: path.join(__dirname, '../logs/utility/%DATE%-utility.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: customFormat
});

// Error logs configuration
const errorTransport = new winston.transports.DailyRotateFile({
  filename: path.join(__dirname, '../logs/app/%DATE%-error.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  level: 'error',
  format: customFormat
});

// Console transport for development
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  )
});

// Create loggers
const appLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [appTransport, errorTransport]
});

const utilityLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [utilityTransport, errorTransport]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  appLogger.add(consoleTransport);
  utilityLogger.add(consoleTransport);
}

// Helper functions for different log levels
const logger = {
  // Application logging
  app: {
    error: (message, meta = {}) => appLogger.error(message, meta),
    warn: (message, meta = {}) => appLogger.warn(message, meta),
    info: (message, meta = {}) => appLogger.info(message, meta),
    debug: (message, meta = {}) => appLogger.debug(message, meta),
    http: (message, meta = {}) => appLogger.http(message, meta)
  },
  // Utility logging
  utility: {
    error: (message, meta = {}) => utilityLogger.error(message, meta),
    warn: (message, meta = {}) => utilityLogger.warn(message, meta),
    info: (message, meta = {}) => utilityLogger.info(message, meta),
    debug: (message, meta = {}) => utilityLogger.debug(message, meta),
    http: (message, meta = {}) => utilityLogger.http(message, meta)
  }
};

module.exports = logger; 