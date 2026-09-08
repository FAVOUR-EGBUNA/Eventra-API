import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "Eventra <noreply@eventra.lovie.me>";

export async function sendVerificationEmail(email: string, code: string) {
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verify your Eventra account",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Verify your Eventra account</h2>

        <p>Use the verification code below to complete your registration:</p>

        <div
          style="
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 8px;
            margin: 24px 0;
          "
        >
          ${code}
        </div>

        <p>This code expires in 10 minutes.</p>

        <p>
          If you did not create an Eventra account,
          you can ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function sendPasswordResetEmail(email: string, code: string) {
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Reset your Eventra password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Reset your Eventra password</h2>

        <p>
          We received a request to reset the password
          for your Eventra account.
        </p>

        <p>Use the code below to continue:</p>

        <div
          style="
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 8px;
            margin: 24px 0;
          "
        >
          ${code}
        </div>

        <p>This code expires in 10 minutes.</p>

        <p>
          If you did not request a password reset,
          you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}
