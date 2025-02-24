import * as nodemailer from "nodemailer";

const mailTransporter = nodemailer.createTransport({
  service: "gmail",
  secure: false,
  auth: { 
    user: process.env.NODEMAILER_GMAIL,
    pass: process.env.NODEMAILER_PASSWORD,
  },
  tls: {
    // rejectUnauthorized: false
}
});

const sendMail = ({
  subject,
  content,
  emailTo,
}) => {
  const details = {
    from: process.env.NODEMAILER_GMAIL,
    to: emailTo,
    subject,
    text: subject,
    html: content,
  };

  mailTransporter.sendMail(details, (err, info) => {
    if (err) {
      console.log(err);
      return false;
    } else {
      console.log("Email sent: " + info.response);
      return true;
    }
  });
};

export default sendMail;