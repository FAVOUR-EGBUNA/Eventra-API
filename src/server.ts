import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";

import authRoutes from "./auth/auth.routes";
import organizerRoutes from "./organizer/organizer.routes";
import organizersCompatRoutes from "./organizer/organizers.compat.routes";
import categoriesRoutes from "./categories/categories.routes";
import eventsRoutes from "./events/events.routes";
import uploadsRoutes from "./uploads/uploads.routes";
import promotionsRoutes from "./promotions/promotions.routes";
import adminRoutes from "./admin/admin.routes";
import enquiriesRoutes from "./enquiries/enquiries.routes";

dotenv.config();

const app = express();

const allowedOrigins = [
  "http://localhost:4001",
  "https://eventra-portfolio.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);

app.use(express.json());

app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/organizer", organizerRoutes);
app.use("/api/v1/organizers", organizersCompatRoutes);
app.use("/api/v1/categories", categoriesRoutes);
app.use("/api/v1/events", eventsRoutes);
app.use("/api/v1/uploads", uploadsRoutes);
app.use("/api/v1/promotions", promotionsRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/enquiries", enquiriesRoutes);

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Eventra API is running",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Eventra API running on port ${PORT}`);
});