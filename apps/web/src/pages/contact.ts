import type { APIRoute } from 'astro';

// Story 2.5: there is no Contact page (decided 2026-10-30), but the bot's user-agent carries this address, so it forwards to the
// "Our bot" part of the About page.
export const GET: APIRoute = ({ redirect }) => redirect('/about#our-bot', 302);

export const ALL: APIRoute = () => new Response('method_not_allowed', { status: 405, headers: { Allow: 'GET' } });
