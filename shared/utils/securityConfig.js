/**
 * Security Configuration
 * Centralized security settings for all services
 */

module.exports = {
  // CORS Configuration
  cors: {
    development: {
      origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
      credentials: true,
      optionsSuccessStatus: 200,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    },
    production: {
      origin: (process.env.CORS_ORIGIN || "").split(",").filter(Boolean),
      credentials: true,
      optionsSuccessStatus: 200,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    },
  },

  // Helmet Security Headers
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: "deny",
    },
    noSniff: true,
    xssFilter: true,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
  },

  // JWT Configuration
  jwt: {
    algorithm: "HS256",
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRATION || "24h",
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRATION || "7d",
  },

  // Password Security
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
  },

  // Session Configuration
  session: {
    secret: process.env.SESSION_SECRET,
    timeout: parseInt(process.env.SESSION_TIMEOUT) || 3600000, // 1 hour
    resave: false,
    saveUninitialized: false,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  },

  // Login Security
  login: {
    maxAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockTime: parseInt(process.env.LOCK_TIME) || 900000, // 15 minutes
  },

  // API Key Security
  apiKey: {
    headerName: "X-API-Key",
    queryParamName: "apiKey",
  },

  // HTTPS
  https: {
    enforce: process.env.NODE_ENV === "production",
  },

  // Content Security
  contentSecurity: {
    maxBodySize: "10mb",
    maxParameterSize: 100,
  },

  // Encryption
  encryption: {
    algorithm: process.env.ENCRYPTION_ALGORITHM || "aes-256-gcm",
    key: process.env.ENCRYPTION_KEY,
  },

  // Security Headers
  securityHeaders: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Content-Security-Policy": "default-src 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  },

  // Sensitive Data Masking
  sensitiveFields: [
    "password",
    "pin",
    "cvv",
    "cardNumber",
    "ssn",
    "apiKey",
    "secret",
    "token",
    "refreshToken",
    "accessToken",
  ],

  // Audit Logging
  audit: {
    enabled: true,
    logSuccessfulAuthentication: false,
    logFailedAuthentication: true,
    logSensitiveDataAccess: true,
  },
};
