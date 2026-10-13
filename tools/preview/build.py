# Локальний перегляд екранів без Google: збирає seller.html і admin.html
# з app/ui/*.html, підставляючи тестові дані замість сервера.
# Запуск:  python tools/preview/build.py   -> відкрити tools/preview/*.html у Chrome
# Вигляд телефона: F12 -> Ctrl+Shift+M. Дані фейкові, нікуди нічого не пишеться.
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, '..', '..', 'app', 'ui') + os.sep
_open = open
def open(p, m='r', **k):
    if 'b' not in m and 'encoding' not in k: k['encoding'] = 'utf-8'
    return _open(p, m, **k)

def inc(s):
    return re.sub(r"<\?!= include\('ui/(\w+)'\) \?>", lambda m: open(A+m.group(1)+'.html').read(), s)
mock_seller = r"""<script>
var PRODUCTS=[{id:'1',name:'Булочка з маком',category:'Випічка',price:18},{id:'2',name:'Круасан з шоколадом',category:'Випічка',price:32.5},
{id:'3',name:'Пиріжок з капустою',category:'Випічка',price:14},{id:'4',name:'Салат Олів\'є, 250 г',category:'Кулінарія',price:58},
{id:'5',name:'Котлета по-київськи',category:'Кулінарія',price:74},{id:'6',name:'Вареники з картоплею, 500 г',category:'Кулінарія',price:66}];
var MINE={docs:[{id:'w1',date:'13.10.2026',at:'13.10.2026 09:42',items:[{name:'Булочка з маком',qty:3,price:18,sum:54},{name:'Салат Олів\'є, 250 г',qty:1,price:58,sum:58}],total:112,canDelete:true,edrpou:'44413718'},
{id:'w2',date:'11.10.2026',at:'12.10.2026 08:15',items:[{name:'Круасан з шоколадом',qty:2,price:32.5,sum:65}],total:65,canDelete:false,edrpou:'44413718'}],closed:false,deadline:'13:00',keepDays:31,total:177,month:177,edrpou:'44413718'};
window.google={script:{run:(function(){var o={_s:null,_f:null,withSuccessHandler:function(f){var n=Object.create(o);n._s=f;n._f=this._f;return n;},withFailureHandler:function(f){var n=Object.create(this);n._f=f;return n;},
api:function(a,p){var s=this._s;setTimeout(function(){var d;
if(a==='bootstrap')d={stores:[{id:'tt1',label:'Валентинівська, 2',code:'14',directions:['bread','bakery'],ordered:{bread:true,bakery:false},dayOk:{bread:true,bakery:true},dayOff:{},wo:true}],
directions:{bread:{key:'bread',title:'Хліб Рома',subtitle:'ЧП Рома',color:'#8D6E63',deadline:'16:00',closed:false},bakery:{key:'bakery',title:'Випічка і кулінарія',subtitle:'власне виробництво',color:'#E65100',deadline:'13:00',closed:false}},version:'v',today:'13.10.2026',testMode:false,woDeadline:'13:00'};
else if(a==='woProducts')d={products:JSON.parse(JSON.stringify(PRODUCTS)),categories:['Випічка','Кулінарія'],costCol:false,dates:[{v:'13.10.2026',t:'Сьогодні'}],closed:false,deadline:'13:00',edrpou:'44413718',hasBook:true};
else if(a==='woSubmit')d={docId:p.docId,store:'Валентинівська, 2',woDate:p.date,edrpou:'44413718',positions:p.items.length,qty:5,total:155,time:'10:12',date:'13.10.2026',duplicate:false};
else if(a==='woMine')d=MINE; else d={};
s&&s({ok:true,data:d});},50);}};return o;})()}};
</script>"""
s=open(A+'Index.html').read()
s=re.sub(r"<\? var LOGO[^?]*\?>","",s)
s=re.sub(r"<\? if \(LOGO\) \{ \?>[\s\S]*?<\? \} else \{ \?>","",s).replace("<? } ?>","")
s=inc(s).replace('<script>',mock_seller+'<script>',1).replace('<base target="_top">','')
s=s.replace('location.search','"?tt=tt1"')
open(os.path.join(HERE,'seller.html'),'w',encoding='utf-8').write(s)


