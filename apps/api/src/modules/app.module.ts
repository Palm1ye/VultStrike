import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { AccountModule } from "./account/account.module";
import { AuthModule } from "./auth/auth.module";
import { MatchModule } from "./match/match.module";
import { MapsModule } from "./maps/maps.module";
import { QueueModule } from "./queue/queue.module";
import { StatusModule } from "./status/status.module";
import { CommunityModule } from "./community/community.module";
import { PartyModule } from "./party/party.module";
import { RewardsModule } from "./rewards/rewards.module";
import { DockerModule } from "../docker/docker.module";
import { RateLimitGuard } from "../guards/rate-limit.guard";
import { AuthContextGuard } from "../guards/auth-context.guard";

@Module({
  imports: [AccountModule, AuthModule, MatchModule, MapsModule, QueueModule, StatusModule, CommunityModule, PartyModule, RewardsModule, DockerModule],
  providers: [
    Reflector,
    { provide: APP_GUARD, useClass: AuthContextGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard }
  ]
})
export class AppModule {}
