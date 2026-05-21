import nodemailer from "nodemailer";
import { logger } from "@shop/utils";

// Create the transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * Sends an HTML email with optional attachments
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML string of the email body
 * @param {Array} attachments - Optional array of file attachments
 */
export const sendEmail = async (to, subject, htmlContent, attachments = []) => {
  try {
    const mailOptions = {
      from: `"Online Shop" <${process.env.SMTP_EMAIL}>`,
      to,
      subject,
      html: htmlContent,
      // Only include attachments key if there are actual attachments
      ...(attachments.length > 0 && { attachments }),
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(
      `[Email] Sent successfully to ${to}. Message ID: ${info.messageId}`,
    );
    return true;
  } catch (error) {
    logger.error(`[Email Error] Failed to send email to ${to}:`, error.message);
    return false;
  }
};
