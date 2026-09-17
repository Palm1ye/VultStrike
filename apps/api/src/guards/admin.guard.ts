import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

/**
 * Guard that restricts access to users with the ADMIN role.
 *
 * Relies on AuthContextGuard (registered as a global APP_GUARD) to have
 * already parsed the JWT and populated `request.user` before this guard runs.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authUser = (request as any).user;

    if (!authUser?.userId) {
      throw new ForbiddenException("Authentication required for admin operations");
    }

    if (authUser.role !== "ADMIN") {
      throw new ForbiddenException(`Admin access required. Current role: ${authUser.role}`);
    }

    return true;
  }
}
