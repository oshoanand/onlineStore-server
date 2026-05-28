import prisma from "../config/prisma.js";
import { optimizeAndUpload } from "@shop/utils";
import { invalidatePattern, fetchCached } from "@shop/event-bus/src/redis.js"; // Ensure the path matches your event-bus export

const CACHE_PREFIX = "productSvc:products";

/**
 * Helper to safely parse JSON/Arrays from multipart/form-data strings
 * (Because arrays and objects arrive as strings in FormData)
 */
const parseFormDataField = (field) => {
  if (!field) return undefined;
  if (Array.isArray(field)) return field;
  try {
    return JSON.parse(field);
  } catch (e) {
    return field.split(",").map((i) => i.trim()); // Fallback for comma-separated strings
  }
};

// ==========================================
// PUBLIC: GET ALL PRODUCTS (Advanced Filtering & Search)
// ==========================================
export const getPublicProducts = async (req, res, next) => {
  try {
    // 1. SAFE PARSING & DoS PREVENTION
    // Strictly parse pagination. Cap the limit at 50 to prevent database exhaustion.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 12),
    );

    // Sanitize filter inputs
    const search = req.query.search?.trim() || "";
    const category = req.query.category?.trim() || "";
    const brand = req.query.brand?.trim() || "";
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
    const tags = req.query.tags?.trim() || "";
    const sort = req.query.sort || "newest";

    const skip = (page - 1) * limit;

    // 2. BUILD THE PRISMA QUERY EXACTLY
    const where = {
      isPublished: true,
      status: "ACTIVE",
    };

    // A. Robust Sentence/Multi-word Search
    if (search) {
      // Split sentence into words, removing extra spaces
      const searchTerms = search.split(/\s+/).filter(Boolean);

      if (searchTerms.length > 0) {
        // Enforce that ALL words must exist somewhere in the name or description
        where.AND = searchTerms.map((term) => ({
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    // B. Filters
    if (category) where.categories = { has: category };
    if (brand) where.brand = brand;
    if (tags) where.tags = { hasSome: tags.split(",") };

    // C. Price Range Filtering
    if (minPrice !== null || maxPrice !== null) {
      where.price = {};
      if (minPrice !== null && !isNaN(minPrice)) where.price.gte = minPrice;
      if (maxPrice !== null && !isNaN(maxPrice)) where.price.lte = maxPrice;
    }

    // 3. DETERMINISTIC SORTING
    let orderBy;
    switch (sort) {
      case "price_asc":
        orderBy = { price: "asc" };
        break;
      case "price_desc":
        orderBy = { price: "desc" };
        break;
      case "top_rated":
        orderBy = { averageRating: "desc" };
        break;
      case "newest":
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    // 4. THE DATABASE QUERY WRAPPER
    const dbQuery = async () => {
      const [products, totalCount] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          // Optimization: Only select fields needed for the storefront grid
          select: {
            id: true,
            name: true,
            slug: true,
            brand: true,
            price: true,
            discountedPrice: true,
            thumbImage: true,
            averageRating: true,
            reviewCount: true,
            inStock: true,
            tags: true,
          },
        }),
        prisma.product.count({ where }),
      ]);

      return {
        products,
        meta: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    };

    // 5. CACHE LAYER EXECUTION
    const safeSearchKey = search.replace(/\s+/g, "_"); // Replace spaces for clean Redis key
    const cacheKey = `public_list:p${page}_l${limit}_s${safeSearchKey}_c${category}_b${brand}_min${minPrice}_max${maxPrice}_t${tags}_srt${sort}`;

    // TTL is set to 3600 seconds (1 Hour).
    const result = await fetchCached(CACHE_PREFIX, cacheKey, dbQuery, 3600);

    return res.status(200).json({
      success: true,
      data: result.products,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// PUBLIC: GET BY SLUG (SEO Friendly)
// ==========================================
export const getPublicProductBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const dbQuery = async () =>
      prisma.product.findUnique({
        where: { slug, isPublished: true, status: "ACTIVE" },
      });

    const product = await fetchCached(
      CACHE_PREFIX,
      `public_slug:${slug}`,
      dbQuery,
      3600,
    );

    if (!product) {
      const error = new Error("Product not found or unavailable");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// PUBLIC: CROSS-SELLING / RELATED PRODUCTS
// ==========================================
export const getRelatedProducts = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find the source product to match its categories
    const sourceProduct = await prisma.product.findUnique({
      where: { id },
      select: { categories: true },
    });

    if (!sourceProduct) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const dbQuery = async () =>
      prisma.product.findMany({
        where: {
          isPublished: true,
          status: "ACTIVE",
          id: { not: id }, // Exclude current product
          categories: { hasSome: sourceProduct.categories }, // Match at least one category
        },
        take: 8, // Amazon usually shows ~8 related items
        orderBy: { averageRating: "desc" },
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          discountedPrice: true,
          thumbImage: true,
          averageRating: true,
          reviewCount: true,
        },
      });

    const related = await fetchCached(
      CACHE_PREFIX,
      `related:${id}`,
      dbQuery,
      7200,
    );

    res.status(200).json({ success: true, data: related });
  } catch (error) {
    next(error);
  }
};

// ==========================================
//  PUBLIC HOMEPAGE GROUPED PRODUCTS
// ==========================================
// Fetches multiple lists of products grouped by tags in a single API call.
// Example: ?tags=Bestseller,New,Sale
export const getGroupedProducts = async (req, res, next) => {
  try {
    // Default tags to fetch if none are specified
    const requestedTags = req.query.tags
      ? req.query.tags.split(",")
      : ["Bestseller", "New", "Sale"];

    const dbQuery = async () => {
      const results = {};

      // Fetch all requested tag groups in parallel for maximum speed
      await Promise.all(
        requestedTags.map(async (tag) => {
          const cleanTag = tag.trim();

          const products = await prisma.product.findMany({
            where: {
              isPublished: true,
              status: "ACTIVE",
              tags: { has: cleanTag }, // Matches the specific tag inside the String[] array
            },
            take: 8, // Ideal number for a horizontal scrolling carousel
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              name: true,
              slug: true,
              brand: true,
              price: true,
              discountedPrice: true,
              thumbImage: true,
              averageRating: true,
              reviewCount: true,
              tags: true,
            },
          });

          results[cleanTag] = products;
        }),
      );

      return results;
    };

    const cacheKey = `grouped_tags:${requestedTags.join("_")}`;
    const groupedData = await fetchCached(
      CACHE_PREFIX,
      cacheKey,
      dbQuery,
      3600,
    );

    res.status(200).json({ success: true, data: groupedData });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: CREATE PRODUCT
// ==========================================

export const createProduct = async (req, res, next) => {
  try {
    const {
      name,
      slug,
      sku,
      brand,
      description,
      detailedDescription,
      price,
      discountedPrice,
      inStock,
      status,
      isPublished,
      weight,
      dimensions,
      color,
      categoryId,
      subCategoryId,
      metaTitle,
      metaDescription,
      keywords,
      tags,
    } = req.body;

    // 1. Prepare Category Connections (Prisma Many-to-Many Syntax)
    const categoryConnect = [];
    if (categoryId) categoryConnect.push({ id: categoryId });
    if (subCategoryId && subCategoryId !== "none")
      categoryConnect.push({ id: subCategoryId });

    // Safely parse tags string into an array
    const parsedTags = parseFormDataField(tags) || [];

    // ==========================================
    // 🚨 NEW: SEO AUTO-GENERATION LOGIC
    // ==========================================
    let finalMetaTitle = metaTitle;
    let finalMetaDescription = metaDescription;
    let finalKeywords = keywords;

    if (!finalMetaTitle) {
      finalMetaTitle = name;
    }

    if (!finalMetaDescription) {
      // SEO best practice: keep description around 160 characters
      finalMetaDescription = description ? description.substring(0, 160) : name;
    }

    if (!finalKeywords && name && description) {
      // Combine name and description, lowercase, remove punctuation (supports English & Russian)
      const cleanText = `${name} ${description}`
        .toLowerCase()
        .replace(/<[^>]*>?/gm, " ") // Strip any HTML tags if present
        .replace(/[^\w\sа-яА-ЯёЁ]/gi, " "); // Remove punctuation

      const wordsArray = cleanText.split(/\s+/);

      // Common stop words to ignore
      const stopWords = new Set([
        "and",
        "the",
        "for",
        "with",
        "in",
        "of",
        "to",
        "is",
        "on",
        "и",
        "в",
        "во",
        "на",
        "с",
        "по",
        "для",
        "от",
        "или",
      ]);

      // Filter out stop words and short words
      const validWords = wordsArray.filter(
        (w) => w.length > 2 && !stopWords.has(w),
      );

      // Get unique words and take up to 8 of them for keywords
      const uniqueWords = [...new Set(validWords)];
      finalKeywords = uniqueWords.slice(0, 8).join(", ");
    }

    // 2. Handle Images
    let thumbUrl = null;
    let imagesUrls = [];
    if (req.files?.thumbImage)
      thumbUrl = await optimizeAndUpload(
        req.files.thumbImage[0],
        "products/thumbs",
        slug,
        800,
      );
    if (req.files?.imageArray)
      imagesUrls = await Promise.all(
        req.files.imageArray.map((f) =>
          optimizeAndUpload(f, "products/gallery", slug, 1200),
        ),
      );

    // 3. Save to DB
    const product = await prisma.product.create({
      data: {
        name,
        slug,
        sku,
        brand,
        description,
        detailedDescription,
        price: parseFloat(price),
        discountedPrice: discountedPrice ? parseFloat(discountedPrice) : null,
        inStock: parseInt(inStock || "0", 10),
        status,
        isPublished: isPublished === "true" || isPublished === true,
        weight,
        dimensions,
        color,
        // Apply the computed SEO fields here
        metaTitle: finalMetaTitle,
        metaDescription: finalMetaDescription,
        keywords: finalKeywords,
        thumbImage: thumbUrl,
        imageArray: imagesUrls,
        tags: parsedTags,
        categories: {
          connect: categoryConnect,
        },
      },
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};
// ==========================================
// ADMIN: UPDATE PRODUCT
// ==========================================
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Destructure out the relations, images, tags, and explicitly grab SEO/Text fields
    const {
      categoryId,
      subCategoryId,
      existingImages,
      tags,
      metaTitle,
      metaDescription,
      keywords,
      name,
      description,
      ...restUpdateData
    } = req.body;

    // 1. Fetch the existing product to handle image fallbacks, slugs, and SEO generation
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      const error = new Error("Product not found");
      error.statusCode = 404;
      throw error;
    }

    const slugToUse = restUpdateData.slug || existingProduct.slug;

    // ==========================================
    // 🚨 NEW: SEO AUTO-GENERATION LOGIC (UPDATE)
    // ==========================================
    // Determine the effective text values (use updated ones if provided, else existing)
    const effectiveName = name !== undefined ? name : existingProduct.name;
    const effectiveDescription =
      description !== undefined ? description : existingProduct.description;

    // Determine the effective SEO values
    let finalMetaTitle =
      metaTitle !== undefined ? metaTitle : existingProduct.metaTitle;
    let finalMetaDescription =
      metaDescription !== undefined
        ? metaDescription
        : existingProduct.metaDescription;
    let finalKeywords =
      keywords !== undefined ? keywords : existingProduct.keywords;

    // Auto-generate if empty or cleared by the user
    if (!finalMetaTitle) {
      finalMetaTitle = effectiveName;
    }

    if (!finalMetaDescription) {
      finalMetaDescription = effectiveDescription
        ? effectiveDescription.substring(0, 160)
        : effectiveName;
    }

    if (!finalKeywords && effectiveName && effectiveDescription) {
      const cleanText = `${effectiveName} ${effectiveDescription}`
        .toLowerCase()
        .replace(/<[^>]*>?/gm, " ")
        .replace(/[^\w\sа-яА-ЯёЁ]/gi, " ");

      const wordsArray = cleanText.split(/\s+/);
      const stopWords = new Set([
        "and",
        "the",
        "for",
        "with",
        "in",
        "of",
        "to",
        "is",
        "on",
        "и",
        "в",
        "во",
        "на",
        "с",
        "по",
        "для",
        "от",
        "или",
      ]);

      const validWords = wordsArray.filter(
        (w) => w.length > 2 && !stopWords.has(w),
      );
      const uniqueWords = [...new Set(validWords)];

      finalKeywords = uniqueWords.slice(0, 8).join(", ");
    }

    // 2. Handle Images
    let thumbUrl = existingProduct.thumbImage;

    // Parse the kept existing images from the extracted variable
    let imagesUrls = existingProduct.imageArray;
    if (existingImages !== undefined) {
      imagesUrls = parseFormDataField(existingImages) || [];
    }

    if (req.files?.thumbImage) {
      thumbUrl = await optimizeAndUpload(
        req.files.thumbImage[0],
        "products/thumbs",
        slugToUse,
        800,
      );
    }

    // If new images are uploaded, add them to the surviving existing images
    if (req.files?.imageArray) {
      const newImageUrls = await Promise.all(
        req.files.imageArray.map((f) =>
          optimizeAndUpload(f, "products/gallery", slugToUse, 1200),
        ),
      );
      imagesUrls = [...imagesUrls, ...newImageUrls];
    }

    // 3. Build the new connection list for Categories
    const categoryConnect = [];
    if (categoryId) categoryConnect.push({ id: categoryId });
    if (
      subCategoryId &&
      subCategoryId !== "none" &&
      subCategoryId !== "undefined"
    ) {
      categoryConnect.push({ id: subCategoryId });
    }

    let updatedTags = undefined;
    if (tags !== undefined) {
      updatedTags = parseFormDataField(tags) || [];
    }

    // 4. Update the Database
    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        ...restUpdateData,
        name, // Pass name back into update payload
        description, // Pass description back into update payload

        // Apply computed SEO fields
        metaTitle: finalMetaTitle,
        metaDescription: finalMetaDescription,
        keywords: finalKeywords,

        price: restUpdateData.price
          ? parseFloat(restUpdateData.price)
          : undefined,
        discountedPrice: restUpdateData.discountedPrice
          ? parseFloat(restUpdateData.discountedPrice)
          : restUpdateData.discountedPrice === "" ||
              restUpdateData.discountedPrice === "null"
            ? null
            : undefined,
        inStock:
          restUpdateData.inStock !== undefined
            ? parseInt(restUpdateData.inStock, 10)
            : undefined,
        isPublished:
          restUpdateData.isPublished !== undefined
            ? restUpdateData.isPublished === "true" ||
              restUpdateData.isPublished === true
            : undefined,

        thumbImage: thumbUrl,
        imageArray: imagesUrls,
        tags: updatedTags,
        categories: {
          set: categoryConnect,
        },
      },
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);
    res.status(200).json({ success: true, data: updatedProduct });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: GET ALL PRODUCTS (Paginated)
// ==========================================

export const getAdminProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || "";
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

    const skip = (page - 1) * limit;

    // 1. Define allowed sort fields to prevent Prisma injection/validation errors
    const allowedSortFields = [
      "name",
      "price",
      "inStock",
      "createdAt",
      "updatedAt",
    ];
    const orderByField = allowedSortFields.includes(sortBy)
      ? sortBy
      : "createdAt";

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const dbQuery = async () => {
      const [products, totalCount] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limit,
          // 2. Safely structure the dynamic ordering
          orderBy: { [orderByField]: sortOrder },
          include: {
            categories: { select: { name: true } }, // Fetch category names for the frontend
          },
        }),
        prisma.product.count({ where }),
      ]);

      // 3. Transform the output to ensure categories is always an array of strings
      const sanitizedProducts = products.map((p) => ({
        ...p,
        categories: p.categories.map((c) => c.name),
      }));

      return {
        products: sanitizedProducts,
        meta: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    };

    const cacheKey = `admin_list:p${page}_l${limit}_s${search}_ob${orderByField}_${sortOrder}`;
    const result = await fetchCached(CACHE_PREFIX, cacheKey, dbQuery, 3600);

    return res.status(200).json({
      success: true,
      data: result.products,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: GET PRODUCT BY ID (No Cache for Editing)
// ==========================================

export const getProductById = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        categories: true,
      },
    });

    if (!product) {
      const error = new Error("Product not found");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};
// ==========================================
// ADMIN: LIGHTWEIGHT STATUS PATCH
// ==========================================
export const updateProductStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: { status },
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);

    res.status(200).json({
      success: true,
      message: `Product status updated to ${status}`,
      data: updatedProduct,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: DELETE PRODUCT
// ==========================================
export const deleteProduct = async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });

    // Clean up cache
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    res
      .status(200)
      .json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    next(error);
  }
};
