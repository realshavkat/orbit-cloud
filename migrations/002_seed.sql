-- Roles, permissions, badge catalog, supporter tiers and default settings.

INSERT INTO roles (key, name, rank) VALUES
  ('user', 'User', 0),
  ('supporter', 'Supporter', 10),
  ('moderator', 'Moderator', 50),
  ('administrator', 'Administrator', 80),
  ('owner', 'Owner', 100);

INSERT INTO permissions (key, description) VALUES
  ('users.read', 'Search accounts and open their admin view'),
  ('users.read_email', 'See e-mail addresses in the admin view'),
  ('users.suspend', 'Suspend and reactivate accounts'),
  ('users.sessions', 'Revoke the sessions of an account'),
  ('users.notes', 'Read and write internal notes'),
  ('roles.moderators', 'Grant and remove the moderator role'),
  ('roles.administrators', 'Grant and remove the administrator role'),
  ('badges.award', 'Award and revoke ordinary badges'),
  ('badges.official', 'Award and revoke official badges'),
  ('badges.manage', 'Create and edit badges and their rules'),
  ('reports.read', 'Read reports'),
  ('reports.handle', 'Resolve and dismiss reports'),
  ('moderation.act', 'Warn, hide profiles and suspend community features'),
  ('donations.read', 'See donations and webhook events'),
  ('donations.settings', 'Change suggested amounts and supporter tiers'),
  ('audit.read', 'Read the audit log'),
  ('stats.read', 'See aggregated statistics'),
  ('settings.manage', 'Change community settings');

-- Least privilege: each role lists its permissions explicitly, nothing is inherited.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p WHERE
  (r.key = 'moderator' AND p.key IN ('reports.read', 'reports.handle', 'moderation.act'))
  OR (r.key = 'administrator' AND p.key IN ('users.read', 'users.suspend', 'users.sessions', 'users.notes', 'roles.moderators',
      'badges.award', 'reports.read', 'reports.handle', 'moderation.act', 'stats.read'))
  OR r.key = 'owner';

INSERT INTO badge_categories (key, name, sort) VALUES
  ('official', 'Official', 1), ('support', 'Support', 2), ('community', 'Community', 3), ('seniority', 'Seniority', 4),
  ('event', 'Event', 5), ('contribution', 'Contribution', 6), ('creator', 'Content creation', 7), ('beta', 'Beta testing', 8),
  ('trust', 'Security and trust', 9), ('special', 'Special rewards', 10);

