// So a Socket.IO room emit reaches sockets connected on this event loop AND lets a separate
// process (apps/worker, which has no Socket.IO server of its own) publish into the same rooms via
// @socket.io/redis-emitter (Section 7 T4/T5/T6 timers fire in the worker, not the API).
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { ServerOptions } from "socket.io";
import { loadEnv } from "@helpflow/config";

export class RedisIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    const pubClient = new Redis(loadEnv().REDIS_URL);
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    return server;
  }
}
