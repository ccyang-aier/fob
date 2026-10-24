import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { modelCatalogSchema } from '@fob/shared/model-catalog';
import type { ModelCatalog } from '@fob/shared/model-catalog';
import { catalogModel } from './schema';

export interface ModelCatalogRepository {
  list(): Promise<ModelCatalog>;
}

export function createModelCatalogRepository(pool: Pool): ModelCatalogRepository {
  const db = drizzle(pool);
  return {
    async list() {
      const items = await db.select().from(catalogModel).orderBy(asc(catalogModel.provider), asc(catalogModel.name));
      return modelCatalogSchema.parse({ items });
    },
  };
}
