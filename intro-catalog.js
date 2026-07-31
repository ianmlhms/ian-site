/* Intro — verified song catalogue.
 *
 * Each entry is an iTunes trackId that was confirmed to exist in the LU
 * store AND to have a preview URL. Titles are stored here so the answer
 * choices can be rendered without a network round-trip; only the preview
 * and artwork URLs are fetched at runtime, in ONE batch lookup for the
 * whole round — the iTunes API throttles hard (HTTP 403 at roughly 20
 * requests/minute), so per-song requests are not an option.
 *
 * Regenerate with scripts/intro-resolve.js when adding songs.
 */
window.INTRO_CATALOG = [
  { id: 'charts', name: 'Charts', emoji: '🔥', songs: [
    { id: 1739659142, t: 'BIRDS OF A FEATHER', a: 'Billie Eilish' },
    { id: 1744253558, t: 'Espresso', a: 'Sabrina Carpenter' },
    { id: 1691699836, t: 'Lose Control', a: 'Teddy Swims' },
    { id: 1724488124, t: 'Beautiful Things', a: 'Benson Boone' },
    { id: 1738512902, t: 'Too Sweet', a: 'Hozier' },
    { id: 1632285403, t: 'Stick Season', a: 'Noah Kahan' },
    { id: 1737497080, t: 'Good Luck, Babe!', a: 'Chappell Roan' },
    { id: 1714502827, t: 'Houdini', a: 'Dua Lipa' },
    { id: 1706942560, t: 'greedy', a: 'Tate McRae' },
    { id: 1615585008, t: 'As It Was', a: 'Harry Styles' },
    { id: 1488408568, t: 'Blinding Lights', a: 'The Weeknd' },
    { id: 1674691586, t: 'Flowers', a: 'Miley Cyrus' },
    { id: 1658650488, t: 'Kill Bill', a: 'SZA' },
    { id: 1705257405, t: 'Paint The Town Red', a: 'Doja Cat' },
    { id: 1694768031, t: 'vampire', a: 'Olivia Rodrigo' }
  ] },
  { id: '2000er', name: '2000er', emoji: '📀', songs: [
    { id: 1122773680, t: 'Viva La Vida', a: 'Coldplay' },
    { id: 1441154437, t: 'Umbrella (feat. JAŸ-Z)', a: 'Rihanna' },
    { id: 145544307, t: 'Crazy', a: 'Gnarls Barkley' },
    { id: 1774799818, t: 'Hey Ya!', a: 'Outkast' },
    { id: 1442846328, t: 'Stronger', a: 'Kanye West' },
    { id: 1442464133, t: 'Say It Right', a: 'Nelly Furtado' },
    { id: 1422677781, t: 'Rehab', a: 'Amy Winehouse' },
    { id: 1526194192, t: 'Mr. Brightside', a: 'The Killers' },
    { id: 1526170285, t: 'In the End', a: 'LINKIN PARK' },
    { id: 1440903439, t: 'Lose Yourself', a: 'Eminem' },
    { id: 250776858, t: 'Crazy In Love', a: 'Beyoncé' },
    { id: 386153478, t: 'Yeah! (feat. Lil Jon & Ludacris)', a: 'USHER' },
    { id: 983095097, t: 'Boulevard of Broken Dreams', a: 'Rockabye Baby!' },
    { id: 1615142635, t: 'Where Is The Love?', a: 'Black Eyed Peas' },
    { id: 315025823, t: 'Complicated', a: 'Avril Lavigne' }
  ] },
  { id: '2010er', name: '2010er', emoji: '💿', songs: [
    { id: 984607460, t: 'Uptown Funk (feat. Bruno Mars)', a: 'Mark Ronson' },
    { id: 1193701392, t: 'Shape of You', a: 'Ed Sheeran' },
    { id: 413623677, t: 'Rolling In the Deep', a: 'Adele' },
    { id: 617154366, t: 'Get Lucky', a: 'Daft Punk, Pharrell Williams & Nile Rodgers' },
    { id: 919628212, t: 'Happy (Oktoberfest Mix)', a: 'Pharrell Williams' },
    { id: 1440818664, t: 'Royals', a: 'Lorde' },
    { id: 1440829610, t: 'Sorry', a: 'Justin Bieber' },
    { id: 989874548, t: 'Chandelier', a: 'Sia' },
    { id: 1440860488, t: 'Radioactive', a: 'Imagine Dragons' },
    { id: 1443151925, t: 'Despacito', a: 'Luis Fonsi & Daddy Yankee' },
    { id: 1440843496, t: 'One Dance (feat. Wizkid & Kyla)', a: 'Drake' },
    { id: 1650251086, t: 'Let Her Go', a: 'Passenger' },
    { id: 1807714114, t: 'Wake Me Up', a: 'Avicii' },
    { id: 1030797686, t: 'Summer', a: 'Calvin Harris' },
    { id: 1698404904, t: 'rockstar (feat. 21 Savage)', a: 'Post Malone' }
  ] },
  { id: 'rap', name: 'Rap', emoji: '🎤', songs: [
    { id: 1440907873, t: 'HUMBLE.', a: 'Kendrick Lamar' },
    { id: 1406109863, t: 'God\'s Plan', a: 'Drake' },
    { id: 1421243212, t: 'YOSEMITE', a: 'Travis Scott' },
    { id: 1440821643, t: 'Without Me', a: 'Eminem' },
    { id: 1440877090, t: 'In da Club', a: '50 Cent' },
    { id: 665871847, t: 'Drop It Like It\'s Hot', a: 'Snoop Dogg' },
    { id: 643452627, t: 'Empire State of Mind', a: 'Empire State Of Mind Band' },
    { id: 1449049111, t: 'Bodak Yellow', a: 'AIRDEW' },
    { id: 1456313177, t: 'Old Town Road', a: 'Lil Nas X' },
    { id: 1440889023, t: 'Congratulations (feat. Quavo)', a: 'Post Malone' },
    { id: 1440910489, t: 'Super Bass', a: 'Nicki Minaj' },
    { id: 1440763833, t: 'Gold Digger (feat. Jamie Foxx)', a: 'Kanye West' },
    { id: 1388566993, t: 'Praise The Lord (Da Shine) [feat. Skepta]', a: 'A$AP Rocky' },
    { id: 1577198954, t: 'Mask Off', a: 'Lofi Fruits Music & Formal Chicken' }
  ] },
  { id: 'rock', name: 'Rock', emoji: '🎸', songs: [
    { id: 6781027645, t: 'Bohemian Rhapsody', a: 'Queen' },
    { id: 575998661, t: 'Thunderstruck', a: 'AC/DC' },
    { id: 1440783625, t: 'Smells Like Teen Spirit', a: 'Nirvana' },
    { id: 1377813701, t: 'Sweet Child O\' Mine', a: 'Guns N\' Roses' },
    { id: 902620521, t: 'Stairway to Heaven', a: 'Led Zeppelin' },
    { id: 1571968519, t: 'Enter Sandman', a: 'Metallica' },
    { id: 1441134371, t: 'Hey Jude', a: 'The Beatles' },
    { id: 456794433, t: 'Eye of the Tiger', a: 'Survivor' },
    { id: 1422955211, t: 'Livin\' On a Prayer', a: 'Bon Jovi' },
    { id: 185717604, t: 'Africa', a: 'Toto' },
    { id: 196480329, t: 'The Final Countdown', a: 'Europe' },
    { id: 945575413, t: 'Californication', a: 'Red Hot Chili Peppers' },
    { id: 334812013, t: 'Everlong', a: 'Foo Fighters' },
    { id: 1517447333, t: 'Wonderwall', a: 'Oasis' }
  ] },
  { id: 'film', name: 'Filmmusek', emoji: '🎬', songs: [
    { id: 380350246, t: 'Time', a: 'Hans Zimmer' },
    { id: 158627483, t: 'The Imperial March (From "Star Wars, Episode V: The Empire Strikes Back")', a: 'John Williams & The Skywalker Symphony Orchestra' },
    { id: 716216763, t: 'Gonna Fly Now', a: 'Bill Conti' },
    { id: 724369568, t: 'He\'s a Pirate', a: 'Klaus Badelt' },
    { id: 89285956, t: 'Hedwig\'s Theme', a: 'John Williams' },
    { id: 714571920, t: 'Circle of Life', a: 'Elton John' },
    { id: 1477388275, t: 'Let It Go', a: 'Idina Menzel' },
    { id: 1484413134, t: 'Ghostbusters', a: 'Ray Parker Jr.' },
    { id: 52324180, t: 'Mission: Impossible Theme', a: 'John E. Davis & Lalo Schifrin' },
    { id: 1720641175, t: 'James Bond Theme', a: 'Monty Norman' },
    { id: 1002553802, t: 'Jurassic Park Theme', a: 'The Piano Guys' },
    { id: 1533984393, t: 'Cornfield Chase', a: 'Hans Zimmer' },
    { id: 1450958914, t: 'Chariots of Fire', a: 'Vangelis' }
  ] },
  { id: 'deutschrap', name: 'Deutschrap', emoji: '🇩🇪', songs: [
    { id: 1457682349, t: 'Kein Problem', a: 'Apache 207' },
    { id: 1460798637, t: 'Cherry Lady', a: 'Capital Bra' },
    { id: 1445884388, t: 'Bilder im Kopf', a: 'Sido' },
    { id: 683639109, t: 'Easy', a: 'Sheryl Crow' },
    { id: 1469179655, t: 'ON OFF (feat. Maître Gims)', a: 'Shirin David' },
    { id: 1339295228, t: 'Was Du Liebe nennst', a: 'Bausa' },
    { id: 934774366, t: 'Erfolg ist kein Glück', a: 'Kontra K' },
    { id: 1440829376, t: 'Astronaut (feat. Andreas Bourani)', a: 'Sido' },
    { id: 1680076253, t: 'Gewarnt (feat. Kontra K)', a: 'RAF Camora' },
    { id: 1620884953, t: 'Beautiful Girl', a: 'Luciano' },
    { id: 1777440592, t: 'Wenn du mich siehst', a: 'Samra' },
    { id: 1090614993, t: 'Ich bin ein Berliner', a: 'Ufo361' }
  ] },
  { id: 'party', name: 'Party', emoji: '🎉', songs: [
    { id: 1765736774, t: 'Dancing Queen', a: 'ABBA' },
    { id: 504994461, t: 'Y.M.C.A.', a: 'Village People' },
    { id: 1426977993, t: 'Celebration', a: 'Kool & The Gang' },
    { id: 427595129, t: 'I Wanna Dance With Somebody', a: 'Whitney Houston' },
    { id: 255639186, t: 'Macarena', a: 'Los del Río' },
    { id: 1786000124, t: 'Gasolina', a: 'Daddy Yankee' },
    { id: 1452862511, t: 'Gangnam Style', a: 'PSY' },
    { id: 273048789, t: 'Billie Jean', a: 'Michael Jackson' },
    { id: 1456446747, t: 'September', a: 'Earth, Wind & Fire' },
    { id: 713773457, t: 'Tubthumping', a: 'Chumbawamba' },
    { id: 723351644, t: 'Who Let the Dogs Out', a: 'Baha Men' },
    { id: 192821659, t: 'Livin\' la Vida Loca', a: 'Ricky Martin' },
    { id: 1297392650, t: 'Cotton Eye Joe', a: 'Rednex' },
    { id: 1439640319, t: 'Last Christmas', a: 'Wham!' }
  ] }
];
