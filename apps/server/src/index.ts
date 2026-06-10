import express, { Request, Response, Application } from "express";
import { createServer } from "http";
import { Server } from "socket.io";

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

app.get("/rooms", (req: Request, res: Response) => {
  res.json({
    success: true,
    rooms: ["room1", "room2"],
  });
});

app.post("/rooms", (req: Request, res: Response) => {
  const { name, slug, language, code, isPrivate } = req.body;

  if (!name || !slug || !language) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
    });
  }
  res.status(201).json({
    success: true,
    room: {
      name,
      slug,
      language,
      code,
      isPrivate,
    },
  });
});

io.on("connection", (socket) => {
  console.log("a user connected");
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
