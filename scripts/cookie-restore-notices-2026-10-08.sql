-- Tell the 7 players whose Cookie Clicker progress was restored (8 Oct 2026).
insert into public.user_notices (user_id, title, body, cta, url)
select p.id,
  '{"lb":"🍪 Däi Cookie Clicker ass erëm do!","de":"🍪 Dein Cookie Clicker ist wieder da!","en":"🍪 Your Cookie Clicker is back!"}',
  '{"lb":"Duerch e Feeler war däin Spillstand am Cookie Clicker verluer. Mir hunn en erëmhiergestallt – an als Entschëllegung kriss du extra Cookies an eng ⏳ Time Machine dobäi. Vill Spaass!","de":"Durch einen Fehler war dein Spielstand im Cookie Clicker verloren. Wir haben ihn wiederhergestellt – und als Entschuldigung bekommst du extra Cookies und eine ⏳ Time Machine dazu. Viel Spaß!","en":"A bug wiped your Cookie Clicker progress. We have restored it – and as a sorry you get extra cookies and a ⏳ Time Machine on top. Have fun!"}',
  '{"lb":"Spillen","de":"Spielen","en":"Play"}',
  '/pixelbreak.html?g=cookie-clicker'
from public.profiles p
where p.username in ('Celour','gigidalessio','Benji','GanLo390','Mika1','Emma2','Noga Boga')
  and not exists (select 1 from public.user_notices n where n.user_id = p.id and n.url = '/pixelbreak.html?g=cookie-clicker');
select count(*) from public.user_notices where url = '/pixelbreak.html?g=cookie-clicker';
