-- The backend reads learning_resources with the anon key. The old policy only
-- showed rows whose status is exactly 'active', so catalogue rows marked
-- 'Active', 'Active/Review' or 'Generated - Review Needed' were invisible and
-- never recommended. Hide only retired rows, in any case; these are the
-- statuses the recommender treats as inactive (INACTIVE_RESOURCE_STATUSES).
drop policy if exists "Anyone can read active learning resources" on public.learning_resources;
create policy "Anyone can read active learning resources" on public.learning_resources
  for select using (
    lower(coalesce(status, 'active')) not in ('inactive', 'retired', 'archived', 'deprecated', 'removed', 'rejected')
  );
