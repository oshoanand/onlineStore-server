import prisma from "../config/prisma.js";
import { fetchCached, invalidatePattern } from "@shop/event-bus";

const CACHE_PREFIX = "productSvc:shipping";

// ==========================================
// PUBLIC: CALCULATE SHIPPING COST
// ==========================================
export const calculateShippingCost = async (req, res, next) => {
  try {
    const { city, cartTotal } = req.body;
    console.log(
      "Calculating shipping cost for city:",
      city,
      "and cart total:",
      cartTotal,
    );
    const total = parseFloat(cartTotal) || 0;
    const searchCity = city ? city.trim().toLowerCase() : "";

    // 1. Fetch all zones (Cached in Redis for blazing fast calculations)
    const dbQuery = async () => prisma.shippingZone.findMany();
    const allZones = await fetchCached(
      CACHE_PREFIX,
      "all_zones",
      dbQuery,
      86400,
    ); // 24hr cache

    // 2. Find the matching zone, or fallback to default
    let matchingZone = allZones.find(
      (zone) => zone.cities && zone.cities.includes(searchCity),
    );

    if (!matchingZone) {
      matchingZone = allZones.find((zone) => zone.isDefault);
    }

    if (!matchingZone) {
      // Failsafe if admin hasn't set up shipping zones yet
      return res.status(200).json({
        success: true,
        data: {
          shippingCost: 0,
          isFreeShipping: true,
          message: "Standard Shipping",
        },
      });
    }

    const baseCost = parseFloat(matchingZone.baseCost);
    const threshold = matchingZone.freeShippingThreshold
      ? parseFloat(matchingZone.freeShippingThreshold)
      : null;

    // 3. Calculate Cost & Upsell Logic
    let finalCost = baseCost;
    let isFreeShipping = false;
    let amountToFreeShipping = null;

    if (threshold !== null) {
      if (total >= threshold) {
        finalCost = 0;
        isFreeShipping = true;
      } else {
        amountToFreeShipping = threshold - total;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        zoneName: matchingZone.name,
        shippingCost: finalCost,
        isFreeShipping,
        amountToFreeShipping, // UX Boost: "Add 200 RUB more for free shipping!"
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: GET ALL ZONES
// ==========================================
export const getShippingZones = async (req, res, next) => {
  try {
    const zones = await prisma.shippingZone.findMany({
      orderBy: { isDefault: "asc" }, // Show specific zones first, default last
    });
    res.status(200).json({ success: true, data: zones });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: CREATE ZONE
// ==========================================
export const createShippingZone = async (req, res, next) => {
  try {
    const { name, cities, baseCost, freeShippingThreshold, isDefault } =
      req.body;

    // If this new zone is marked as default, unset the old default
    if (isDefault) {
      await prisma.shippingZone.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const normalizedCities = Array.isArray(cities)
      ? cities.map((c) => c.trim().toLowerCase())
      : [];

    const zone = await prisma.shippingZone.create({
      data: {
        name,
        cities: normalizedCities,
        baseCost: parseFloat(baseCost),
        freeShippingThreshold: freeShippingThreshold
          ? parseFloat(freeShippingThreshold)
          : null,
        isDefault: isDefault || false,
      },
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);
    res.status(201).json({ success: true, data: zone });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: UPDATE ZONE
// ==========================================
export const updateShippingZone = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, cities, baseCost, freeShippingThreshold, isDefault } =
      req.body;

    // If changing to default, unset others
    if (isDefault) {
      await prisma.shippingZone.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const dataToUpdate = {
      ...(name && { name }),
      ...(baseCost !== undefined && { baseCost: parseFloat(baseCost) }),
      ...(freeShippingThreshold !== undefined && {
        freeShippingThreshold: freeShippingThreshold
          ? parseFloat(freeShippingThreshold)
          : null,
      }),
      ...(isDefault !== undefined && { isDefault }),
    };

    if (cities) {
      dataToUpdate.cities = Array.isArray(cities)
        ? cities.map((c) => c.trim().toLowerCase())
        : [];
    }

    const zone = await prisma.shippingZone.update({
      where: { id },
      data: dataToUpdate,
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);
    res.status(200).json({ success: true, data: zone });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: DELETE ZONE
// ==========================================
export const deleteShippingZone = async (req, res, next) => {
  try {
    const { id } = req.params;

    const zone = await prisma.shippingZone.findUnique({ where: { id } });
    if (zone?.isDefault) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete the default shipping zone. Set another zone as default first.",
      });
    }

    await prisma.shippingZone.delete({ where: { id } });
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    res.status(200).json({ success: true, message: "Shipping zone deleted" });
  } catch (error) {
    next(error);
  }
};
