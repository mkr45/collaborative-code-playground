import express, { Request, Response, Application } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { prisma } from "./lib/prisma";

const app: Application = express();
const port = 4000;
const server = createServer(app);
const io = new Server(server);

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
