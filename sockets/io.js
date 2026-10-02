// Shared handle to the Socket.IO server so models and controllers can push
// live updates without importing server.js. Every authenticated socket joins
// `user:<id>`, so emitting to that room reaches all of a person's open tabs.
let io = null;

export const setIo = (instance) => {
  io = instance;
};

export const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
};

export const emitToInstitution = (institutionId, event, payload) => {
  if (!io || !institutionId) return;
  io.to(`institution:${String(institutionId)}`).emit(event, payload);
};
