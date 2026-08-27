import express, {
  Request,
  Response,
  Application,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { Strategy as GitHubStrategy, type Profile } from "passport-github2";
import type { User as DatabaseUser } from "../generated/prisma/client";
import { prisma } from "./lib/prisma";

const app: Application = express();
const port = 4000;
const server = createServer(app);
const io = new Server(server);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const sessionSecret = process.env.SESSION_SECRET ?? "dev-session-secret";
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const githubCallbackUrl =
  process.env.GITHUB_CALLBACK_URL ?? "http://localhost:4000/auth/github/callback";
const authSuccessRedirect = process.env.AUTH_SUCCESS_REDIRECT ?? corsOrigin;
const authFailureRedirect = process.env.AUTH_FAILURE_REDIRECT;

declare global {
  namespace Express {
    interface User extends DatabaseUser {}
  }
}

function getGitHubProfileData(profile: Profile) {
  const githubId = Number(profile.id);

  if (!Number.isSafeInteger(githubId)) {
    throw new Error("GitHub profile id is invalid");
  }

  const username = profile.username?.trim();

  if (!username) {
    throw new Error("GitHub profile username is missing");
  }

  const avatarUrl =
    Array.isArray(profile.photos) && profile.photos.length > 0
      ? profile.photos[0]?.value ?? null
      : null;
  const email =
    Array.isArray(profile.emails) && profile.emails.length > 0
      ? profile.emails[0]?.value ?? null
      : null;

  return {
    githubId,
    username,
    email,
    avatar: avatarUrl,
  };
}

async function findOrCreateGitHubUser(profile: Profile): Promise<DatabaseUser> {
  const profileData = getGitHubProfileData(profile);

  return prisma.user.upsert({
    where: {
      githubId: profileData.githubId,
    },
    update: {
      username: profileData.username,
      email: profileData.email,
      avatar: profileData.avatar,
    },
    create: profileData,
  });
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((userId: string, done) => {
  prisma.user
    .findUnique({
      where: {
        id: userId,
      },
    })
    .then((user) => {
      done(null, user ?? false);
    })
    .catch((error: unknown) => {
      done(error);
    });
});

if (githubClientId && githubClientSecret) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: githubClientId,
        clientSecret: githubClientSecret,
        callbackURL: githubCallbackUrl,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (error: unknown, user?: Express.User) => void,
      ) => {
        try {
          const user = await findOrCreateGitHubUser(profile);
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      },
    ),
  );
}

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(express.json());
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

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

app.get("/auth/github", (req: Request, res: Response, next: NextFunction) => {
  if (!githubClientId || !githubClientSecret) {
    return sendErrorResponse(
      res,
      500,
      "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
    );
  }

  return passport.authenticate("github", { scope: ["user:email"] })(
    req,
    res,
    next,
  );
});

app.get(
  "/auth/github/callback",
  (req: Request, res: Response, next: NextFunction) => {
    if (!githubClientId || !githubClientSecret) {
      return sendErrorResponse(
        res,
        500,
        "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
      );
    }

    return passport.authenticate("github", (error: unknown, user?: Express.User | false) => {
      if (error) {
        return next(error);
      }

      if (!user) {
        if (authFailureRedirect) {
          return res.redirect(authFailureRedirect);
        }

        return sendErrorResponse(res, 401, "GitHub login failed");
      }

      return req.logIn(user, (loginError) => {
        if (loginError) {
          return next(loginError);
        }

        if (authSuccessRedirect) {
          return res.redirect(authSuccessRedirect);
        }

        return sendSuccessResponse(res, 200, "GitHub login successful", {
          user,
        });
      });
    })(req, res, next);
  },
);

app.get("/auth/me", (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    return sendErrorResponse(res, 401, "Not authenticated");
  }

  return sendSuccessResponse(res, 200, "Authenticated user fetched successfully", {
    user: req.user,
  });
});

app.post("/auth/logout", (req: Request, res: Response, next: NextFunction) => {
  req.logout((logoutError) => {
    if (logoutError) {
      return next(logoutError);
    }

    req.session.destroy((sessionError) => {
      if (sessionError) {
        return next(sessionError);
      }

      res.clearCookie("connect.sid");
      return sendSuccessResponse(res, 200, "Logged out successfully");
    });
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

class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

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

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
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

app.get(
  "/rooms",
  asyncHandler(async (req: Request, res: Response) => {
    const rooms = await prisma.room.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return sendSuccessResponse(res, 200, "Rooms fetched successfully", {
      rooms,
    });
  }),
);

app.get(
  "/rooms/:slug",
  asyncHandler(async (req: Request, res: Response) => {
    const normalizedSlug = getNormalizedSlug(req.params.slug);

    if (!normalizedSlug) {
      throw new AppError("Room slug is required", 400);
    }

    const room = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!room) {
      throw new AppError("Room not found", 404);
    }

    return sendSuccessResponse(res, 200, "Room fetched successfully", {
      room,
    });
  }),
);

app.patch(
  "/rooms/:slug",
  asyncHandler(async (req: Request, res: Response) => {
    const normalizedSlug = getNormalizedSlug(req.params.slug);

    if (!normalizedSlug) {
      throw new AppError("Room slug is required", 400);
    }

    const validationResult = validateUpdateRoomBody(req.body);

    if (!validationResult.success) {
      throw new AppError(validationResult.message, 400);
    }

    const existingRoom = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!existingRoom) {
      throw new AppError("Room not found", 404);
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
  }),
);

app.delete(
  "/rooms/:slug",
  asyncHandler(async (req: Request, res: Response) => {
    const normalizedSlug = getNormalizedSlug(req.params.slug);

    if (!normalizedSlug) {
      throw new AppError("Room slug is required", 400);
    }

    const existingRoom = await prisma.room.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (!existingRoom) {
      throw new AppError("Room not found", 404);
    }

    const room = await prisma.room.delete({
      where: {
        slug: normalizedSlug,
      },
    });

    return sendSuccessResponse(res, 200, "Room deleted successfully", {
      room,
    });
  }),
);

app.post(
  "/rooms",
  asyncHandler(async (req: Request, res: Response) => {
    const validationResult = validateCreateRoomBody(req.body);

    if (!validationResult.success) {
      throw new AppError(validationResult.message, 400);
    }

    try {
      const room = await prisma.room.create({
        data: validationResult.data,
      });

      return sendSuccessResponse(res, 201, "Room created successfully", {
        room,
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError("A room with this slug already exists", 409);
      }

      throw error;
    }
  }),
);

const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return sendErrorResponse(res, error.statusCode, error.message);
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, error);
  return sendErrorResponse(res, 500, "Internal server error");
};

app.use(errorHandler);

io.on("connection", (socket) => {
  console.log("a user connected");
});
         
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
