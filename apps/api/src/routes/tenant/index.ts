import { FastifyPluginAsync } from 'fastify';
import { leadRoutes } from './leads.js';
import { campaignRoutes } from './campaigns.js';
import { meetingsRoutes } from './meetings.js';
import { dashboardRoutes } from './dashboard.js';
import { integrationsRoutes } from './integrations.js';
import { notificationsRoutes } from './notifications.js';
import { lgpdRoutes } from './lgpd.js';
import { tenantRoutes as tenantContractRoutes } from '../tenant.js';

export const tenantRoutes: FastifyPluginAsync = async (app) => {
  await app.register(tenantContractRoutes);
  await app.register(leadRoutes, { prefix: '/leads' });
  await app.register(campaignRoutes, { prefix: '/campaigns' });
  await app.register(meetingsRoutes, { prefix: '/meetings' });
  await app.register(dashboardRoutes, { prefix: '/dashboard' });
  await app.register(integrationsRoutes, { prefix: '/integrations' });
  await app.register(notificationsRoutes, { prefix: '/notifications' });
  await app.register(lgpdRoutes, { prefix: '/lgpd' });
};

export default tenantRoutes;
