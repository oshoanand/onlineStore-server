import prisma from "../config/prisma.js";
import { optimizeAndUpload, BadRequestError, NotFoundError } from "@shop/utils";
import { invalidatePattern, fetchCached, publishEvent } from "@shop/event-bus";

// ==========================================
// HELPERS: ENUM MAPPERS
// ==========================================
const mapSupportType = (type) => {
  switch (type?.toUpperCase()) {
    case "BUG":
      return "BUG_REPORT";
    case "FEATURE":
      return "FEATURE_REQUEST";
    default:
      return "OTHER";
  }
};

const mapTicketStatus = (status) => {
  switch (status?.toUpperCase()) {
    case "PENDING":
    case "OPEN":
      return "OPEN";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "RESOLVED":
      return "RESOLVED";
    case "REJECTED":
    case "CLOSED":
      return "CLOSED";
    default:
      return "OPEN";
  }
};

// ==========================================
// 1. CREATE SUPPORT TICKET (User / Guest)
// ==========================================
export const createSupportTicket = async (req, res, next) => {
  try {
    // 🚨 FIX: Extracted subject from req.body
    const {
      subject = "Support Request",
      mobile,
      supportType,
      description,
    } = req.body;
    const userId = req.user?.id || null;

    if (!description) {
      throw new BadRequestError("Description is required to create a ticket.");
    }

    let attachments = [];
    if (req.file) {
      const fileUrl = await optimizeAndUpload(
        req.file,
        `support/tickets/images/${userId || "guest"}`,
        "ticket",
        1200,
      );
      if (fileUrl) attachments.push(fileUrl);
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        subject,
        description,
        type: mapSupportType(supportType),
        priority: "NORMAL",
        status: "OPEN",
        contactMobile: mobile || "Unknown",
        attachments,
        requesterId: userId,
      },
    });

    // Notify the Customer (if they are logged in)
    if (userId) {
      await publishEvent("stream:notifications", {
        eventType: "SUPPORT_TICKET_CREATED",
        userId: ticket.requesterId,
        ticketId: ticket.id,
      });
    }

    // Notify ALL Administrators
    await publishEvent("stream:notifications", {
      eventType: "SYSTEM",
      targetRole: "ADMINISTRATOR",
      title: "🎫 New Support Ticket",
      message: `A new ${ticket.type} ticket (#${ticket.id.split("-")[0]}) requires attention.`,
      link: `/admin/support/${ticket.id}`,
    });

    return res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. ADMIN: GET ALL TICKETS (Paginated)
// ==========================================
export const getSupportTickets = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 15);
    const skip = (page - 1) * limit;
    const { status, type } = req.query;

    const where = {};
    if (status && status !== "ALL") where.status = mapTicketStatus(status);
    if (type && type !== "ALL") where.type = mapSupportType(type);

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          requester: {
            select: { email: true, mobile: true },
          },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. ADMIN/USER: GET TICKET BY ID
// ==========================================
export const getSupportTicketById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        requester: { select: { email: true, mobile: true } },
      },
    });

    if (!ticket) throw new NotFoundError("Support ticket not found");

    res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. ADMIN: UPDATE TICKET STATUS (Triggers Resolution Event)
// ==========================================
export const updateSupportTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) throw new BadRequestError("Status is required");

    const newStatus = mapTicketStatus(status);

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: { status: newStatus },
    });

    // 🚨 Notify user if their ticket was resolved/closed
    if (
      (newStatus === "RESOLVED" || newStatus === "CLOSED") &&
      ticket.requesterId
    ) {
      await publishEvent("stream:notifications", {
        eventType: "SUPPORT_TICKET_RESOLVED",
        userId: ticket.requesterId,
        ticketId: ticket.id,
      });
    }

    res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 5. ADMIN: UPDATE TICKET DETAILS
// ==========================================
export const updateSupportTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subject, description, priority } = req.body;

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: {
        ...(subject && { subject }),
        ...(description && { description }),
        ...(priority && { priority }),
      },
    });

    res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 6. ADMIN: DELETE TICKET
// ==========================================
export const deleteSupportTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.supportTicket.delete({ where: { id } });

    res
      .status(200)
      .json({ success: true, message: "Ticket deleted successfully" });
  } catch (error) {
    next(error);
  }
};
