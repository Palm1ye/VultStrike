-- Delete all users and related data
-- Run this only when you want to reset all user data
-- WARNING: This will delete ALL data including matches, queue tickets, and sessions

-- Delete in order to respect foreign key constraints
DELETE FROM match_participant;
DELETE FROM queue_ticket;
DELETE FROM user_session;
DELETE FROM match;
DELETE FROM "user";

-- Reset any sequences if needed
-- ALTER SEQUENCE match_participant_id_seq RESTART WITH 1;
