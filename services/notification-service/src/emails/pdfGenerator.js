import PDFDocument from "pdfkit";

/**
 * Generates an Invoice PDF in memory and returns it as a Buffer
 * @param {Object} order - The complete order object
 * @param {Object} user - The user object
 * @returns {Promise<Buffer>}
 */
export const generateInvoicePdfBuffer = (order, user) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers = [];

      // Stream the PDF data into an array of buffers
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const orderIdShort = order.id.split("-")[0].toUpperCase();
      const invoiceDate = new Date(order.createdAt).toLocaleDateString();

      // --- 1. Header ---
      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("INVOICE", { align: "right" });
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Order ID: #${orderIdShort}`, { align: "right" });
      doc.text(`Date: ${invoiceDate}`, { align: "right" });
      doc.moveDown(2);

      // --- 2. Billing & Shipping Info ---
      const startY = doc.y;

      // Company Info (Left)
      doc.fontSize(12).font("Helvetica-Bold").text("From:", 50, startY);
      doc
        .fontSize(10)
        .font("Helvetica")
        .text("Online Shop")
        .text("Support: hello@onlineshop.com");

      // Customer Info (Right)
      doc.fontSize(12).font("Helvetica-Bold").text("Billed To:", 300, startY);
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(user.name || "Customer", 300, doc.y)
        .text(user.email, 300, doc.y)
        .text(order.shippingAddress.street, 300, doc.y)
        .text(
          `${order.shippingAddress.city}, ${order.shippingAddress.zip}`,
          300,
          doc.y,
        )
        .text(`Phone: ${order.shippingAddress.phone}`, 300, doc.y);

      doc.moveDown(3);

      // --- 3. Items Table Header ---
      const tableTop = doc.y;
      doc.font("Helvetica-Bold");
      doc.text("Item", 50, tableTop);
      doc.text("Quantity", 300, tableTop, { width: 90, align: "right" });
      doc.text("Unit Price", 400, tableTop, { width: 90, align: "right" });
      doc.text("Total", 500, tableTop, { width: 50, align: "right" });

      // Header line
      doc
        .moveTo(50, tableTop + 15)
        .lineTo(550, tableTop + 15)
        .stroke();

      // --- 4. Items Table Rows ---
      doc.font("Helvetica");
      let itemY = tableTop + 25;

      order.items.forEach((item) => {
        const itemPrice = parseFloat(item.priceAtTime);
        const itemTotal = item.quantity * itemPrice;

        // Check if we need a new page
        if (itemY > 700) {
          doc.addPage();
          itemY = 50;
        }

        doc.text(item.productName, 50, itemY, { width: 240 });
        doc.text(item.quantity.toString(), 300, itemY, {
          width: 90,
          align: "right",
        });
        doc.text(`Rs. ${itemPrice.toFixed(2)}`, 400, itemY, {
          width: 90,
          align: "right",
        });
        doc.text(`Rs. ${itemTotal.toFixed(2)}`, 500, itemY, {
          width: 50,
          align: "right",
        });

        itemY += 20;
      });

      // Bottom table line
      doc
        .moveTo(50, itemY + 5)
        .lineTo(550, itemY + 5)
        .stroke();
      doc.moveDown(2);

      // --- 5. Totals ---
      const totalsStartX = 350;
      let totalsY = doc.y + 10;
      const subtotal = order.totalAmount - order.shippingCost;

      doc.font("Helvetica").text("Subtotal:", totalsStartX, totalsY);
      doc.text(`Rs. ${subtotal.toFixed(2)}`, 500, totalsY, {
        width: 50,
        align: "right",
      });
      totalsY += 20;

      doc.text("Shipping Cost:", totalsStartX, totalsY);
      doc.text(
        `Rs. ${parseFloat(order.shippingCost).toFixed(2)}`,
        500,
        totalsY,
        { width: 50, align: "right" },
      );
      totalsY += 20;

      doc.font("Helvetica-Bold").text("Total Paid:", totalsStartX, totalsY);
      doc.text(
        `Rs. ${parseFloat(order.totalAmount).toFixed(2)}`,
        500,
        totalsY,
        { width: 50, align: "right" },
      );

      // --- 6. Footer ---
      doc
        .font("Helvetica")
        .fontSize(10)
        .text("Thank you for your business!", 50, 750, {
          align: "center",
          width: 500,
        });

      // Finalize the PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};
