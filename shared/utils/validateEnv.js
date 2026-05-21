/**
 * Environment Variable Validation
 * Validates required environment variables at application startup
 */

const requiredEnvVars = {
  // General
  NODE_ENV: ["development", "staging", "production"],
  LOG_LEVEL: ["debug", "info", "warn", "error"],
};

const serviceEnvVars = {
  "api-gateway": {
    PORT: "number",
    API_GATEWAY_PORT: "number",
    JWT_SECRET: "string:min:32",
    CORS_ORIGIN: "string",
  },
  "user-service": {
    PORT: "number",
    DB_HOST: "string",
    DB_PORT: "number",
    DB_USER: "string",
    DB_PASSWORD: "string",
    DB_NAME: "string",
    JWT_SECRET: "string:min:32",
    BCRYPT_ROUNDS: "number",
  },
  "order-service": {
    PORT: "number",
    DB_HOST: "string",
    DB_PORT: "number",
    EVENT_BUS_HOST: "string",
  },
  "product-service": {
    PORT: "number",
    DB_HOST: "string",
    DB_PORT: "number",
    CACHE_TTL: "number",
  },
  "payment-service": {
    PORT: "number",
    STRIPE_API_KEY: "string",
    STRIPE_WEBHOOK_SECRET: "string",
    ENCRYPT_PAYMENT_DATA: "boolean",
  },
  "notification-service": {
    PORT: "number",
    EMAIL_HOST: "string",
    EMAIL_PORT: "number",
  },
};

/**
 * Validates environment variables
 * @param {string} serviceName - Name of the service
 * @param {Object} env - Environment variables object
 * @throws {Error} If required variables are missing or invalid
 */
function validateEnv(serviceName, env = process.env) {
  const errors = [];

  // Check general required variables
  Object.entries(requiredEnvVars).forEach(([key, allowedValues]) => {
    if (!env[key]) {
      errors.push(`Missing required environment variable: ${key}`);
    } else if (
      Array.isArray(allowedValues) &&
      !allowedValues.includes(env[key])
    ) {
      errors.push(
        `Invalid value for ${key}. Expected one of: ${allowedValues.join(", ")}, got: ${env[key]}`,
      );
    }
  });

  // Check service-specific variables
  if (serviceName && serviceEnvVars[serviceName]) {
    Object.entries(serviceEnvVars[serviceName]).forEach(([key, type]) => {
      if (!env[key]) {
        errors.push(
          `Missing required environment variable for ${serviceName}: ${key}`,
        );
      } else {
        validateEnvType(key, env[key], type, errors);
      }
    });
  }

  if (errors.length > 0) {
    console.error("Environment validation failed:");
    errors.forEach((error) => console.error(`  ❌ ${error}`));
    throw new Error(
      `Environment validation failed with ${errors.length} error(s)`,
    );
  }

  console.log("✅ Environment variables validated successfully");
}

/**
 * Validates environment variable type
 * @param {string} key - Variable name
 * @param {*} value - Variable value
 * @param {string} type - Expected type (number, string, boolean, string:min:length)
 * @param {Array} errors - Array to collect errors
 */
function validateEnvType(key, value, type, errors) {
  if (type === "number") {
    if (isNaN(value)) {
      errors.push(`${key} must be a number, got: ${value}`);
    }
  } else if (type === "boolean") {
    if (!["true", "false", true, false].includes(value)) {
      errors.push(`${key} must be a boolean, got: ${value}`);
    }
  } else if (type.startsWith("string:min:")) {
    const minLength = parseInt(type.split(":")[2]);
    if (typeof value !== "string" || value.length < minLength) {
      errors.push(`${key} must be a string with minimum length ${minLength}`);
    }
  } else if (type === "string") {
    if (typeof value !== "string") {
      errors.push(`${key} must be a string`);
    }
  }
}

module.exports = {
  validateEnv,
  requiredEnvVars,
  serviceEnvVars,
};
