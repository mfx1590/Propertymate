import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@propverify/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission keys an endpoint needs. Checked by PermissionsGuard
 * against the DB-driven role_permissions table — never against role names.
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
