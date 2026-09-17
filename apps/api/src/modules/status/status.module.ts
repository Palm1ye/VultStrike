import { Module } from "@nestjs/common";
import { StatusController } from "./status.controller";
import { DockerModule } from "../../docker/docker.module";
import { Cs2UpdateService } from "./cs2-update.service";
import { StatusService } from "./status.service";

@Module({
  imports: [DockerModule],
  controllers: [StatusController],
  providers: [Cs2UpdateService, StatusService]
})
export class StatusModule {}
