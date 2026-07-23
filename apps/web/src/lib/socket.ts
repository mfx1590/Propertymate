'use client';

import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './listings';
import { getAccessToken } from './api';

let socket: Socket | null = null;

/** Lazily-created singleton Socket.io connection authenticated with the access token. */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  const token = getAccessToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io(API_BASE, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: true,
    });
  } else {
    socket.auth = { token };
    socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
