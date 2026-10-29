const {AsyncLocalStorage}=require('async_hooks');
const context=new AsyncLocalStorage(), locks=new Map();
module.exports=async function locked(id,fn){
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Object.assign(new Error('Invalid article ID'),{status:400});
 if(context.getStore()===id)return fn();
 const prior=locks.get(id)||Promise.resolve();let release;const next=new Promise(r=>release=r);locks.set(id,next);await prior;
 try{return await context.run(id,fn);}finally{release();if(locks.get(id)===next)locks.delete(id);}
};
