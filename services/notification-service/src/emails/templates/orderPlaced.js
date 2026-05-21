export const getOrderPlacedTemplate = (order, user) => {
  const orderIdShort = order.id.split("-")[0].toUpperCase();
  const customerName = user.name || "Customer";

  return `
    <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
      <div style="text-align: center; padding: 20px 0;">
        <h2 style="color: #2563eb; margin: 0;">Order Confirmed! 🎉</h2>
      </div>
      
      <p>Hi ${customerName},</p>
      <p>Thank you for your purchase! Your order <strong>#${orderIdShort}</strong> has been successfully placed and is currently being processed.</p>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <h3 style="margin-top: 0; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Order Summary</h3>
        
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Total Amount:</td>
            <td style="padding: 8px 0; text-align: right; font-weight: bold;">₹${parseFloat(order.totalAmount).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Payment Mode:</td>
            <td style="padding: 8px 0; text-align: right; font-weight: bold;">${order.paymentMode} (${order.paymentType})</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center;">
        <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold; text-transform: uppercase; font-size: 0.85em;">Secure Delivery PIN</p>
        <p style="margin: 0; font-size: 2.5em; font-weight: bold; letter-spacing: 5px; color: #ea580c;">${order.deliveryAuthCode}</p>
        <p style="margin: 10px 0 0 0; color: #9a3412; font-size: 0.9em;">Please provide this code to the courier to receive your package.</p>
      </div>

      <p>A detailed invoice is attached to this email as a PDF document.</p>
      
      <p style="margin-top: 30px; color: #64748b; font-size: 0.9em;">
        Best regards,<br>
        <strong>The Online Shop Team</strong>
      </p>
    </div>
  `;
};
