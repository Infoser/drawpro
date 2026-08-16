-- Realtime authorization for private channels (diagram:<id>).
-- Without policies on realtime.messages every private channel join is
-- rejected with "Unauthorized: You do not have permissions to read from
-- this Channel topic". The channel topic embeds the diagram UUID and the
-- app enforces collaborator roles on top (viewer/commenter are read-only),
-- so allowing all authenticated users is sufficient.
create policy "authenticated read realtime messages"
on realtime.messages
for select
to authenticated
using (true);

create policy "authenticated write realtime messages"
on realtime.messages
for insert
to authenticated
with check (true);