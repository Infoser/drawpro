-- DrawPro Database Schema
-- Migration: 001_initial_schema

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table (extends Supabase Auth users)
create table profiles (
    id uuid references auth.users on delete cascade primary key,
    username text unique not null,
    avatar_url text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Diagrams table
create table diagrams (
    id uuid primary key default gen_random_uuid(),
    title text not null default 'Untitled Diagram',
    owner_id uuid references profiles(id) on delete cascade not null,
    is_public boolean default false,
    thumbnail_url text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Diagram versions (for version history and real-time sync)
create table diagram_versions (
    id uuid primary key default gen_random_uuid(),
    diagram_id uuid references diagrams(id) on delete cascade not null,
    version integer not null,
    nodes jsonb not null default '[]',
    edges jsonb not null default '[]',
    viewport jsonb,
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz default now(),
    unique(diagram_id, version)
);

-- Diagram collaborators (sharing permissions)
create table diagram_collaborators (
    diagram_id uuid references diagrams(id) on delete cascade not null,
    user_id uuid references profiles(id) on delete cascade not null,
    role text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
    invited_by uuid references profiles(id) on delete set null,
    created_at timestamptz default now(),
    primary key (diagram_id, user_id)
);

-- Real-time presence (ephemeral, TTL-based cleanup)
create table presence (
    id uuid primary key default gen_random_uuid(),
    diagram_id uuid references diagrams(id) on delete cascade not null,
    user_id uuid references profiles(id) on delete cascade not null,
    cursor_x float,
    cursor_y float,
    selection jsonb,
    last_seen timestamptz default now()
);

-- Comments on diagram elements
create table comments (
    id uuid primary key default gen_random_uuid(),
    diagram_id uuid references diagrams(id) on delete cascade not null,
    user_id uuid references profiles(id) on delete cascade not null,
    node_id text, -- null = canvas comment
    content text not null,
    resolved boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- AI generation history
create table ai_generations (
    id uuid primary key default gen_random_uuid(),
    diagram_id uuid references diagrams(id) on delete cascade not null,
    user_id uuid references profiles(id) on delete cascade not null,
    prompt text not null,
    response jsonb not null,
    model text not null,
    tokens_used integer,
    created_at timestamptz default now()
);

-- Indexes
create index idx_diagrams_owner on diagrams(owner_id);
create index idx_diagrams_public on diagrams(is_public) where is_public = true;
create index idx_diagram_versions_diagram on diagram_versions(diagram_id, version desc);
create index idx_diagram_collaborators_user on diagram_collaborators(user_id);
create index idx_presence_diagram on presence(diagram_id);
create index idx_comments_diagram on comments(diagram_id);
create index idx_ai_generations_diagram on ai_generations(diagram_id);

-- Enable Row Level Security
alter table profiles enable row level security;
alter table diagrams enable row level security;
alter table diagram_versions enable row level security;
alter table diagram_collaborators enable row level security;
alter table presence enable row level security;
alter table comments enable row level security;
alter table ai_generations enable row level security;

-- RLS Policies

-- Profiles: users can view all profiles, update own
create policy "Profiles are viewable by everyone" on profiles
    for select using (true);

create policy "Users can update own profile" on profiles
    for update using (auth.uid() = id);

-- Diagrams: owners and collaborators can view
create policy "Owners can view own diagrams" on diagrams
    for select using (auth.uid() = owner_id);

create policy "Collaborators can view diagrams" on diagrams
    for select using (
        exists (
            select 1 from diagram_collaborators
            where diagram_id = diagrams.id
            and user_id = auth.uid()
        )
    );

create policy "Public diagrams are viewable" on diagrams
    for select using (is_public = true);

create policy "Owners can insert diagrams" on diagrams
    for insert with check (auth.uid() = owner_id);

create policy "Owners and editors can update diagrams" on diagrams
    for update using (
        auth.uid() = owner_id
        or exists (
            select 1 from diagram_collaborators
            where diagram_id = diagrams.id
            and user_id = auth.uid()
            and role in ('owner', 'editor')
        )
    );

create policy "Owners can delete diagrams" on diagrams
    for delete using (auth.uid() = owner_id);

-- Diagram versions: same as diagrams
create policy "Version access follows diagram access" on diagram_versions
    for select using (
        exists (
            select 1 from diagrams
            where id = diagram_versions.diagram_id
            and (
                owner_id = auth.uid()
                or is_public = true
                or exists (
                    select 1 from diagram_collaborators
                    where diagram_id = diagrams.id
                    and user_id = auth.uid()
                )
            )
        )
    );

create policy "Editors can insert versions" on diagram_versions
    for insert with check (
        exists (
            select 1 from diagrams
            where id = diagram_versions.diagram_id
            and (
                owner_id = auth.uid()
                or exists (
                    select 1 from diagram_collaborators
                    where diagram_id = diagrams.id
                    and user_id = auth.uid()
                    and role in ('owner', 'editor')
                )
            )
        )
    );

-- Collaborators: owners can manage, users can view their own
create policy "Owners can manage collaborators" on diagram_collaborators
    for all using (
        exists (
            select 1 from diagrams
            where id = diagram_collaborators.diagram_id
            and owner_id = auth.uid()
        )
    );

create policy "Users can view their collaborations" on diagram_collaborators
    for select using (user_id = auth.uid());

-- Presence: users can manage their own presence
create policy "Users can manage own presence" on presence
    for all using (user_id = auth.uid());

create policy "Presence visible to diagram collaborators" on presence
    for select using (
        exists (
            select 1 from diagrams
            where id = presence.diagram_id
            and (
                owner_id = auth.uid()
                or exists (
                    select 1 from diagram_collaborators
                    where diagram_id = diagrams.id
                    and user_id = auth.uid()
                )
            )
        )
    );

-- Comments: collaborators can view, editors/commenters can insert
create policy "Comments visible to collaborators" on comments
    for select using (
        exists (
            select 1 from diagrams
            where id = comments.diagram_id
            and (
                owner_id = auth.uid()
                or is_public = true
                or exists (
                    select 1 from diagram_collaborators
                    where diagram_id = diagrams.id
                    and user_id = auth.uid()
                )
            )
        )
    );

create policy "Editors and commenters can insert comments" on comments
    for insert with check (
        exists (
            select 1 from diagrams
            where id = comments.diagram_id
            and (
                owner_id = auth.uid()
                or exists (
                    select 1 from diagram_collaborators
                    where diagram_id = diagrams.id
                    and user_id = auth.uid()
                    and role in ('owner', 'editor', 'commenter')
                )
            )
        )
    );

create policy "Users can update own comments" on comments
    for update using (user_id = auth.uid());

create policy "Users can delete own comments" on comments
    for delete using (user_id = auth.uid());

-- AI Generations: owners and collaborators can view
create policy "AI generations visible to collaborators" on ai_generations
    for select using (
        exists (
            select 1 from diagrams
            where id = ai_generations.diagram_id
            and (
                owner_id = auth.uid()
                or exists (
                    select 1 from diagram_collaborators
                    where diagram_id = diagrams.id
                    and user_id = auth.uid()
                )
            )
        )
    );

create policy "Users can insert own AI generations" on ai_generations
    for insert with check (auth.uid() = user_id);

-- Updated_at triggers
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

create trigger update_profiles_updated_at
    before update on profiles
    for each row execute function update_updated_at_column();

create trigger update_diagrams_updated_at
    before update on diagrams
    for each row execute function update_updated_at_column();

create trigger update_comments_updated_at
    before update on comments
    for each row execute function update_updated_at_column();

-- Function to create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, username, avatar_url)
    values (new.id, new.raw_user_meta_data->>'username' or new.email, new.raw_user_meta_data->>'avatar_url');
    return new;
end $$;

-- Trigger on auth.users insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();