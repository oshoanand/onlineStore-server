import prisma from "../config/prisma.js";
import { optimizeAndUpload } from "@shop/utils";
import { invalidatePattern, fetchCached } from "@shop/event-bus/src/redis.js";

const CACHE_PREFIX = "productSvc:categories";

// ==========================================
// HELPER: TRANSLITERATE & SLUGIFY
// ==========================================
const generateSlug = (text) => {
  const cyrillicToLatinMap = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "yo",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };

  return text
    .toLowerCase()
    .split("")
    .map((char) => cyrillicToLatinMap[char] || char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-") // Replace spaces & special chars with hyphens
    .replace(/(^-|-$)/g, ""); // Remove leading/trailing hyphens
};

const buildCategoryTree = (categories, parentId = null) => {
  return categories
    .filter((category) => category.parentId === parentId)
    .map((category) => ({
      ...category,
      children: buildCategoryTree(categories, category.id),
    }));
};

// ==========================================
// PUBLIC: GET CATEGORY TREE
// ==========================================
export const getCategoryTree = async (req, res, next) => {
  try {
    const dbQuery = async () => {
      const flatCategories = await prisma.category.findMany({
        orderBy: { name: "asc" },
      });
      return buildCategoryTree(flatCategories);
    };

    const tree = await fetchCached(CACHE_PREFIX, "full_tree", dbQuery, 86400);
    res.status(200).json({ success: true, data: tree });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: GET ALL CATEGORIES (Flat Array)
// ==========================================
export const getAllAdminCategories = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
    });

    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: CREATE CATEGORY
// ==========================================
export const createCategory = async (req, res, next) => {
  try {
    let { name, slug, description, parentId } = req.body;

    // 🚨 FIX: Auto-generate the slug if the frontend didn't send one
    if (!slug && name) {
      slug = generateSlug(name);
    }

    // Validate Parent ID if provided
    if (parentId) {
      const parentExists = await prisma.category.findUnique({
        where: { id: parentId },
      });
      if (!parentExists) {
        return res
          .status(404)
          .json({ success: false, message: "Parent category not found" });
      }
    }

    // Handle optional category image
    let thumbUrl = null;
    if (req.file) {
      thumbUrl = await optimizeAndUpload(req.file, "categories", slug, 400);
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug, // Now guaranteed to exist
        description,
        parentId: parentId || null,
        thumbImage: thumbUrl,
      },
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    if (error.code === "P2002" && error.meta?.target?.includes("slug")) {
      return res
        .status(400)
        .json({ success: false, message: "Category slug must be unique" });
    }
    next(error);
  }
};

// ==========================================
// ADMIN: UPDATE CATEGORY
// ==========================================
export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { name, slug, description, parentId } = req.body;

    if (parentId === id) {
      return res.status(400).json({
        success: false,
        message: "A category cannot be its own parent",
      });
    }

    const existingCategory = await prisma.category.findUnique({
      where: { id },
    });

    if (!existingCategory) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    // 🚨 FIX: Auto-generate new slug if name is updated but slug isn't provided
    if (name && !slug) {
      slug = generateSlug(name);
    }

    let thumbUrl = existingCategory.thumbImage;
    if (req.file) {
      thumbUrl = await optimizeAndUpload(
        req.file,
        "categories",
        slug || existingCategory.slug,
        400,
      );
    }

    const updatedCategory = await prisma.category.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(slug && { slug }),
        ...(description !== undefined && { description }),
        ...(parentId !== undefined && { parentId: parentId || null }),
        thumbImage: thumbUrl,
      },
    });

    await invalidatePattern(`${CACHE_PREFIX}:*`);

    res.status(200).json({ success: true, data: updatedCategory });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: DELETE CATEGORY
// ==========================================
export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const childrenCount = await prisma.category.count({
      where: { parentId: id },
    });

    if (childrenCount > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete this category because it contains sub-categories. Reassign or delete them first.",
      });
    }

    await prisma.category.delete({ where: { id } });
    await invalidatePattern(`${CACHE_PREFIX}:*`);

    res
      .status(200)
      .json({ success: true, message: "Category deleted successfully" });
  } catch (error) {
    next(error);
  }
};
