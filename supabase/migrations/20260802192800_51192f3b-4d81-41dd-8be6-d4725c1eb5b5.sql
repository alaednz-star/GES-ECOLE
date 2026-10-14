-- Originally granted the administrator role to the first deployment's owner, matched by a
-- personal e-mail address. Removed from Gestion École: a product must not carry anyone's
-- address. It had no effect on a new installation anyway -- `auth.users` is empty when
-- migrations run -- and the first administrator is created by `handle_new_user()`
-- (first-admin rule, see DEPLOYMENT.md). Kept as a no-op so the migration history keeps its
-- version.
SELECT 1;
