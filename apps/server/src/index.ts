import express, { Request, Response, Application } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app: Application = express();
const port = 4000;
const server = createServer(app);
const io = new Server(server);

// Root route with explicit Request and Response types
app.get('/', (req: Request, res: Response) => {
  res.send('Hello World from TypeScript!');
});

io.on('connection', (socket) => {
  console.log('a user connected');
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
