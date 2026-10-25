import { rewardsApiBase } from '@fob/shared/rewards';
import type { FobAuth } from '../../platform/identity/service';
import { bodyWithPath, createResourceApi, pagination } from '../../platform/resources/http';
import type { RewardsService } from './service';

export function createRewardsRoutes(auth: FobAuth, service: RewardsService) {
  const app = createResourceApi(auth, rewardsApiBase);
  app.get(rewardsApiBase, async context => context.json(await service.summary(context.get('identity'))));
  app.post(`${rewardsApiBase}/check-in`, async context => context.json(await service.checkIn(context.get('identity'), await bodyWithPath(context))));
  app.get(`${rewardsApiBase}/ledger`, async context => context.json(await service.ledger(context.get('identity'), pagination(context))));
  return app;
}
