-- The smoke test's own data (Story 2.4): 3 categories, 16 stores, a few records. Times are relative to now, so the page is always fresh.
INSERT INTO categories (id, slug, name, tagline, sort_order, color_token) VALUES
  (1, 'fashion-apparel', 'Fashion & apparel', 'Dress up, pay less.', 1, 'cat-default'),
  (2, 'sport-athleisure-outdoor', 'Sport, athleisure & outdoor', 'Move more, spend less.', 2, 'cat-default'),
  (3, 'pets', 'Pets', 'Happy pets, happy wallet.', 3, 'cat-default');
INSERT INTO retailers (id, slug, name, homepage_url, category_id, rank, sale_url, extraction_method, seed_status, is_visible, created_at) VALUES
  (1, 'fashion-1', 'Fashion Store 1', 'https://fashion-1.example', 1, 1, 'https://fashion-1.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (2, 'fashion-2', 'Fashion Store 2', 'https://fashion-2.example', 1, 2, 'https://fashion-2.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (3, 'fashion-3', 'Fashion Store 3', 'https://fashion-3.example', 1, 3, 'https://fashion-3.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (4, 'fashion-4', 'Fashion Store 4', 'https://fashion-4.example', 1, 4, 'https://fashion-4.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (5, 'fashion-5', 'Fashion Store 5', 'https://fashion-5.example', 1, 5, 'https://fashion-5.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (6, 'fashion-6', 'Fashion Store 6', 'https://fashion-6.example', 1, 6, 'https://fashion-6.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (7, 'fashion-7', 'Fashion Store 7', 'https://fashion-7.example', 1, 7, 'https://fashion-7.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (8, 'fashion-8', 'Fashion Store 8', 'https://fashion-8.example', 1, 8, 'https://fashion-8.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (9, 'fashion-9', 'Fashion Store 9', 'https://fashion-9.example', 1, 9, 'https://fashion-9.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (10, 'fashion-10', 'Fashion Store 10', 'https://fashion-10.example', 1, 10, 'https://fashion-10.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (11, 'sport-1', 'Sport Store 1', 'https://sport-1.example', 2, 1, 'https://sport-1.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (12, 'sport-2', 'Sport Store 2', 'https://sport-2.example', 2, 2, 'https://sport-2.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (13, 'sport-3', 'Sport Store 3', 'https://sport-3.example', 2, 3, 'https://sport-3.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (14, 'sport-4', 'Sport Store 4', 'https://sport-4.example', 2, 4, 'https://sport-4.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (15, 'pets-1', 'Pet Store 1', 'https://pets-1.example', 3, 1, 'https://pets-1.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  (16, 'pets-2', 'Pet Store 2', 'https://pets-2.example', 3, 2, 'https://pets-2.example/sale', 'html', 'verified_products', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));
INSERT INTO sale_records (retailer_id, state, validation, discount_percent, last_validated_at) VALUES
  (1, 'active', 'content_verified', 60, strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hours')),
  (2, 'active', 'content_verified', 35, strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 hours')),
  (3, 'active', 'content_verified', NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours')),
  (11, 'active', 'content_verified', 50, strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 hours')),
  (12, 'active', 'content_verified', 20, strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 hours')),
  (15, 'active', 'content_verified', 15, strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hours'));
