const errorHandler = (err, req, res, next) => {
  console.error("[Gateway Error]:", err.stack);
  res.status(500).json({
    error: "Internal Gateway Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
};

export default errorHandler;
