// The click beacon (Story 2.5): when a visitor follows a store link, tell the site which store, so it can count click-outs
// per store (FR19). One small file, loaded from this site only. It sends the store's slug and nothing else: no cookie, no
// identifier. If anything fails the link still works.

function countClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const slug = target.closest<HTMLAnchorElement>('a[data-store]')?.dataset.store;
  if (!slug) return;
  try {
    navigator.sendBeacon('/api/click', slug);
  } catch {
    // the link still opens
  }
}

document.addEventListener('click', countClick);
// a middle click opens the link in a new tab without a `click` event
document.addEventListener('auxclick', (event) => {
  if (event.button === 1) countClick(event);
});
