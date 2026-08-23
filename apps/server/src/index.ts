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

function getNormalizedSlug(slugParam: string | string[] | undefined) {
  const rawSlug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
  return typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : "";
}

type RoomCreateData = {
  name: string;
  slug: string;
  language: string;
  code: string;
  isPrivate: boolean;
  ownerId: string;
};

type RoomUpdateData = {
  name?: string;
  language?: string;
  code?: string;
  isPrivate?: boolean;
};

type ValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      message: string;
    };

function sendSuccessResponse(
  res: Response,
  statusCode: number,
  message: string,
  payload: Record<string, unknown> = {},
) {
  return res.status(statusCode).json({
    success: true,
    message,
    ...payload,
  });
}

function sendErrorResponse(res: Response, statusCode: number, message: string) {
  return res.status(statusCode).json({
    success: false,
    message,
  });
}

function validateCreateRoomBody(body: unknown): ValidationResult<RoomCreateData> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      message: "Request body must be a valid JSON object",
    };
  }

  const { name, slug, language, code, isPrivate, ownerId } = body as Record<
    string,
    unknown
  >;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const normalizedSlug = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  const normalizedLanguage =
    typeof language === "string" ? language.trim().toLowerCase() : "";
  const normalizedCode = typeof code === "string" ? code : "";
  const normalizedOwnerId = typeof ownerId === "string" ? ownerId.trim() : "";

  if (!trimmedName) {
    return {
      success: false,
      message: "name is required and must be a non-empty string",
    };
  }

  if (!normalizedSlug) {
    return {
      success: false,
      message: "slug is required and must be a non-empty string",
    };
  }

  if (!normalizedLanguage) {
    return {
      success: false,
      message: "language is required and must be a non-empty string",
    };
  }

  if (!normalizedOwnerId) {
    return {
      success: false,
      message: "ownerId is required and must be a non-empty string",
    };
  }

  if (code !== undefined && typeof code !== "string") {
    return {
      success: false,
      message: "code must be a string",
    };
  }

  if (isPrivate !== undefined && typeof isPrivate !== "boolean") {
    return {
      success: false,
      message: "isPrivate must be a boolean",
    };
  }

  return {
    success: true,
    data: {
      name: trimmedName,
      slug: normalizedSlug,
      language: normalizedLanguage,
      code: normalizedCode,
      isPrivate: isPrivate ?? false,
      ownerId: normalizedOwnerId,
    },
  };
}

function validateUpdateRoomBody(body: unknown): ValidationResult<RoomUpdateData> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      message: "Request body must be a valid JSON object",
    };
  }

  const { name, language, code, isPrivate } = body as Record<string, unknown>;
  const updateData: RoomUpdateData = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return {
        success: false,
        message: "name must be a non-empty string",
      };
    }

    updateData.name = name.trim();
  }

  if (language !== undefined) {
    if (typeof language !== "string" || !language.trim()) {
      return {
        success: false,
        message: "language must be a non-empty string",
      };
    }

    updateData.language = language.trim().toLowerCase();
  }

  if (code !== undefined) {
    if (typeof code !== "string") {
      return {
        success: false,
        message: "code must be a string",
      };
    }

    updateData.code = code;
  }

  if (isPrivate !== undefined) {
    if (typeof isPrivate !== "boolean") {
      return {
        success: false,
        message: "isPrivate must be a boolean",
      };
    }

    updateData.isPrivate = isPrivate;
  }

  if (Object.keys(updateData).length === 0) {
    return {
      success: false,
      message: "Provide at least one field to update",
    };
  }

  return {
    success: true,
    data: updateData,
  };
}

app.get("/rooms", async (req: Request, res: Response) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return sendSuccessResponse(res, 200, "Rooms fetched successfully", {
      rooms,
    });
  } catch (error) {
    console.error("Failed to fetch rooms:", error);

    return sendErrorResponse(res, 500, "Failed to fetch rooms");
  }
});

app.get("/rooms/:slug", async (req: Request, res: Response) => {
  try {
    const normalizedSlug = getNormalizedSlug(req.params.slug);

    if (!normalizedSlug) {
      return sendErrorResponse(res, 400, "Room slug is required");
    }

    const room = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!room) {
      return sendErrorResponse(res, 404, "Room not found");
    }

    return sendSuccessResponse(res, 200, "Room fetched successfully", {
      room,
    });
  } catch (error) {
    console.error("Failed to fetch room by slug:", error);

    return sendErrorResponse(res, 500, "Failed to fetch room");
  }
});

app.patch("/rooms/:slug", async (req: Request, res: Response) => {
  try {
    const normalizedSlug = getNormalizedSlug(req.params.slug);

    if (!normalizedSlug) {
      return sendErrorResponse(res, 400, "Room slug is required");
    }

    const validationResult = validateUpdateRoomBody(req.body);

    if (!validationResult.success) {
      return sendErrorResponse(res, 400, validationResult.message);
    }

    const existingRoom = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!existingRoom) {
      return sendErrorResponse(res, 404, "Room not found");
    }

    const room = await prisma.room.update({
      where: {
        slug: normalizedSlug,
      },
      data: validationResult.data,
    });

    return sendSuccessResponse(res, 200, "Room updated successfully", {
      room,
    });
  } catch (error) {
    console.error("Failed to update room:", error);

    return sendErrorResponse(res, 500, "Failed to update room");
  }
});

app.delete("/rooms/:slug", async (req: Request, res: Response) => {
  try {
    const normalizedSlug = getNormalizedSlug(req.params.slug);

    if (!normalizedSlug) {
      return sendErrorResponse(res, 400, "Room slug is required");
    }

    const existingRoom = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!existingRoom) {
      return sendErrorResponse(res, 404, "Room not found");
    }

    const room = await prisma.room.delete({
      where: {
        slug: normalizedSlug,
      },
    });

    return sendSuccessResponse(res, 200, "Room deleted successfully", {
      room,
    });
  } catch (error) {
    console.error("Failed to delete room:", error);

    return sendErrorResponse(res, 500, "Failed to delete room");
  }
});

app.post("/rooms", async (req: Request, res: Response) => {
  try {
    const validationResult = validateCreateRoomBody(req.body);

    if (!validationResult.success) {
      return sendErrorResponse(res, 400, validationResult.message);
    }

    const room = await prisma.room.create({
      data: validationResult.data,
    });

    return sendSuccessResponse(res, 201, "Room created successfully", {
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
      return sendErrorResponse(res, 409, "A room with this slug already exists");
    }

    return sendErrorResponse(res, 500, "Failed to create room");
  }
});

io.on("connection", (socket) => {
  console.log("a user connected");
});
         
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
