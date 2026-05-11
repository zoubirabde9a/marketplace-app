-- Add city to seller_profiles. Best-practice marketplace listings carry a
-- store location alongside phone/website so buyers can filter by region and
-- understand shipping distance. Country lives at the org level (already
-- exists in identity.organizations.country_code).
ALTER TABLE seller.seller_profiles ADD COLUMN city varchar(120);
