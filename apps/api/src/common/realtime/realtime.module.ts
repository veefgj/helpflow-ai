import { Global, Module } from "@nestjs/common";
import { RealtimeEmitterService } from "./realtime-emitter.service";

@Global()
@Module({
  providers: [RealtimeEmitterService],
  exports: [RealtimeEmitterService],
})
export class RealtimeModule {}
