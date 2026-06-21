-- Admin user management: list users, delete user, set/reset password.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Needs is_admin() (messenger-setup-v2.sql).
--
-- NOTE: passwords are bcrypt-hashed and can NEVER be read back. "Reset" means the
-- admin sets a NEW known password and shares it with the user.

create extension if not exists pgcrypto with schema extensions;

-- List every registered user (admin only).
create or replace function public.admin_list_users()
returns table(id uuid, email text, username text, created_at timestamptz,
              last_sign_in_at timestamptz, confirmed boolean)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, p.username, u.created_at, u.last_sign_in_at,
         (u.email_confirmed_at is not null)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where public.is_admin()
  order by u.created_at desc;
$$;
grant execute on function public.admin_list_users() to authenticated;

-- Delete a user and all their data (admin only).
create or replace function public.admin_delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot delete your own admin account'; end if;
  delete from auth.users where id = p_user_id;   -- cascades profiles/scores/memberships/messages
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Set a NEW password for a user (admin only). Also confirms the email so the new
-- password works immediately for sign-in.
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if char_length(p_password) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end; $$;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
