import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DEFAULTS } from "@helpflow/config";
import { CurrentUser, type CurrentUserPayload } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { DocumentsService } from "./documents.service";

@UseGuards(OrgMembershipGuard, RolesGuard)
@Roles("OWNER", "ADMIN")
@Controller("api/orgs/:orgId/knowledge-bases/:kbId/documents")
export class KnowledgeBaseDocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: DEFAULTS.upload.maxFileSizeMb * 1024 * 1024 } }))
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param("orgId") orgId: string,
    @Param("kbId") kbId: string,
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(orgId, kbId, user.userId, file);
  }

  @Get()
  async list(@Param("orgId") orgId: string, @Param("kbId") kbId: string) {
    return this.documents.list(orgId, kbId);
  }
}

@UseGuards(OrgMembershipGuard, RolesGuard)
@Roles("OWNER", "ADMIN")
@Controller("api/orgs/:orgId/documents")
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @HttpCode(HttpStatus.OK)
  @Post(":documentId/retry")
  async retry(@Param("orgId") orgId: string, @Param("documentId") documentId: string) {
    await this.documents.retry(orgId, documentId);
    return { ok: true };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":documentId")
  async remove(@Param("orgId") orgId: string, @Param("documentId") documentId: string) {
    await this.documents.remove(orgId, documentId);
  }
}
