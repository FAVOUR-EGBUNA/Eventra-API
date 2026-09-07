import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

// The current personal backend does not yet have an Enquiry model.
// These routes keep the public contact form and admin enquiry pages
// functional with a clean zero-state until persistence is added.

router.post("/", async (_req, res) => {
  return res.status(201).json({
    success: true,
    message: "Thanks — your message was received.",
    body: null,
  });
});

router.get("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

  return res.status(200).json({
    success: true,
    message: "Enquiries retrieved.",
    body: {
      enquiries: [],
      unreadCount: 0,
      meta: {
        currentPage: page,
        limit,
        total: 0,
        totalPages: 1,
        hasMore: false,
      },
    },
  });
});

router.patch(
  "/read-all",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "All enquiries marked as read.",
      body: {
        modifiedCount: 0,
      },
    });
  },
);

router.delete("/", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "Enquiries deleted.",
    body: {
      deletedCount: 0,
    },
  });
});

router.get("/:id", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  return res.status(404).json({
    success: false,
    message: "Enquiry not found.",
  });
});

export default router;
