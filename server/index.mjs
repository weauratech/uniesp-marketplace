import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createApp} from './app.mjs';
const dbPath=resolve(process.env.DB_PATH||'data/marketplace.sqlite');mkdirSync(dirname(dbPath),{recursive:true});
const app=createApp({dbPath,origin:process.env.APP_ORIGIN||'http://127.0.0.1:5177',mode:process.env.PAYMENT_MODE||'demo'});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3002);
app.server.listen(port,host,()=>console.log(`Marketplace listening on ${host}:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});
