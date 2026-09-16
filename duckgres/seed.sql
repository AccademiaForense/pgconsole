DROP TABLE IF EXISTS ducklake.main.support_tickets;
DROP TABLE IF EXISTS ducklake.main.payments;
DROP TABLE IF EXISTS ducklake.main.order_items;
DROP TABLE IF EXISTS ducklake.main.orders;
DROP TABLE IF EXISTS ducklake.main.inventory;
DROP TABLE IF EXISTS ducklake.main.products;
DROP TABLE IF EXISTS ducklake.main.suppliers;
DROP TABLE IF EXISTS ducklake.main.categories;
DROP TABLE IF EXISTS ducklake.main.customers;
DROP TABLE IF EXISTS ducklake.main.employees;
DROP TABLE IF EXISTS ducklake.main.events;
DROP TABLE IF EXISTS ducklake.main.page_views;
DROP TABLE IF EXISTS ducklake.main.warehouses;

CREATE TABLE ducklake.main.categories (
  id INTEGER,
  name VARCHAR,
  description VARCHAR
);

INSERT INTO ducklake.main.categories VALUES
  (1, 'Electronics', 'Devices, accessories and gadgets'),
  (2, 'Clothing', 'Apparel and fashion items'),
  (3, 'Books', 'Printed and digital books'),
  (4, 'Home & Garden', 'Furniture, tools and garden supplies'),
  (5, 'Sports', 'Sport equipment and outdoor gear'),
  (6, 'Toys', 'Toys, games and hobbies'),
  (7, 'Beauty', 'Personal care and cosmetics'),
  (8, 'Automotive', 'Car parts and accessories');

CREATE TABLE ducklake.main.suppliers (
  id INTEGER,
  name VARCHAR,
  country VARCHAR,
  contact_email VARCHAR,
  is_active BOOLEAN,
  created_at TIMESTAMP
);

INSERT INTO ducklake.main.suppliers
SELECT
  i,
  'Supplier ' || i,
  (ARRAY['USA', 'Germany', 'China', 'Italy', 'Japan', 'Vietnam', 'Brazil', 'Poland'])[1 + (i % 8)],
  'supplier' || i || '@example.com',
  (i % 7) <> 0,
  TIMESTAMP '2023-01-01 08:00:00' + (i % 365) * INTERVAL 1 DAY
FROM generate_series(1, 40) AS t(i);

CREATE TABLE ducklake.main.warehouses (
  id INTEGER,
  code VARCHAR,
  city VARCHAR,
  country VARCHAR,
  capacity INTEGER
);

INSERT INTO ducklake.main.warehouses
SELECT
  i,
  'WH-' || lpad(i::VARCHAR, 3, '0'),
  (ARRAY['Milan', 'Berlin', 'Lyon', 'Rotterdam', 'Chicago', 'Austin', 'Osaka', 'Seattle', 'Madrid', 'Warsaw', 'Porto', 'Dublin'])[1 + (i % 12)],
  (ARRAY['Italy', 'Germany', 'France', 'Netherlands', 'USA', 'USA', 'Japan', 'USA', 'Spain', 'Poland', 'Portugal', 'Ireland'])[1 + (i % 12)],
  1000 + (i * 137) % 9000
FROM generate_series(1, 12) AS t(i);

CREATE TABLE ducklake.main.products (
  id INTEGER,
  sku VARCHAR,
  name VARCHAR,
  category_id INTEGER,
  supplier_id INTEGER,
  price DOUBLE,
  cost DOUBLE,
  stock_quantity INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMP
);

INSERT INTO ducklake.main.products
SELECT
  i,
  'SKU-' || lpad(i::VARCHAR, 6, '0'),
  (ARRAY['Widget', 'Gadget', 'Device', 'Module', 'Sensor', 'Adapter', 'Controller', 'Bracket', 'Cable', 'Charger'])[1 + (i % 10)] || ' ' || i,
  1 + (i * 7) % 8,
  1 + (i * 13) % 40,
  CAST(5 + (i * 37) % 495 AS DOUBLE) + CAST(i % 100 AS DOUBLE) / 100,
  CAST(2 + (i * 23) % 250 AS DOUBLE),
  (i * 29) % 1000,
  (i % 11) <> 0,
  TIMESTAMP '2023-06-01 09:00:00' + (i % 500) * INTERVAL 1 DAY
FROM generate_series(1, 2000) AS t(i);

CREATE TABLE ducklake.main.customers (
  id INTEGER,
  email VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  company VARCHAR,
  country VARCHAR,
  city VARCHAR,
  signup_date DATE,
  is_active BOOLEAN,
  credit_limit DOUBLE
);

