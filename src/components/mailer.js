import nodemailer from "nodemailer";
import dotenv from "dotenv";
import getMailTemplate from "./mailtemplate.js"; // Import the mail template

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Private function to send email
function sendMail(mailOptions) {
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
}

export function sendTextMail(to, subject, text) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text,
  };
  sendMail(mailOptions);
}

export function sendTemplateMail(to, subject, templateName) {
  const html = getMailTemplate(templateName);
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  };
  sendMail(mailOptions);
}
