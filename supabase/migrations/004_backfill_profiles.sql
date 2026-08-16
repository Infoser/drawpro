-- Backfill profiles for any users created before the handle_new_user
-- trigger was fixed (migration 002), e.g. smoketest@drawpro.app.
insert into public.profiles (id, username, avatar_url)
select
    u.id,
    coalesce(u.raw_user_meta_data->>'username', u.email),
    u.raw_user_meta_data->>'avatar_url'
from auth.users u
where not exists (
    select 1 from public.profiles p where p.id = u.id
);