INSERT INTO badges (key, name, description, icon, category_key, rarity, color, official, protected, manual_award, permanent, condition) VALUES
  ('founder', 'Founder', 'Created Orbit.', 'rocket', 'official', 'exclusive', '#f5c518', true, true, false, true,
   'Given once, to the original owner of Orbit, when the service is set up. It cannot be bought, moved or given by an administrator.'),
  ('administrator', 'Administrator', 'Member of the Orbit administration team.', 'shield-check', 'official', 'exclusive', '#ff5d5d', true, false, false, false,
   'Follows the administrator role: added with it, removed with it. The badge itself grants no permission.'),
  ('moderator', 'Moderator', 'Keeps the Orbit community safe.', 'shield', 'official', 'legendary', '#3ddc97', true, false, false, false,
   'Follows the moderator role. The badge itself grants no permission.'),
  ('developer', 'Developer', 'Officially recognised Orbit developer.', 'code', 'official', 'legendary', '#4f8cff', true, false, true, true,
   'Given by the owner to recognised developers.'),
  ('verified', 'Verified', 'Identity or official status checked by the Orbit team.', 'circle-check', 'trust', 'epic', '#4f8cff', true, false, true, true,
   'Given after a manual identity check. Never given for a donation.'),
  ('early_supporter', 'Early Supporter', 'Supported Orbit in its early days.', 'sparkles', 'support', 'legendary', '#a66bff', false, false, false, true,
   'A confirmed donation during the early support period set by the owner.'),
  ('beta_tester', 'Beta Tester', 'Took part in an official Orbit beta.', 'flask-conical', 'beta', 'rare', '#ff9f43', false, false, true, true,
   'Recorded participation in an official beta.'),
  ('bug_hunter', 'Bug Hunter', 'Reported a valid bug or vulnerability.', 'bug', 'contribution', 'epic', '#ff6bcb', false, false, true, true,
   'A report confirmed by the team.'),
  ('contributor', 'Contributor', 'Made a significant contribution to Orbit.', 'git-branch', 'contribution', 'epic', '#3ddc97', false, false, true, true,
   'A contribution reviewed by the team.'),
  ('supporter', 'Supporter', 'Supports Orbit with a donation.', 'heart', 'support', 'common', '#ff6b8a', false, false, false, true,
   'A first confirmed donation that was not fully refunded.'),
  ('supporter_bronze', 'Bronze Supporter', 'Generous support for Orbit.', 'heart', 'support', 'rare', '#cd7f32', false, false, false, true,
   'Total confirmed donations, net of refunds, reach the Bronze threshold.'),
  ('supporter_silver', 'Silver Supporter', 'Strong support for Orbit.', 'heart', 'support', 'rare', '#c0c0c8', false, false, false, true,
   'Total confirmed donations, net of refunds, reach the Silver threshold.'),
  ('supporter_gold', 'Gold Supporter', 'Major support for Orbit.', 'heart', 'support', 'epic', '#f5c518', false, false, false, true,
   'Total confirmed donations, net of refunds, reach the Gold threshold.'),
  ('supporter_platinum', 'Platinum Supporter', 'Exceptional support for Orbit.', 'gem', 'support', 'legendary', '#b8e4ff', false, false, false, true,
   'Total confirmed donations, net of refunds, reach the Platinum threshold.'),
  ('supporter_monthly', 'Monthly Supporter', 'Supports Orbit every month.', 'calendar-heart', 'support', 'rare', '#ff6b8a', false, false, false, false,
   'An active monthly donation. Removed when it ends or is unpaid.'),
  ('supporter_lifetime', 'Lifetime Supporter', 'A special thank-you from the Orbit team.', 'infinity', 'support', 'exclusive', '#f5c518', false, false, true, true,
   'Given by the owner, for support over the long term.');

-- Net amount = confirmed donations minus refunds, in euro cents.
INSERT INTO supporter_tiers (key, badge_key, threshold_cents, sort) VALUES
  ('bronze', 'supporter_bronze', 2500, 1),
  ('silver', 'supporter_silver', 5000, 2),
  ('gold', 'supporter_gold', 10000, 3),
  ('platinum', 'supporter_platinum', 25000, 4);

INSERT INTO badge_rules (badge_id, rule_type, params)
SELECT id, 'donation_first', '{}'::jsonb FROM badges WHERE key = 'supporter'
UNION ALL SELECT id, 'donation_total', '{"tier":"bronze"}'::jsonb FROM badges WHERE key = 'supporter_bronze'
UNION ALL SELECT id, 'donation_total', '{"tier":"silver"}'::jsonb FROM badges WHERE key = 'supporter_silver'
UNION ALL SELECT id, 'donation_total', '{"tier":"gold"}'::jsonb FROM badges WHERE key = 'supporter_gold'
UNION ALL SELECT id, 'donation_total', '{"tier":"platinum"}'::jsonb FROM badges WHERE key = 'supporter_platinum'
UNION ALL SELECT id, 'subscription_active', '{}'::jsonb FROM badges WHERE key = 'supporter_monthly'
UNION ALL SELECT id, 'role', '{"role":"administrator"}'::jsonb FROM badges WHERE key = 'administrator'
UNION ALL SELECT id, 'role', '{"role":"moderator"}'::jsonb FROM badges WHERE key = 'moderator'
UNION ALL SELECT id, 'donation_first', '{"before":null}'::jsonb FROM badges WHERE key = 'early_supporter';

INSERT INTO app_settings (key, value) VALUES
  ('donation_amounts', '[200, 500, 1000, 2500]'),
  ('donation_currency', '"eur"'),
  -- Early Supporter: confirmed donations before this date (null = period closed).
  ('early_supporter_until', 'null');
