export default function getMailTemplate(templateName) {
  switch (templateName) {
    case "exampleTemplate":
      return `
          <html>
            <head>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  background-color: #f4f4f4;
                  color: #333;
                }
                .container {
                  padding: 20px;
                  background-color: #fff;
                  border-radius: 5px;
                  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                }
                .header {
                  font-size: 28px;
                  font-weight: bold;
                  margin-bottom: 20px;
                }
                .content {
                  font-size: 15px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">Template Header</div>
                <div class="content">Probando, probando, probando.</div>
              </div>
            </body>
          </html>
        `;
    default:
      return "";
  }
}
