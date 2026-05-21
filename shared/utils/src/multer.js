import multer from "multer";

/**
 * Creates a secure Multer middleware using Memory Storage.
 * This keeps the file in RAM so it can be directly processed by Sharp
 * and streamed to MinIO/S3, preventing local disk I/O bottlenecks and security risks.
 * * @param {number} maxSizeMB - Maximum file size allowed in Megabytes (default: 5)
 * @returns {multer.Multer} - The configured multer instance
 */
export const createUploader = (maxSizeMB = 5) => {
  // 1. Use Memory Storage (Keeps file in RAM as a Buffer)
  const storage = multer.memoryStorage();

  // 2. Strict File Filter (Only allow specific image types for security)
  const fileFilter = (req, file, cb) => {
    // Only allow safe, standard web image formats
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      // Accept the file
      cb(null, true);
    } else {
      // Reject the file with a clear error message
      cb(
        new Error(
          "Invalid file type. Only JPEG, PNG, WEBP, and GIF are allowed.",
        ),
        false,
      );
    }
  };

  // 3. Set strict memory limits to prevent DoS (Denial of Service) attacks via massive file uploads
  const limits = {
    fileSize: maxSizeMB * 1024 * 1024, // Convert MB to Bytes
  };

  // Return the configured Multer instance
  return multer({
    storage,
    fileFilter,
    limits,
  });
};
