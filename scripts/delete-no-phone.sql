BEGIN;

CREATE TEMP TABLE doomed_products ON COMMIT DROP AS
WITH digits AS (
  SELECT id, regexp_replace(coalesce(description_raw,'') || ' ' || coalesce(title_raw,''), '[^0-9]', '', 'g') AS d
  FROM catalog.products
)
SELECT id FROM digits
WHERE d !~ '0[567][0-9]{8}'
  AND d !~ '213[567][0-9]{8}'
  AND id NOT IN (
    SELECT pv.product_id
    FROM catalog.product_variants pv
    JOIN "order".order_items oi ON oi.variant_id = pv.id
  );

SELECT count(*) AS will_delete FROM doomed_products;

DELETE FROM cart.cart_items WHERE variant_id IN (
  SELECT pv.id FROM catalog.product_variants pv JOIN doomed_products d ON pv.product_id = d.id
);

DELETE FROM catalog.products WHERE id IN (SELECT id FROM doomed_products);

SELECT count(*) AS remaining FROM catalog.products;

COMMIT;
