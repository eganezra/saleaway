// Placeholder Worker for Story 1.1. The real scheduled, queue and fetch handlers
// are built in Story 3.1.
export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler;
