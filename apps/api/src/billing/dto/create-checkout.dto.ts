import { IsIn } from "class-validator";

export class CreateCheckoutDto {
  /** BUSINESS is "Contact sales" (selfServe = false) — never checked out via this endpoint. */
  @IsIn(["PRO"])
  planCode!: "PRO";
}
