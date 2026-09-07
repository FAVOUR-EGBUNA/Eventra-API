import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

// ========================================
// LOCAL UPLOAD DIRECTORY
// ========================================

const uploadDirectory = path.resolve(process.cwd(), "uploads");

// Create the folder automatically if it
// doesn't exist yet.
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, {
    recursive: true,
  });
}

// ========================================
// MULTER STORAGE
// ========================================

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDirectory);
  },

  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname) || ".jpg";

    const safeName = file.originalname
      .replace(extension, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const uniqueName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${safeName}${extension}`;

    cb(null, uniqueName);
  },
});

// ========================================
// IMAGE VALIDATION
// ========================================

const imageUpload = multer({
  storage,

  limits: {
    fileSize: 4 * 1024 * 1024,
  },

  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WEBP and GIF images are allowed."));

      return;
    }

    cb(null, true);
  },
});

// ========================================
// EVENT COVER IMAGE
// POST /api/v1/uploads/event-cover
// ========================================

router.post(
  "/event-cover",
  requireAuth,
  requireRole("ORGANIZER"),
  imageUpload.single("image"),
  (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select an image.",
        });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      const url = `${baseUrl}/uploads/${req.file.filename}`;

      return res.status(201).json({
        success: true,

        message: "Event cover uploaded successfully.",

        body: {
          url,

          // For local storage, the filename acts
          // as our temporary publicId.
          publicId: req.file.filename,
        },
      });
    } catch (error) {
      console.error("Event cover upload error:", error);

      return res.status(500).json({
        success: false,
        message: "Upload failed.",
      });
    }
  },
);

// ========================================
// LINEUP PHOTO
// POST /api/v1/uploads/lineup-photo
// ========================================

router.post(
  "/lineup-photo",
  requireAuth,
  requireRole("ORGANIZER"),
  imageUpload.single("image"),
  (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select an image.",
        });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      const url = `${baseUrl}/uploads/${req.file.filename}`;

      return res.status(201).json({
        success: true,

        message: "Lineup photo uploaded successfully.",

        body: {
          url,
          publicId: req.file.filename,
        },
      });
    } catch (error) {
      console.error("Lineup photo upload error:", error);

      return res.status(500).json({
        success: false,
        message: "Upload failed.",
      });
    }
  },
);

export default router;
