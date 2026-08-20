import express, { Request, Response, Application } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { prisma } from "./lib/prisma";

const app: Application = express();
const port = 4000;
const server = createServer(app);
const io = new Server(server);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: corsOrigin,
  }),
);
app.use(express.json());

// Root route with explicit Request and Response types
app.get("/", (req: Request, res: Response) => {
  res.send("Hello World from TypeScript!");
});

app.get("/health", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Server is running",
  });
});

app.get("/rooms", async (req: Request, res: Response) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({
      success: true,
      rooms,
    });
  } catch (error) {
    console.error("Failed to fetch rooms:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch rooms",
    });
  }
});

app.get("/rooms/:slug", async (req: Request, res: Response) => {
  try {
    const slugParam = req.params.slug;
    const rawSlug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
    const normalizedSlug = typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : "";

    if (!normalizedSlug) {
      return res.status(400).json({
        success: false,
        message: "Room slug is required",
      });
    }

    const room = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    return res.json({
      success: true,
      room,
    });
  } catch (error) {
    console.error("Failed to fetch room by slug:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch room",
    });
  }
});

app.post("/rooms", async (req: Request, res: Response) => {
  try {
    const { name, slug, language, code, isPrivate, ownerId } = req.body;

    const trimmedName = typeof name === "string" ? name.trim() : "";
    const normalizedSlug = typeof slug === "string" ? slug.trim().toLowerCase() : "";
    const normalizedLanguage =
      typeof language === "string" ? language.trim().toLowerCase() : "";
    const normalizedCode = typeof code === "string" ? code : "";

    if (!trimmedName || !normalizedSlug || !normalizedLanguage || !ownerId) {
      return res.status(400).json({
        success: false,
        message: "name, slug, language, and ownerId are required",
      });
    }

    const room = await prisma.room.create({
      data: {
        name: trimmedName,
        slug: normalizedSlug,
        language: normalizedLanguage,
        code: normalizedCode,
        isPrivate: Boolean(isPrivate),
        ownerId,
      },
    });

    return res.status(201).json({
      success: true,
      room,
    });
  } catch (error) {
    console.error("Failed to create room:", error);

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        success: false,
        message: "A room with this slug already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create room",
    });
  }
});

io.on("connection", (socket) => {
  console.log("a user connected");
});
         
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
