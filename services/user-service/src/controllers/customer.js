import prisma from "../config/prisma.js";
import { fetchCached, invalidatePattern } from "@shop/event-bus";

// ==========================================
// ADMIN: GET ALL CUSTOMERS (PAGINATED, SEARCHED, CACHED)
// ==========================================
export const getCustomersList = async (req, res, next) => {
  try {
    // 1. Extract and sanitize query parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const { status, search } = req.query;

    // 2. Build a unique Redis cache key based on the exact query
    const cacheSuffix = `page_${page}:limit_${limit}:status_${status || "ALL"}:search_${search || "none"}`;

    // 3. Fetch from Cache or Execute DB Query
    const cachedResult = await fetchCached(
      "customers:admin", // Cache Prefix
      cacheSuffix, // Unique Suffix
      async () => {
        // --- Build Dynamic WHERE Clause ---
        const where = {
          role: "CUSTOMER", // Strictly only fetch customers
        };

        // Apply Status Filter
        if (status && status !== "ALL") {
          where.status = status;
        }

        // Apply Search Filter (Mobile, Email, or Name)
        if (search && search.trim() !== "") {
          const searchTerm = search.trim();

          where.OR = [
            { email: { contains: searchTerm, mode: "insensitive" } },
            // If they search digits, strip formatting to match raw mobile in DB
            { mobile: { contains: searchTerm.replace(/\D/g, "") } },
            // Search inside the related CustomerProfile model for the Name
            {
              customerProfile: {
                fullName: { contains: searchTerm, mode: "insensitive" },
              },
            },
          ];
        }

        // --- Execute Queries in Parallel ---
        // We need both the rows (for this page) and the total count (for pagination math)
        const [users, total] = await Promise.all([
          prisma.user.findMany({
            where,
            skip,
            take: limit,
            select: {
              id: true,
              mobile: true,
              email: true,
              createdAt: true,
              status: true,
              customerProfile: {
                select: {
                  fullName: true,
                  profilePhoto: true,
                  totalOrders: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
          prisma.user.count({ where }),
        ]);

        return { users, total };
      },
      300,
    );

    const { users, total } = cachedResult;

    // 4. Flatten and Format the data for the Frontend Table
    const formattedCustomers = users.map((user) => ({
      id: user.id,
      mobile: user.mobile,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      name: user.customerProfile?.fullName || "Имя не указано",
      profilePhoto: user.customerProfile?.profilePhoto || null,
      totalOrders: user.customerProfile?.totalOrders || 0,
    }));

    // 5. Return the Standardized Paginated Response
    res.status(200).json({
      success: true,
      data: formattedCustomers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Customer Fetch Error]:", error);
    next(error);
  }
};

// ==========================================
// ADMIN: UPDATE CUSTOMER STATUS
// ==========================================
export const updateCustomerStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE", "BLOCKED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status provided" });
    }

    const updatedUser = await prisma.user.update({
      where: { id, role: "CUSTOMER" },
      data: { status },
    });

    // 🚨 IMPORTANT: Invalidate the Redis cache when a status changes!
    // Since we don't know exactly which pages this user appeared on,
    // the safest approach is to clear all cached customer lists.
    await invalidatePattern(`customers:admin:*`);

    res.status(200).json({
      success: true,
      message: `Customer status updated to ${status}`,
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update customer status error:", error);
    next(error);
  }
};
