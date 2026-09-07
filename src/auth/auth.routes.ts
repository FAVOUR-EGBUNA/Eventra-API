import { Temporal } from "@js-temporal/polyfill";
import { db } from "../prisma/db";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../services/email.service";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { randomInt } from "node:crypto";

const router = Router();

// ==========================
// REGISTER
// ==========================

router.post("/register", async (req, res) => {
  try {
    const { fullName, email, phoneNumber, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const verificationCode = randomInt(100000, 999999).toString();

    const verificationExpiry = Temporal.Now.instant().add({
      minutes: 10,
    });

    const user = await db.orm.public.User.create({
      fullName: fullName.trim(),

      email: normalizedEmail,

      phoneNumber: phoneNumber?.trim() || null,

      passwordHash,

      role: role === "ORGANIZER" ? "ORGANIZER" : "ATTENDEE",

      verificationCode,

      verificationExpiry,
    });

    try {
      await sendVerificationEmail(normalizedEmail, verificationCode);
    } catch (emailError) {
      // Roll back the newly-created account if
      // the verification email could not be sent.
      await db.orm.public.User.where({
        id: user.id,
      }).delete();

      console.error("Verification email error:", emailError);

      return res.status(502).json({
        success: false,
        message: "We couldn't send the verification email. Please try again.",
      });
    }

    return res.status(201).json({
      success: true,

      message: "Account created. Check your email for a verification code.",

      body: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// VERIFY OTP
// ==========================

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const normalizedCode = String(code).trim();

    const user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified.",
      });
    }

    if (!user.verificationCode || !user.verificationExpiry) {
      return res.status(400).json({
        success: false,
        message: "No active verification code found.",
      });
    }

    if (user.verificationCode !== normalizedCode) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
      });
    }

    const now = Temporal.Now.instant();

    if (Temporal.Instant.compare(now, user.verificationExpiry) === 1) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired.",
      });
    }

    await db.orm.public.User.where({
      email: normalizedEmail,
    }).update({
      isEmailVerified: true,
      verificationCode: null,
      verificationExpiry: null,
    });

    const verifiedUser = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!verifiedUser) {
      return res.status(500).json({
        success: false,
        message: "Unable to load verified user.",
      });
    }

    return res.status(200).json({
      success: true,

      message: "Email verified successfully.",

      body: {
        id: verifiedUser.id,
        email: verifiedUser.email,
        role: verifiedUser.role,
        isEmailVerified: verifiedUser.isEmailVerified,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// RESEND OTP
// ==========================

router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified.",
      });
    }

    const verificationCode = randomInt(100000, 999999).toString();

    const verificationExpiry = Temporal.Now.instant().add({
      minutes: 10,
    });

    await db.orm.public.User.where({
      email: normalizedEmail,
    }).update({
      verificationCode,
      verificationExpiry,
    });

    await sendVerificationEmail(normalizedEmail, verificationCode);

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    console.error("Resend OTP error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// FORGOT PASSWORD
// ==========================

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account was found with this email.",
      });
    }

    const resetPasswordCode = randomInt(100000, 999999).toString();

    const resetPasswordExpiry = Temporal.Now.instant().add({
      minutes: 10,
    });

    await db.orm.public.User.where({
      email: normalizedEmail,
    }).update({
      resetPasswordCode,
      resetPasswordExpiry,
    });

    await sendPasswordResetEmail(normalizedEmail, resetPasswordCode);

    return res.status(200).json({
      success: true,
      message: "Password reset code sent to your email.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// VERIFY RESET OTP
// ==========================

router.post("/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and reset code are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const normalizedOtp = String(otp).trim();

    const user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (!user.resetPasswordCode || !user.resetPasswordExpiry) {
      return res.status(400).json({
        success: false,
        message: "No active password reset code found.",
      });
    }

    if (user.resetPasswordCode !== normalizedOtp) {
      return res.status(400).json({
        success: false,
        message: "Invalid password reset code.",
      });
    }

    const now = Temporal.Now.instant();

    if (Temporal.Instant.compare(now, user.resetPasswordExpiry) === 1) {
      return res.status(400).json({
        success: false,
        message: "Password reset code has expired.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password reset code verified.",
    });
  } catch (error) {
    console.error("Verify reset OTP error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// RESET PASSWORD
// ==========================

router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, reset code, and new password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const normalizedOtp = String(otp).trim();

    const user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (!user.resetPasswordCode || !user.resetPasswordExpiry) {
      return res.status(400).json({
        success: false,
        message: "No active password reset request found.",
      });
    }

    if (user.resetPasswordCode !== normalizedOtp) {
      return res.status(400).json({
        success: false,
        message: "Invalid password reset code.",
      });
    }

    const now = Temporal.Now.instant();

    if (Temporal.Instant.compare(now, user.resetPasswordExpiry) === 1) {
      return res.status(400).json({
        success: false,
        message: "Password reset code has expired.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await db.orm.public.User.where({
      email: normalizedEmail,
    }).update({
      passwordHash,
      resetPasswordCode: null,
      resetPasswordExpiry: null,
    });

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// LOGIN
// ==========================

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in.",
      });
    }

    if (!user.passwordHash) {
      return res.status(400).json({
        success: false,
        message:
          "This account uses Google sign-in. Please continue with Google.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
      jwtSecret,
      {
        expiresIn: "7d",
      },
    );

    return res.status(200).json({
      success: true,

      message: "Logged in successfully.",

      body: {
        token,

        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// GOOGLE AUTH
// ==========================

router.post("/google", async (req, res) => {
  try {
    const { accessToken, role } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Google access token is required.",
      });
    }

    const googleResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!googleResponse.ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired Google token.",
      });
    }

    const googleUser = (await googleResponse.json()) as {
      id?: string;
      email?: string;
      verified_email?: boolean;
      name?: string;
      picture?: string;
    };

    if (!googleUser.email || !googleUser.verified_email) {
      return res.status(400).json({
        success: false,
        message: "Google account email could not be verified.",
      });
    }

    const normalizedEmail = googleUser.email.trim().toLowerCase();

    let user = await db.orm.public.User.where({
      email: normalizedEmail,
    }).first();

    // If the account does not exist yet,
    // create it as a Google-authenticated user.
    if (!user) {
      user = await db.orm.public.User.create({
        fullName: googleUser.name?.trim() || normalizedEmail.split("@")[0],

        email: normalizedEmail,

        phoneNumber: null,

        passwordHash: null,

        role: role === "organizer" ? "ORGANIZER" : "ATTENDEE",

        isEmailVerified: true,

        verificationCode: null,

        verificationExpiry: null,

        resetPasswordCode: null,

        resetPasswordExpiry: null,
      });
    }

    // Existing accounts keep their original role.
    // Google login should not silently upgrade an
    // attendee into an organizer.
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
      jwtSecret,
      {
        expiresIn: "7d",
      },
    );

    return res.status(200).json({
      success: true,

      message: "Google authentication successful.",

      body: {
        token,

        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          avatarUrl: googleUser.picture ?? null,
        },
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// ==========================
// CURRENT USER — PROTECTED
// ==========================

router.get("/me", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: please log in to continue",
      });
    }

    const token = authorization.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: please log in to continue",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    let decoded: JwtPayload;

    try {
      const result = jwt.verify(token, jwtSecret);

      if (typeof result === "string") {
        return res.status(401).json({
          success: false,
          message: "Invalid authentication token.",
        });
      }

      decoded = result;
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token.",
      });
    }

    const userId = decoded.sub;

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const user = await db.orm.public.User.where({
      id: userId,
    }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    return res.status(200).json({
      success: true,

      message: "Current user retrieved successfully.",

      body: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

// ==========================
// ROLE TEST ROUTES
// ==========================

router.get(
  "/test-attendee",
  requireAuth,
  requireRole("ATTENDEE"),
  (req: AuthenticatedRequest, res) => {
    return res.status(200).json({
      success: true,
      message: "Attendee access granted.",
      body: req.user,
    });
  },
);

router.get(
  "/test-organizer",
  requireAuth,
  requireRole("ORGANIZER"),
  (req: AuthenticatedRequest, res) => {
    return res.status(200).json({
      success: true,
      message: "Organizer access granted.",
      body: req.user,
    });
  },
);

export default router;
