-- Fix the profile creation trigger from migration 001.
-- The original used `text or text` (invalid in Postgres), which aborts
-- every signup with "Database error saving new user".
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, username, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', new.email),
        new.raw_user_meta_data->>'avatar_url'
    );
    return new;
end $$;

-- The username column is unique; make sure email-based fallbacks never
-- collide (email addresses are globally unique in auth.users).
alter table public.profiles
    drop constraint if exists profiles_username_key;
alter table public.profiles
    add constraint profiles_username_key unique (username);