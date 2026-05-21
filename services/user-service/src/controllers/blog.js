import prisma from "../config/prisma.js";
import { fetchCached, invalidatePattern } from "@shop/event-bus";
// Import the MinIO image processor we built in the shared package
import { optimizeAndUpload } from "@shop/utils";

// ==========================================
// CONFIGURATION
// ==========================================
// Unique namespace for this microservice to prevent Redis key collisions
const CACHE_PREFIX = "userSvc:articles";

// ==========================================
// ARTICLES MANAGEMENT
// ==========================================

export const getArticleById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Note: No caching here because editors need real-time data to edit safely
    const article = await prisma.article.findUnique({
      where: { id },
    });

    if (!article) {
      const error = new Error("Article not found");
      error.statusCode = 404;
      throw error;
    }

    return res.status(200).json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
};

export const updateArticle = async (req, res, next) => {
  try {
    const { id } = req.params;
    // FormData sends snake_case keys based on your frontend component
    const {
      title,
      content,
      slug,
      media_url,
      media_type,
      meta_title,
      image_alt_text,
      meta_description,
      keywords,
      isActive,
    } = req.body;

    // 1. Handle Media: File Upload vs External URL
    let finalMediaUrl = media_url;

    // If a physical file was attached to the FormData
    if (req.file) {
      // Stream directly to MinIO, compress to webp, and limit width to 1200px
      finalMediaUrl = await optimizeAndUpload(
        req.file,
        "articles/covers", // Base folder in MinIO
        id, // Organize by article ID (or author ID)
        1200, // Max width
      );
    }

    // Convert isActive string "true"/"false" from FormData to a real boolean
    const isActiveBool = isActive === "true" || isActive === true;

    const updatedArticle = await prisma.article.update({
      where: { id },
      data: {
        title,
        content,
        slug,
        mediaUrl: finalMediaUrl, // Mapped to Prisma camelCase
        mediaType: media_type,
        metaTitle: meta_title,
        imageAltText: image_alt_text,
        metaDescription: meta_description,
        keywords,
        isActive: isActiveBool,
      },
    });

    // 🧹 INVALIDATE CACHE: Ensure the updated article appears on the frontend immediately
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    return res.status(200).json({
      success: true,
      message: "Article updated successfully",
      data: updatedArticle,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminArticles = async (req, res, next) => {
  try {
    // 1. Pagination Parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    // 2. Define the Database Query
    const dbQuery = async () => {
      // Use Promise.all to fetch data and total count concurrently for performance
      const [articles, totalCount] = await Promise.all([
        prisma.article.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            slug: true,
            isActive: true,
            createdAt: true,
            author: { select: { name: true } },
          },
        }),
        prisma.article.count(),
      ]);

      return {
        articles,
        meta: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    };

    // 3. Fetch from Redis Cache or Database
    const cacheKey = `page_${page}_limit_${limit}`;
    const result = await fetchCached(CACHE_PREFIX, cacheKey, dbQuery);

    return res.status(200).json({
      success: true,
      data: result.articles,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
};

export const createArticle = async (req, res, next) => {
  try {
    // FormData sends snake_case keys based on your frontend component
    const {
      title,
      content,
      slug,
      media_url,
      media_type,
      meta_title,
      image_alt_text,
      meta_description,
      keywords,
      isActive,
    } = req.body;

    const authorId = req.user.id;

    // 1. Handle Media: File Upload vs External URL
    let finalMediaUrl = media_url;

    if (req.file) {
      // Stream directly to MinIO, compress to webp, and limit width to 1200px
      finalMediaUrl = await optimizeAndUpload(
        req.file,
        "articles/covers",
        authorId,
        1200,
      );
    }

    const isActiveBool = isActive === "true" || isActive === true;

    const newArticle = await prisma.article.create({
      data: {
        title,
        content,
        slug,
        mediaUrl: finalMediaUrl, // Mapped to Prisma camelCase
        mediaType: media_type,
        metaTitle: meta_title,
        imageAltText: image_alt_text,
        metaDescription: meta_description,
        keywords,
        isActive: isActiveBool,
        authorId,
      },
    });

    // 🧹 INVALIDATE CACHE: New article alters pagination structure
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    return res.status(201).json({
      success: true,
      message: "Article created successfully",
      data: newArticle,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteArticle = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Because schema.prisma has onDelete: Cascade for ArticleComment and ArticleLike,
    // this single query safely cleans up everything related to the article.
    await prisma.article.delete({
      where: { id },
    });

    // 🧹 INVALIDATE CACHE: Deleted article alters pagination and totals
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    return res.status(200).json({
      success: true,
      message: "Article deleted successfully",
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

export const updateArticleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      const error = new Error("Invalid status format");
      error.statusCode = 400;
      throw error;
    }

    const updatedArticle = await prisma.article.update({
      where: { id },
      data: { isActive },
      select: { id: true, title: true, isActive: true }, // Return only what's needed
    });

    // 🧹 INVALIDATE CACHE: Status change needs to reflect on the lists immediately
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    return res.status(200).json({
      success: true,
      message: `Status updated to ${isActive ? "Published" : "Draft"}`,
      data: updatedArticle,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// COMMENTS MODERATION
// ==========================================

export const getPendingComments = async (req, res, next) => {
  try {
    const comments = await prisma.articleComment.findMany({
      where: { status: "pending" },
      include: {
        user: { select: { name: true, email: true } },
        article: { select: { title: true, slug: true } },
      },
      orderBy: { createdAt: "asc" }, // Oldest first for fair moderation queue
    });

    return res.status(200).json({
      success: true,
      data: comments,
    });
  } catch (error) {
    next(error);
  }
};

export const moderateComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["approved", "rejected"];
    if (!validStatuses.includes(status)) {
      const error = new Error(
        "Invalid status. Must be 'approved' or 'rejected'.",
      );
      error.statusCode = 400;
      throw error;
    }

    const updatedComment = await prisma.articleComment.update({
      where: { id },
      data: { status },
      include: {
        user: { select: { name: true } },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Comment from ${updatedComment.user?.name || "user"} was ${status === "approved" ? "approved" : "rejected"}`,
      data: updatedComment,
    });
  } catch (error) {
    next(error);
  }
};
