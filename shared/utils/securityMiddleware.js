/**
 * Security Middleware
 * Applied to all Express applications for consistent security
 */

const securityConfig = require("./securityConfig");

/**
 * Security Headers Middleware
 */
const securityHeadersMiddleware = (req, res, next) => {
  Object.entries(securityConfig.securityHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  next();
};

/**
 * Sensitive Data Masking Middleware
 * Masks sensitive fields in logs
 */
const maskSensitiveData = (data) => {
  if (!data || typeof data !== "object") {
    return data;
  }

  const masked = Array.isArray(data) ? [...data] : { ...data };
  const { sensitiveFields } = securityConfig;

  const maskValue = (obj) => {
    Object.keys(obj).forEach((key) => {
      const lowerKey = key.toLowerCase();
      if (sensitiveFields.some((field) => lowerKey.includes(field))) {
        obj[key] = "***MASKED***";
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        maskValue(obj[key]);
      }
    });
  };

  maskValue(masked);
  return masked;
};

/**
 * Request Logging Middleware
 * Logs requests with sensitive data masked
 */
const requestLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();

  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - startTime;
    const status = res.statusCode;

    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    };

    if (req.body) {
      logData.requestBody = maskSensitiveData(req.body);
    }

    if (status >= 400) {
      console.error("[ERROR]", JSON.stringify(logData));
    } else {
      console.log("[INFO]", JSON.stringify(logData));
    }

    return originalSend.call(this, data);
  };

  next();
};

/**
 * Error Handler Middleware
 * Prevents leaking sensitive information in error responses
 */
const errorHandlerMiddleware = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";

  console.error("[ERROR]", {
    timestamp: new Date().toISOString(),
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.statusCode || 500;
  const errorResponse = {
    status: "error",
    statusCode,
    message: isProduction ? "Internal Server Error" : err.message,
  };

  if (!isProduction && err.stack) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * HTTPS Redirect Middleware
 * Enforces HTTPS in production
 */
const httpsRedirectMiddleware = (req, res, next) => {
  if (
    securityConfig.https.enforce &&
    req.get("x-forwarded-proto") !== "https"
  ) {
    return res.redirect(301, `https://${req.get("host")}${req.originalUrl}`);
  }
  next();
};

/**
 * API Key Validation Middleware
 */
const validateApiKeyMiddleware = (apiKeys) => {
  return (req, res, next) => {
    const apiKey =
      req.headers[securityConfig.apiKey.headerName.toLowerCase()] ||
      req.query[securityConfig.apiKey.queryParamName];

    if (!apiKey || !apiKeys.includes(apiKey)) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or missing API key",
      });
    }

    next();
  };
};

/**
 * Request Body Size Limit Middleware
 */
const requestSizeLimitMiddleware = {
  json: (req, res, next) => {
    if (
      req.headers["content-length"] >
      parseInt(securityConfig.contentSecurity.maxBodySize)
    ) {
      return res.status(413).json({
        status: "error",
        message: "Payload too large",
      });
    }
    next();
  },
};

module.exports = {
  securityHeadersMiddleware,
  maskSensitiveData,
  requestLoggingMiddleware,
  errorHandlerMiddleware,
  httpsRedirectMiddleware,
  validateApiKeyMiddleware,
  requestSizeLimitMiddleware,
};
