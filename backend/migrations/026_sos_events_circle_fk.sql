-- 026: Add the missing FK from sos_events.circle_id to circles(id).
-- Sibling event tables (checkins, chat_messages) already cascade-delete on
-- their owning circle; sos_events never had this constraint, so deleting a
-- circle left its SOS history permanently orphaned — still counted in
-- admin dashboards and GET /admin/sos with no owning circle.
--
-- Null out any already-orphaned circle_id first (from circles deleted
-- before this constraint existed) so the ADD CONSTRAINT below can succeed.
UPDATE sos_events SET circle_id = NULL
 WHERE circle_id IS NOT NULL
   AND circle_id NOT IN (SELECT id FROM circles);

ALTER TABLE sos_events
  ADD CONSTRAINT sos_events_circle_id_fkey
  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE;
