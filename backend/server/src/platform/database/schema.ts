import * as identity from './identity/schema';
import { identityTables } from './identity/tables';
import { resourceSchema, resourceTables } from './resources/schema';
import { modelCatalogDatabaseSchema, modelCatalogTables } from '../../modules/models/schema';
export * from './identity/schema';
export * from './resources/schema';
export { identityTables } from './identity/tables';
export * from '../../modules/models/schema';
/** One current database catalog, composed from independently owned modules. */
export const applicationSchema = { ...identity, ...resourceSchema, ...modelCatalogDatabaseSchema };
export const allApplicationTables = [...identityTables, ...resourceTables, ...modelCatalogTables];
