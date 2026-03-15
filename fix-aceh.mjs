const BASE = 'https://herdhub-production-7da5.up.railway.app';

const lr = await fetch(BASE+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'pauldenhertog256@gmail.com',password:'PipoPassword*'})});
const cookie = lr.headers.get('set-cookie').split(';')[0];
const h = {'Cookie':cookie,'Content-Type':'application/json'};

const breeds = await (await fetch(BASE+'/api/breeds')).json();
const aceh = breeds.find(b=>b.id===6);
console.log('Aceh imageUrl starts with:', aceh.imageUrl.slice(0,40));

const up = await fetch(BASE+'/api/upload-image',{method:'POST',headers:h,body:JSON.stringify({name:aceh.name,breedId:aceh.id,dataUrl:aceh.imageUrl})});
const {path:localPath} = await up.json();
const pa = await fetch(BASE+'/api/breeds/6',{method:'PATCH',headers:h,body:JSON.stringify({imageUrl:localPath})});
const b = await pa.json();
console.log('[OK] Aceh ->', b.imageUrl);
