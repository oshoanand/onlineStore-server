import { logger } from "@shop/utils";

export const getUserDeviceTokens = async (userId) => {
  try {
    // In production, secure this call using an internal API key or internal network routing
    const response = await fetch(
      `${process.env.USER_SERVICE_URL}/api/users/profile`,
      {
        headers: { "X-User-Id": userId, "X-User-Role": "internal" },
      },
    );

    if (!response.ok) return [];

    const { data } = await response.json();
    return data?.deviceTokens || [];
  } catch (error) {
    logger.error(
      `[Internal API Error] Failed to fetch tokens for ${userId}:`,
      error.message,
    );
    return [];
  }
};
