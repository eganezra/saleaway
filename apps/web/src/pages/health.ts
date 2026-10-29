import type { APIRoute } from 'astro';
import { log } from '../lib/log';

export const GET: APIRoute = () => {
  log.info('health_checked', { route: '/health' });
  return new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
