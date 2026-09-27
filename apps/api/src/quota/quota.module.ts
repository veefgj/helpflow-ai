import { Global, Module } from "@nestjs/common";
import { QuotaController } from "./quota.controller";
import { QuotaService } from "./quota.service";

@Global()
@Module({
  controllers: [QuotaController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
