import { Module } from "@nestjs/common";
import { MapsModule } from "../maps/maps.module";
import { MatchModule } from "../match/match.module";
import { PartyModule } from "../party/party.module";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { DockerModule } from "../../docker/docker.module";
import { QueueTicketCleanupService } from "./queue-ticket-cleanup.service";
import { QueueMatchmakerLoopService } from "./queue-matchmaker-loop.service";

@Module({
  imports: [MapsModule, MatchModule, PartyModule, DockerModule],
  controllers: [QueueController],
  providers: [QueueService, QueueTicketCleanupService, QueueMatchmakerLoopService]
})
export class QueueModule {}
