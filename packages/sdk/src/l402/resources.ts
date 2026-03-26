/**
 * Default Resource Resolver Registry
 *
 * Iterates registered resolvers to match incoming requests to protected
 * resource metadata (id, type, price). Used by L402Middleware for
 * dynamic per-resource pricing.
 */

import type { Request } from 'express';
import type { ProtectedResourceInfo, ResourceResolver, ResourceResolverRegistry } from './types.js';

export class DefaultResourceResolverRegistry implements ResourceResolverRegistry {
  private resolvers: ResourceResolver[];

  constructor(resolvers: ResourceResolver[] = []) {
    this.resolvers = [...resolvers];
  }

  register(resolver: ResourceResolver): void {
    this.resolvers.push(resolver);
  }

  async resolve(req: Request): Promise<ProtectedResourceInfo | undefined> {
    for (const resolver of this.resolvers) {
      if (!resolver.matches(req)) {
        continue;
      }

      const resource = await resolver.resolve(req);
      if (resource) {
        return resource;
      }
    }

    return undefined;
  }
}
