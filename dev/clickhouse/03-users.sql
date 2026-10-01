-- The read-only users a quanthea connector can use: dash_ro has SELECT grants only (the connector
-- makes each query read-only), dash_ro_2 has readonly=2. dash_ro_1 has readonly=1, which refuses
-- the settings the connector sets, so its connection test fails. quanthea_admin, from the image's
-- settings, owns the database and can write.
CREATE USER dash_ro IDENTIFIED BY 'dash-ro-dev';
CREATE USER dash_ro_2 IDENTIFIED BY 'dash-ro-dev' SETTINGS readonly = 2;
CREATE USER dash_ro_1 IDENTIFIED BY 'dash-ro-dev' SETTINGS readonly = 1;
GRANT SELECT ON orders.* TO dash_ro, dash_ro_2, dash_ro_1;
