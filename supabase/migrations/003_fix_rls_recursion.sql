-- Break the RLS recursion cycle between `diagrams` and `diagram_collaborators`.
-- Policies on each table subquery the other, so Postgres rejects every query
-- with "infinite recursion detected in policy".
--
-- Fix: security-definer helper functions (they run as the table owner, so RLS
-- is not re-evaluated inside them) and rewrite the cross-referencing policies
-- to call the helpers instead of subquerying tables directly.

-- View access: owner, or public diagram, or collaborator with any role
create or replace function public.can_view_diagram(p_diagram uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from diagrams d
        where d.id = p_diagram
        and (
            d.owner_id = auth.uid()
            or d.is_public = true
            or exists (
                select 1 from diagram_collaborators c
                where c.diagram_id = d.id and c.user_id = auth.uid()
            )
        )
    );
$$;

-- Edit access: owner, or collaborator with owner/editor role
create or replace function public.can_edit_diagram(p_diagram uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from diagrams d
        where d.id = p_diagram
        and (
            d.owner_id = auth.uid()
            or exists (
                select 1 from diagram_collaborators c
                where c.diagram_id = d.id
                and c.user_id = auth.uid()
                and c.role in ('owner', 'editor')
            )
        )
    );
$$;

-- Comment access: owner, or collaborator with owner/editor/commenter role
create or replace function public.can_comment_diagram(p_diagram uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from diagrams d
        where d.id = p_diagram
        and (
            d.owner_id = auth.uid()
            or exists (
                select 1 from diagram_collaborators c
                where c.diagram_id = d.id
                and c.user_id = auth.uid()
                and c.role in ('owner', 'editor', 'commenter')
            )
        )
    );
$$;

-- Diagrams
drop policy if exists "Collaborators can view diagrams" on diagrams;
create policy "Users can view accessible diagrams" on diagrams
    for select using (public.can_view_diagram(id));

drop policy if exists "Owners and editors can update diagrams" on diagrams;
create policy "Owners and editors can update diagrams" on diagrams
    for update using (public.can_edit_diagram(id));

-- Diagram versions
drop policy if exists "Version access follows diagram access" on diagram_versions;
create policy "Version access follows diagram access" on diagram_versions
    for select using (public.can_view_diagram(diagram_id));

drop policy if exists "Editors can insert versions" on diagram_versions;
create policy "Editors can insert versions" on diagram_versions
    for insert with check (public.can_edit_diagram(diagram_id));

-- Collaborators
drop policy if exists "Owners can manage collaborators" on diagram_collaborators;
create policy "Owners can manage collaborators" on diagram_collaborators
    for all using (public.can_edit_diagram(diagram_id));

-- Presence
drop policy if exists "Presence visible to diagram collaborators" on presence;
create policy "Presence visible to diagram collaborators" on presence
    for select using (public.can_view_diagram(diagram_id));

-- Comments
drop policy if exists "Comments visible to collaborators" on comments;
create policy "Comments visible to collaborators" on comments
    for select using (public.can_view_diagram(diagram_id));

drop policy if exists "Editors and commenters can insert comments" on comments;
create policy "Editors and commenters can insert comments" on comments
    for insert with check (public.can_comment_diagram(diagram_id));

-- AI generations
drop policy if exists "AI generations visible to collaborators" on ai_generations;
create policy "AI generations visible to collaborators" on ai_generations
    for select using (public.can_view_diagram(diagram_id));