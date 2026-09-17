import { Module } from "@nestjs/common";
import { WebhookSignatureGuard } from "../../guards/webhook-signature.guard";
import { MatchController } from "./match.controller";
import { MatchService } from "./match.service";
import { DockerModule } from "../../docker/docker.module";
import { WebhookAuditService } from "./webhook-audit.service";
import { Cs2ContainerCleanupService } from "./cs2-container-cleanup.service";
import { MatchTimeoutService } from "./match-timeout.service";

@Module({
  imports: [DockerModule],
  controllers: [MatchController],
  providers: [MatchService, WebhookSignatureGuard, WebhookAuditService, Cs2ContainerCleanupService, MatchTimeoutService],
  exports: [MatchService]
})
export class MatchModule {}
