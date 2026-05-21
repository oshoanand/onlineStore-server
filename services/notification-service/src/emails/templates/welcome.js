export const getWelcomeEmailTemplate = (userName) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background-color: #f8fafc;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 600px;
        margin: 40px auto;
        background-color: #ffffff;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .header {
        background-color: #0284c7;
        padding: 40px 20px;
        text-align: center;
      }
      .header h1 {
        color: #ffffff;
        margin: 0;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.5px;
      }
      .header p {
        color: #e0f2fe;
        margin: 10px 0 0 0;
        font-size: 16px;
      }
      .content {
        padding: 40px 30px;
        color: #334155;
        line-height: 1.6;
      }
      .content h2 {
        color: #0f172a;
        margin-top: 0;
      }
      .button-container {
        text-align: center;
        margin: 35px 0;
      }
      .button {
        background-color: #0284c7;
        color: #ffffff;
        padding: 14px 32px;
        text-decoration: none;
        border-radius: 8px;
        font-weight: bold;
        font-size: 16px;
        display: inline-block;
      }
      .footer {
        background-color: #f1f5f9;
        padding: 20px;
        text-align: center;
        font-size: 14px;
        color: #64748b;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Maachh Ghr Express</h1>
        <p>Gaon se shehar tak</p>
      </div>
      <div class="content">
        <h2>Welcome to the family, ${userName}!</h2>
        <p>We are thrilled to have you on board. Your account has been successfully created, and you are now ready to order the freshest fish and premium shrimp directly to your kitchen.</p>
        
        <p>Our network connects you directly with local aqua-farms, ensuring you get the highest quality catch every single time.</p>
        
        <div class="button-container">
          <a href="https://yourdomain.com/products" class="button">Start Shopping Now</a>
        </div>
        
        <p>If you have any questions or need assistance, our support team is always here to help.</p>
        <p>Best regards,<br><strong>The Maachh Express Team</strong></p>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} Maachh Ghr Express. All rights reserved.<br>
        New Delhi, India
      </div>
    </div>
  </body>
  </html>
  `;
};
