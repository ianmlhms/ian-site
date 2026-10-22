import math
# id, cat, size, cost, cap, price, appeal, star   (cat: ride/food/game)
T=[("kachel","food","S",150,10,3,3,1),("fritten","food","S",220,12,3.5,3,1),("lous","game","S",250,9,3,3,1),("kanner","ride","S",300,12,2.5,4,1),
("wurscht","food","S",480,14,4,4,2),("zocker","food","S",560,12,3.5,3,2),("lukas","game","S",580,10,3.5,4,2),("mandel","food","S",690,12,4,4,2),("waffel","food","S",750,14,4.5,5,2),
("fesch","food","M",800,14,6,6,2),("kette","ride","M",1040,20,4,8,2),("scooter","ride","L",2070,30,4.5,12,2),
("crepes","food","S",1100,12,4.5,4,3),("schiess","game","S",2040,12,4,6,3),("bayern","ride","M",4080,26,5,12,3),("happy","ride","M",3600,24,5,11,3),("break","ride","M",5440,28,5.5,14,3),
("musik","ride","M",4400,26,5,12,3),("takeoff","ride","M",5000,28,5.5,13,3),("tent","food","L",6120,40,9,14,3),("wheel","ride","W",45000,70,7,50,3),("maus","ride","L",11050,34,6.5,20,3),
("geister","ride","L",18400,36,6.5,22,4),("jules","ride","M",21850,30,7,22,4),("hangover","ride","M",24500,30,7,23,4),("splash","ride","L",27600,40,7.5,26,4),("booster","ride","L",32200,34,8,28,4),
("alpina","ride","XL",55200,56,8,40,4),("looping","ride","XL",100800,60,9,52,5),("infinity","ride","M",38000,30,8,30,5)]
STARS=[0,18,70,200,480]; SHARE={"ride":0.42,"food":0.40,"game":0.18}
PITCH={1:7,2:15,3:24,4:30,5:34}
# pitch supply by size (cumulative by star) from pitches.json
SUP={1:{"S":5,"M":2},2:{"S":8,"M":3,"L":4},3:{"S":12,"M":5,"L":6,"W":1},4:{"S":12,"M":10,"L":6,"W":1,"XL":1},5:{"S":14,"M":11,"L":6,"W":1,"XL":2}}
ORDER=["S","M","L","XL","W"]
def fits(item_size,pitch_size):
    if item_size=="W": return pitch_size=="W"
    return pitch_size!="W" and ORDER.index(pitch_size)>=ORDER.index(item_size)
def star_of(R): return max(i+1 for i,t in enumerate(STARS) if R>=t)
def rating(b): return sum(it[6]*(1+0.35*(l-1)) for _,l,it in b)
def income(b):
    R=rating(b);st=star_of(R);L=6+0.55*R**0.9+2*st;inc=0;by={}
    for _,l,it in b: by.setdefault(it[1],[]).append((it,l))
    for c,lst in by.items():
        dem=L*3.6*SHARE[c];w=[it[6]*(1+0.35*(l-1)) for it,l in lst];W=sum(w)
        for (it,l),wi in zip(lst,w): inc+=min(dem*wi/W,it[4]*(1+0.5*(l-1)))*it[5]*(1+0.15*(l-1))
    return inc,R,st
def canplace(b,it,st):
    # greedy assign smallest fitting pitches to existing items
    pit=dict(SUP[st]); 
    for _,_,x in sorted(b+[("n",1,it)],key=lambda t:-ORDER.index(t[2][2])):
        ok=False
        for s in sorted(pit,key=lambda s:ORDER.index(s)):
            if pit[s]>0 and fits(x[2],s): pit[s]-=1; ok=True; break
        if not ok: return False
    return True
def sim(hours=14):
    cash=100.0;b=[("kachel",1,T[0])];t=0;log=[]
    while t<3600*hours:
        inc,R,st=income(b);opts=[]
        for it in T:
            if it[7]>st or sum(1 for x in b if x[0]==it[0])>=2 or not canplace(b,it,st): continue
            ni,_,_=income(b+[(it[0],1,it)]);opts.append(((ni-inc)/it[3],it[3],("buy",it,None)))
        for k,(i,l,it) in enumerate(b):
            if l<3:
                c=it[3]*(0.6 if l==1 else 0.8);ni,_,_=income(b[:k]+[(i,l+1,it)]+b[k+1:]);opts.append(((ni-inc)/c,c,("up",it,k)))
        opts=[o for o in opts if o[0]>0]
        if not opts: break
        opts.sort(key=lambda o:-o[0]);r,c,a=opts[0];need=c-cash
        if need>0:
            if inc<=.01: break
            t+=need/(inc/60);cash+=need
        cash-=c
        if a[0]=="buy": b.append((a[1][0],1,a[1]))
        else: i,l,it=b[a[2]];b[a[2]]=(i,l+1,it)
        i2,R2,s2=income(b);log.append((round(t/60,1),("BUY " if a[0]=="buy" else "UP ")+a[1][0],s2,round(R2),round(i2),round(c)))
    return log,b
if __name__=="__main__":
    log,b=sim(); last=0
    for r in log:
        if r[2]!=last: print("star",r[2],"at",r[0],"min, income/min",r[4],"R",r[3]); last=r[2]
    print("end",log[-1]); print("buys",sum(1 for r in log if r[1].startswith("BUY")))
    print("wheel bought at",[r[0] for r in log if r[1]=="BUY wheel"],"looping",[r[0] for r in log if r[1]=="BUY looping"])
