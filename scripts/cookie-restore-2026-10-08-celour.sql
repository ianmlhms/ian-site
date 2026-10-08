-- celour: rebuilt from best score 522,858,754 (scores table) + simulated buildings;
-- bank = simulated 65.46M + 100M consolation ("Trost"). tb stays at the real best.
update public.game_saves
   set data = '{"v":1,"c":165461478,"tb":522858754,"tc":17480,"u":[14,17,17,14,12,8,7,6,4,1,0,0,0,0,0,0],"cu":[33,29,24,17,12,5]}'::jsonb,
       updated_at = now()
 where user_id = 'e398ccef-1372-4155-886c-e5c2e5912a62' and game_id = 'cookie-clicker';
select data, updated_at from public.game_saves where user_id = 'e398ccef-1372-4155-886c-e5c2e5912a62' and game_id = 'cookie-clicker';
