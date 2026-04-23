export interface User {
  id: string;
  githubId: number;
  username: string;
  email?: string;
  avatar?: string;
  createdAt: Date;
}

export interface Room {
  id: string;
  slug: string;
  name: string;
  language: string;
  code: string;
  ownerId: string;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  roomSlug: string;
  username: string;
  message: string;
  timestamp: string;
}