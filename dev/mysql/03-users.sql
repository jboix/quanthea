-- dash_ro: the read-only user the querent connector should use. It can read every table and write
-- none, so the connector test reports it as read-only. querent_admin, from the image's settings,
-- owns the database and can write.
CREATE USER 'dash_ro'@'%' IDENTIFIED BY 'dash-ro-dev';
GRANT SELECT ON orders.* TO 'dash_ro'@'%';
