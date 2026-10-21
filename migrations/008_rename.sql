INSERT INTO permissions (key, description) VALUES ('users.rename', 'Change the username of a member');
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'users.rename' FROM roles r WHERE r.key IN ('administrator', 'owner');
