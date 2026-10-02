import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions, RequireStepUp } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createCustomRoleSchema, updateCustomRoleSchema, type CreateCustomRoleDto, type UpdateCustomRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Built-in and custom roles with their permissions; used by role pickers too. */
  @Get()
  @Permissions('roles.manage', 'employees.roles.manage')
  catalog(@CurrentUser() user: AuthUser) {
    return this.roles.catalog(user.tenantId);
  }

  @Post()
  @Permissions('roles.manage')
  @RequireStepUp()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createCustomRoleSchema)) dto: CreateCustomRoleDto) {
    return this.roles.create(user, dto);
  }

  @Patch(':id')
  @Permissions('roles.manage')
  @RequireStepUp()
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCustomRoleSchema)) dto: UpdateCustomRoleDto) {
    return this.roles.update(user, id, dto);
  }

  @Delete(':id')
  @Permissions('roles.manage')
  @RequireStepUp()
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(user, id);
  }
}
