import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ChatbotsService } from "./chatbots.service";
import { CreateChatbotDto } from "./dto/create-chatbot.dto";
import { UpdateChatbotDto } from "./dto/update-chatbot.dto";

@UseGuards(OrgMembershipGuard)
@Controller("api/orgs/:orgId/chatbots")
export class ChatbotsController {
  constructor(@Inject(ChatbotsService) private readonly chatbots: ChatbotsService) {}

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Post()
  async create(@Param("orgId") orgId: string, @Body() dto: CreateChatbotDto) {
    return this.chatbots.create(orgId, dto);
  }

  @Get()
  async list(@Param("orgId") orgId: string) {
    return this.chatbots.list(orgId);
  }

  @Get(":chatbotId")
  async get(@Param("orgId") orgId: string, @Param("chatbotId") chatbotId: string) {
    return this.chatbots.get(orgId, chatbotId);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Patch(":chatbotId")
  async update(@Param("orgId") orgId: string, @Param("chatbotId") chatbotId: string, @Body() dto: UpdateChatbotDto) {
    return this.chatbots.update(orgId, chatbotId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":chatbotId")
  async remove(@Param("orgId") orgId: string, @Param("chatbotId") chatbotId: string) {
    await this.chatbots.remove(orgId, chatbotId);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Get(":chatbotId/embed")
  async embed(@Param("orgId") orgId: string, @Param("chatbotId") chatbotId: string) {
    return this.chatbots.embedSnippet(orgId, chatbotId);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Put(":chatbotId/knowledge-bases/:kbId")
  async attachKb(@Param("orgId") orgId: string, @Param("chatbotId") chatbotId: string, @Param("kbId") kbId: string) {
    await this.chatbots.attachKnowledgeBase(orgId, chatbotId, kbId);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":chatbotId/knowledge-bases/:kbId")
  async detachKb(@Param("orgId") orgId: string, @Param("chatbotId") chatbotId: string, @Param("kbId") kbId: string) {
    await this.chatbots.detachKnowledgeBase(orgId, chatbotId, kbId);
  }
}
