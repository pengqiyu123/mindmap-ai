export type Role = 'user' | 'assistant';
export type MessageSource = 'chat' | 'ide';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  source?: MessageSource;
}

export interface MarkmapSnapshot {
  id: string;
  markdown: string;
  timestamp: number;
  label?: string;
  source?: 'chat' | 'ide' | 'restore' | 'regenerate';
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  markmap: string;
  markmapSource?: 'chat' | 'ide' | 'regenerate';
  markmapHistory: MarkmapSnapshot[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: number;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
}
