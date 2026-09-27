import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { KnowledgeBasesService } from "./knowledge-bases.service";
import { CreateKnowledgeBaseDto } from "./dto/create-knowledge-base.dto";

@UseGuards(OrgMembershipGuard, RolesGuard)
@Roles("OWNER", "ADMIN")
@Controller("api/orgs/:orgId/knowledge-bases")
export class KnowledgeBasesController {
  constructor(@Inject(KnowledgeBasesService) private readonly knowledgeBases: KnowledgeBasesService) {}

  @Post()
  async create(@Param("orgId") orgId: string, @Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledgeBases.create(orgId, dto);
  }

  @Get()
  async list(@Param("orgId") orgId: string) {
    return this.knowledgeBases.list(orgId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":kbId")
  async remove(@Param("orgId") orgId: string, @Param("kbId") kbId: string) {
    await this.knowledgeBases.remove(orgId, kbId);
  }
}
