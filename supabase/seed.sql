-- DrawPro Development Seed Data
-- Run after migrations: psql -f supabase/seed.sql

-- Note: Users must be created via Supabase Auth first
-- This seed assumes two test users exist with known IDs
-- Replace these UUIDs with actual user IDs from auth.users

-- Example: Insert test users into profiles (after they sign up)
-- insert into profiles (id, username, avatar_url) values
--     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'testuser1', 'https://api.dicebear.com/7.x/avataaars/svg?seed=test1'),
--     ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'testuser2', 'https://api.dicebear.com/7.x/avataaars/svg?seed=test2');

-- Example: Insert a sample diagram (replace with actual owner_id)
-- insert into diagrams (id, title, owner_id, is_public) values
--     ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sample Flowchart', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Example: Insert initial version for sample diagram
-- insert into diagram_versions (diagram_id, version, nodes, edges, viewport, created_by) values
--     ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1,
--      '[]'::jsonb, '[]'::jsonb,
--      '{"x":0,"y":0,"zoom":1}'::jsonb,
--      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Note: In production, use the Supabase dashboard or API to create test data
-- This file documents the expected data structure for development