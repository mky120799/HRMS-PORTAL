import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/auth/decorators';
import { RawResponse } from '../../common/interceptors/transform.interceptor';
import { ScimService } from './scim.service';
import { ScimGroupsService } from './scim-groups.service';
import { scimListQuerySchema } from './scim.dto';

const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** SCIM clients expect RFC 7644 error bodies (`status` as a string, `detail`), not the app's envelope. */
@Catch()
class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ScimExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let body: Record<string, unknown> = { schemas: [ERROR_SCHEMA], status: '500', detail: 'Internal error' };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      body =
        typeof response === 'object' && response && 'schemas' in response
          ? (response as Record<string, unknown>)
          : { schemas: [ERROR_SCHEMA], status: String(status), detail: exception.message };
    } else {
      this.logger.error('SCIM request failed', exception instanceof Error ? exception.stack : String(exception));
    }
    void reply.status(status).header('content-type', 'application/scim+json').send(body);
  }
}

/**
 * SCIM 2.0 provisioning for Okta / Entra ID. Authenticated by the per-provider
 * bearer token (not by user JWTs), so the routes are @Public() for the global
 * JWT guard. Responses are raw SCIM JSON, not the app's success envelope.
 * IdPs sync in bursts, hence the higher rate limit.
 */
@ApiTags('SCIM')
@Public()
@RawResponse()
@UseFilters(ScimExceptionFilter)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('scim/v2')
export class ScimController {
  constructor(
    private readonly scim: ScimService,
    private readonly groups: ScimGroupsService,
  ) {}

  @Get('ServiceProviderConfig')
  serviceProviderConfig() {
    return this.scim.serviceProviderConfig();
  }

  @Get('ResourceTypes')
  resourceTypes() {
    return this.scim.resourceTypes();
  }

  @Get('Schemas')
  schemas() {
    return this.scim.schemas();
  }

  @Get('Users')
  async listUsers(@Headers('authorization') authorization: string | undefined, @Query() query: Record<string, unknown>) {
    const ctx = await this.scim.authenticate(authorization);
    const parsed = scimListQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException(this.scim.error('Invalid list parameters', 400, 'invalidValue'), 400);
    return this.scim.list(ctx, parsed.data);
  }

  @Get('Users/:id')
  async getUser(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const ctx = await this.scim.authenticate(authorization);
    return this.scim.get(ctx, id);
  }

  @Post('Users')
  async createUser(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const ctx = await this.scim.authenticate(authorization);
    return this.scim.create(ctx, body);
  }

  @Put('Users/:id')
  async replaceUser(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const ctx = await this.scim.authenticate(authorization);
    return this.scim.replace(ctx, id, body);
  }

  @Patch('Users/:id')
  async patchUser(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const ctx = await this.scim.authenticate(authorization);
    return this.scim.patch(ctx, id, body);
  }

  @Delete('Users/:id')
  @HttpCode(204)
  async deleteUser(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const ctx = await this.scim.authenticate(authorization);
    await this.scim.deactivate(ctx, id);
  }

  @Get('Groups')
  async listGroups(@Headers('authorization') authorization: string | undefined, @Query() query: Record<string, unknown>) {
    const ctx = await this.scim.authenticate(authorization);
    return this.groups.list(ctx, this.listQuery(query));
  }

  @Get('Groups/:id')
  async getGroup(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const ctx = await this.scim.authenticate(authorization);
    return this.groups.get(ctx, id, this.listQuery(query));
  }

  @Post('Groups')
  async createGroup(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const ctx = await this.scim.authenticate(authorization);
    return this.groups.create(ctx, body);
  }

  @Put('Groups/:id')
  async replaceGroup(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const ctx = await this.scim.authenticate(authorization);
    return this.groups.replace(ctx, id, body);
  }

  @Patch('Groups/:id')
  async patchGroup(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const ctx = await this.scim.authenticate(authorization);
    return this.groups.patch(ctx, id, body);
  }

  @Delete('Groups/:id')
  @HttpCode(204)
  async deleteGroup(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const ctx = await this.scim.authenticate(authorization);
    await this.groups.remove(ctx, id);
  }

  private listQuery(query: Record<string, unknown>) {
    const parsed = scimListQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException(this.scim.error('Invalid list parameters', 400, 'invalidValue'), 400);
    return parsed.data;
  }
}