INSERT INTO ducklake.main.customers
SELECT
  i,
  'user' || i || '@example.com',
  (ARRAY['Alice', 'Bob', 'Carol', 'David', 'Eva', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack'])[1 + (i % 10)],
  (ARRAY['Johnson', 'Smith', 'Williams', 'Brown', 'Martinez', 'Garcia', 'Lee', 'Wilson', 'Taylor', 'Anderson'])[1 + (i % 10)],
  'Company ' || (1 + (i * 3) % 500),
  (ARRAY['USA', 'UK', 'Germany', 'France', 'Italy', 'Spain', 'Canada', 'Japan'])[1 + (i % 8)],
  (ARRAY['New York', 'London', 'Berlin', 'Paris', 'Milan', 'Madrid', 'Toronto', 'Tokyo'])[1 + (i % 8)],
  DATE '2022-01-01' + CAST(i % 730 AS INTEGER),
  (i % 9) <> 0,
  CAST(100 + (i * 17) % 9900 AS DOUBLE)
FROM generate_series(1, 20000) AS t(i);

CREATE TABLE ducklake.main.employees (
  id INTEGER,
  full_name VARCHAR,
  title VARCHAR,
  department VARCHAR,
  salary DOUBLE,
  hire_date DATE,
  manager_id INTEGER,
  is_active BOOLEAN
);

INSERT INTO ducklake.main.employees
SELECT
  i,
  (ARRAY['Anna', 'Marco', 'Sofia', 'Luca', 'Emma', 'Noah', 'Mia', 'Leo', 'Nora', 'Finn'])[1 + (i % 10)] || ' ' || (ARRAY['Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Romano', 'Conti', 'Rizzo', 'Greco'])[1 + (i % 8)],
  (ARRAY['Analyst', 'Engineer', 'Manager', 'Director', 'Support', 'Sales'])[1 + (i % 6)],
  (ARRAY['Sales', 'Engineering', 'Finance', 'Support', 'Marketing', 'Operations'])[1 + (i % 6)],
  CAST(35000 + (i * 211) % 90000 AS DOUBLE),
  DATE '2018-01-01' + CAST(i % 2000 AS INTEGER),
  CASE WHEN i <= 20 THEN NULL ELSE 1 + (i % 20) END,
  (i % 13) <> 0
FROM generate_series(1, 300) AS t(i);

CREATE TABLE ducklake.main.orders (
  id INTEGER,
  customer_id INTEGER,
  employee_id INTEGER,
  order_date TIMESTAMP,
  status VARCHAR,
  channel VARCHAR,
  total_amount DOUBLE,
  shipping_country VARCHAR,
  discount_percent DOUBLE
);

INSERT INTO ducklake.main.orders
SELECT
  i,
  1 + (i * 17) % 20000,
  1 + (i * 11) % 300,
  TIMESTAMP '2024-01-01 00:00:00' + (i % 730) * INTERVAL 1 DAY + (i % 86400) * INTERVAL 1 SECOND,
  (ARRAY['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'])[1 + (i % 6)],
  (ARRAY['web', 'mobile', 'partner', 'store'])[1 + (i % 4)],
  CAST(10 + (i * 53) % 990 AS DOUBLE) + CAST(i % 100 AS DOUBLE) / 100,
  (ARRAY['USA', 'UK', 'Germany', 'France', 'Italy', 'Spain', 'Canada', 'Japan'])[1 + (i % 8)],
  CAST((i % 4) * 5 AS DOUBLE)
FROM generate_series(1, 120000) AS t(i);

CREATE TABLE ducklake.main.order_items (
  id INTEGER,
  order_id INTEGER,
  product_id INTEGER,
  quantity INTEGER,
  unit_price DOUBLE,
  discount_percent DOUBLE
);

INSERT INTO ducklake.main.order_items
SELECT
  (o.id - 1) * 3 + x,
  o.id,
  1 + (o.id * x * 7) % 2000,
  1 + (o.id + x) % 5,
  CAST(5 + (o.id * x * 13) % 495 AS DOUBLE) + 0.99,
  CAST((o.id + x) % 3 * 5 AS DOUBLE)
FROM ducklake.main.orders AS o
CROSS JOIN generate_series(1, 3) AS g(x);

CREATE TABLE ducklake.main.payments (
  id INTEGER,
  order_id INTEGER,
  paid_at TIMESTAMP,
  method VARCHAR,
  amount DOUBLE,
  status VARCHAR
);

INSERT INTO ducklake.main.payments
SELECT
  o.id,
  o.id,
  o.order_date + (1 + (o.id % 5)) * INTERVAL 1 HOUR,
  (ARRAY['card', 'paypal', 'bank_transfer', 'gift_card'])[1 + (o.id % 4)],
  o.total_amount,
  (ARRAY['captured', 'captured', 'captured', 'refunded', 'failed'])[1 + (o.id % 5)]
FROM ducklake.main.orders AS o;

CREATE TABLE ducklake.main.inventory (
  id INTEGER,
  product_id INTEGER,
  warehouse_id INTEGER,
  quantity INTEGER,
  reorder_level INTEGER,
  updated_at TIMESTAMP
);

INSERT INTO ducklake.main.inventory
SELECT
  (p.id - 1) * 12 + w.id,
  p.id,
  w.id,
  (p.id * w.id * 31) % 500,
  20,
  TIMESTAMP '2026-01-01 00:00:00' - ((p.id * w.id) % 30) * INTERVAL 1 DAY
FROM ducklake.main.products AS p
CROSS JOIN ducklake.main.warehouses AS w;

CREATE TABLE ducklake.main.events (
  id INTEGER,
  event_name VARCHAR,
  distinct_id VARCHAR,
  properties VARCHAR,
  event_timestamp TIMESTAMP,
  session_id VARCHAR,
  page_url VARCHAR
);

INSERT INTO ducklake.main.events
SELECT
  i,
  (ARRAY['page_view', 'page_view', 'page_view', 'button_click', 'signup', 'add_to_cart', 'checkout_started', 'purchase', 'search', 'error'])[1 + (i % 10)],
  'user_' || lpad((1 + (i * 31) % 20000)::VARCHAR, 5, '0'),
  '{"page":"/p/' || (i % 50) || '","variant":"' || (ARRAY['a', 'b', 'c'])[1 + (i % 3)] || '","value":' || (i % 100) || '}',
  TIMESTAMP '2025-01-01 00:00:00' + (i % 365) * INTERVAL 1 DAY + (i % 86400) * INTERVAL 1 SECOND,
  'sess_' || lpad((1 + (i * 7) % 50000)::VARCHAR, 6, '0'),
  (ARRAY['/', '/pricing', '/docs', '/blog', '/products', '/checkout', '/settings'])[1 + (i % 7)]
FROM generate_series(1, 500000) AS t(i);

CREATE TABLE ducklake.main.page_views (
  id INTEGER,
  visitor_id VARCHAR,
  page_path VARCHAR,
  referrer VARCHAR,
  user_agent VARCHAR,
  duration_seconds INTEGER,
  view_timestamp TIMESTAMP
);

INSERT INTO ducklake.main.page_views
SELECT
  i,
  'v_' || lpad((1 + (i * 19) % 80000)::VARCHAR, 6, '0'),
  (ARRAY['/', '/pricing', '/docs', '/blog', '/products', '/checkout', '/settings', '/about'])[1 + (i % 8)],
  (ARRAY['https://google.com', 'https://github.com', 'https://twitter.com', 'https://linkedin.com', 'direct'])[1 + (i % 5)],
  (ARRAY['Mozilla/5.0 Chrome/131', 'Mozilla/5.0 Safari/18', 'Mozilla/5.0 Firefox/133', 'Mozilla/5.0 Edge/131'])[1 + (i % 4)],
  (i * 41) % 1800,
  TIMESTAMP '2025-06-01 00:00:00' + (i % 180) * INTERVAL 1 DAY + (i % 86400) * INTERVAL 1 SECOND
FROM generate_series(1, 400000) AS t(i);

CREATE TABLE ducklake.main.support_tickets (
  id INTEGER,
  customer_id INTEGER,
  order_id INTEGER,
  subject VARCHAR,
  priority VARCHAR,
  status VARCHAR,
  created_at TIMESTAMP,
  resolved_at TIMESTAMP
);

INSERT INTO ducklake.main.support_tickets
SELECT
  i,
  1 + (i * 13) % 20000,
  1 + (i * 29) % 120000,
  (ARRAY['Refund request', 'Late delivery', 'Damaged item', 'Wrong item', 'Payment issue', 'Account question'])[1 + (i % 6)] || ' #' || i,
  (ARRAY['low', 'medium', 'high', 'urgent'])[1 + (i % 4)],
  (ARRAY['open', 'pending', 'resolved', 'closed'])[1 + (i % 4)],
  TIMESTAMP '2025-07-01 00:00:00' + (i % 180) * INTERVAL 1 DAY + (i % 86400) * INTERVAL 1 SECOND,
  CASE
    WHEN i % 4 IN (2, 3) THEN TIMESTAMP '2025-07-01 00:00:00' + (i % 180) * INTERVAL 1 DAY + (i % 86400 + 7200) * INTERVAL 1 SECOND
    ELSE NULL
  END
FROM generate_series(1, 8000) AS t(i);

SELECT table_name, row_count
FROM (
  SELECT 'categories' AS table_name, COUNT(*) AS row_count FROM ducklake.main.categories
  UNION ALL SELECT 'suppliers', COUNT(*) FROM ducklake.main.suppliers
  UNION ALL SELECT 'warehouses', COUNT(*) FROM ducklake.main.warehouses
  UNION ALL SELECT 'products', COUNT(*) FROM ducklake.main.products
  UNION ALL SELECT 'customers', COUNT(*) FROM ducklake.main.customers
  UNION ALL SELECT 'employees', COUNT(*) FROM ducklake.main.employees
  UNION ALL SELECT 'orders', COUNT(*) FROM ducklake.main.orders
  UNION ALL SELECT 'order_items', COUNT(*) FROM ducklake.main.order_items
  UNION ALL SELECT 'payments', COUNT(*) FROM ducklake.main.payments
  UNION ALL SELECT 'inventory', COUNT(*) FROM ducklake.main.inventory
  UNION ALL SELECT 'events', COUNT(*) FROM ducklake.main.events
  UNION ALL SELECT 'page_views', COUNT(*) FROM ducklake.main.page_views
  UNION ALL SELECT 'support_tickets', COUNT(*) FROM ducklake.main.support_tickets
) AS counts
ORDER BY row_count DESC;
