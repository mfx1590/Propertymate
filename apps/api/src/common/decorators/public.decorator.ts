import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts an endpoint out of JWT auth. Everything else is deny-by-default (Plan §11). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