def inc(s):
    return re.sub(r"<\?!= include\('ui/(\w+)'\) \?>", lambda m: open(A+m.group(1)+'.html').read(), s)
mock = r"""<script>
try{localStorage.setItem('adm_token','T');localStorage.removeItem('adm_swr_v1');}catch(e){}
var STATS={period:'month',periodTitle:'этот месяц',from:'01.10.2026',to:'13.10.2026',edrpou:'',total:18450.5,qty:612,docs:184,storesCount:31,storesAll:37,
stores:[{id:'s1',label:'Валентиновская, 2',code:'14',edrpou:'44413718',nowEdrpou:'44413718',sum:1820.5,qty:61,docs:12},{id:'s2',label:'Гвардейцев Широнинцев, 49',code:'7',edrpou:'44413718',nowEdrpou:'45672783',sum:1210,qty:40,docs:9},{id:'s3',label:'Тракторостроителей, 85',code:'21',ua:true,edrpou:'45672783',nowEdrpou:'45672783',sum:640,qty:22,docs:5}],
products:[{name:'Салат Олів\'є, 250 г',cat:'Кулінарія',sum:3480,qty:60},{name:'Круасан з шоколадом',cat:'Випічка',sum:2275,qty:70}],
days:[{date:'13.10.2026',sum:820},{date:'12.10.2026',sum:1640},{date:'11.10.2026',sum:1210}],silent:['Бучмы, 3','Победы, 66'],
books:[{edrpou:'44413718',name:'',url:'#',xlsx:'#',sum:12400,qty:400,active:22,storesNow:27},{edrpou:'45672783',name:'',url:'#',xlsx:'#',sum:6050.5,qty:212,active:9,storesNow:10}],
missing:[],costCol:false,closed:false,openedAll:false,deadline:'13:00',keepDays:31};
var TODAY={today:'13.10.2026',time:'10:20',dow:'вторник',dirs:[{key:'bakery',title:'Выпечка',color:'#E65100',deadline:'13:00',closed:false,openedAll:false,enabled:true,total:30,ordered:21,waiting:[],all:37,offDay:7,byDays:true,noDayToday:false,reportAt:'10:15',minLeft:160}]};
window.google={script:{run:(function(){var o={_s:null,withSuccessHandler:function(f){var n=Object.create(o);n._s=f;return n;},withFailureHandler:function(){return this;},
adminApi:function(a,p){var s=this._s;setTimeout(function(){var d;
if(a==='today')d=TODAY;else if(a==='woBrief')d={todayDocs:14,todayStores:12,todaySum:1640.5,monthSum:18450.5,books:2,deadline:'13:00',closed:false,openedAll:false};
else if(a==='woStats')d=STATS;else if(a==='woStore')d={id:'s1',label:'Валентиновская, 2',code:'14',edrpou:'44413718',bookUrl:'#',period:'month',periodTitle:'этот месяц',from:'01.10.2026',to:'13.10.2026',total:166,qty:6,docs:[{id:'w1',date:'12.10.2026',at:'13.10.2026 09:42',edrpou:'44413718',sheet:'Списания',items:[{name:'Булочка з маком',qty:3,price:18,sum:54},{name:'Салат Олів\'є',qty:2,price:56,sum:112}],total:166,qty:5}]};
else if(a==='batch')d=[];else d={};
s&&s({ok:true,data:d,ms:5});},30);}};return o;})()}};
</script>"""
s=open(A+'Admin.html').read()
s=inc(s).replace('<div id="modal"></div>','<div id="modal"></div>'+mock).replace('<base target="_top">','')
open(os.path.join(HERE,'admin.html'),'w',encoding='utf-8').write(s)
