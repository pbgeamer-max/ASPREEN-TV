import { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Legacy VOD Route Fallback
 * VOD (Movies & Series) has been completely separated into its dedicated project TVORA (https://tvora.site)
 * This route prevents 404s/500s for legacy clients and points them to TVORA.
 */
export async function vodRoutes(server: FastifyInstance) {
  const handler = async (_request: any, reply: FastifyReply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.status(200).send({
      success: true,
      status: 'moved',
      message: 'VOD (Movies and Series) has been separated into its own dedicated platform TVORA.',
      platform: 'TVORA',
      website: 'https://tvora.site',
      aspreen_tv: 'Dedicated exclusively to Live TV Channels'
    });
  };

  server.get('/*', handler);
  server.post('/*', handler);
}
