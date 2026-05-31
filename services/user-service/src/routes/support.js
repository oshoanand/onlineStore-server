import express from "express";
import {
  getSupportTickets,
  createSupportTicket,
  deleteSupportTicket,
  updateSupportTicketStatus,
  updateSupportTicket,
  getSupportTicketById,
} from "../controllers/support.js";

import { createUploader } from "@shop/utils";
import { requireAdmin } from "../middlewares/authHeaders.js";

const router = express.Router();

// Initialize the uploader (memory storage, max 5MB)
const upload = createUploader(5);

router.post("/create/ticket", upload.single("attachment"), createSupportTicket);

router.use(requireAdmin);

router.get("/admin/all", getSupportTickets);
router.get("/ticket/:id", getSupportTicketById);
router.patch("/ticket/:id/status", updateSupportTicketStatus);
router.delete("/ticket/:id", deleteSupportTicket);
router.put("/ticket/:id", upload.single("attachment"), updateSupportTicket);

export default router;
