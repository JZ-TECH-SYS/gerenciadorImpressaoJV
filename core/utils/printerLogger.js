const baseLogger = require('./logger');

function withPrinterChannel(options = {}) {
  return {
    ...options,
    channel: 'printer'
  };
}

function log(message, options = {}) {
  baseLogger.log(message, withPrinterChannel(options));
}

function info(message, options = {}) {
  baseLogger.info(message, withPrinterChannel(options));
}

function warn(message, options = {}) {
  baseLogger.warn(message, withPrinterChannel(options));
}

function error(message, options = {}) {
  baseLogger.error(message, withPrinterChannel(options));
}

function debug(message, options = {}) {
  baseLogger.debug(message, withPrinterChannel(options));
}

module.exports = {
  log,
  info,
  warn,
  error,
  debug,
  logImpressao: baseLogger.logImpressao
};
